from __future__ import annotations

import asyncio
import os
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any
from typing import Literal

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.engine import Connection

from agent.auth import Principal
from agent.auth import get_current_principal
from agent.common.db_utils import ensure_schema
from agent.common.db_utils import present_columns
from agent.common.db_utils import present_indexes
from agent.common.source_kinds import is_office_shelf_collection
from agent.knowledge.restricted_collections import base_collection_of
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_HEADER
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_SIG_HEADER
from agent.project_context import RequestContext

_job_access_schema_initialized: set[str] = set()

_JOB_ACCESS_INDEX_SQL = "CREATE INDEX IF NOT EXISTS idx_job_access_owner ON job_access(owner_auth_type, owner_subject)"
_JOB_ACCESS_PROJECT_INDEX_SQL = (
    "CREATE INDEX IF NOT EXISTS idx_job_access_owner_project ON job_access(owner_subject, project_collection)"
)
_JOB_ACCESS_SELECT_SQL = text(
    "SELECT job_id, owner_auth_type, owner_subject, owner_email, conversation_id, project_collection, "
    "organization_id, created_at "
    "FROM job_access WHERE job_id = :job_id"
)
_JOB_ACCESS_DELETE_SQL = text("DELETE FROM job_access WHERE job_id = :job_id")
_JOB_ACCESS_CLEANUP_SQL = text(
    "DELETE FROM job_access WHERE job_id NOT IN (SELECT job_id FROM job_info WHERE is_expired IS NOT TRUE)"
)
_JOB_INFO_DELETE_SQL = text("DELETE FROM job_info WHERE job_id = :job_id")
_JOB_EVENTS_DELETE_SQL = text("DELETE FROM job_events WHERE job_id = :job_id")

_TERMINAL_STATUSES = ("SUCCESS", "FAILURE", "INTERRUPTED")


def _is_postgres(db_url: str) -> bool:
    return db_url.startswith("postgres")


def ensure_job_access_table(db_url: str) -> None:
    _ensure_job_access_schema(db_url)


def create_job_access(
    job_id: str,
    principal: Principal,
    db_url: str,
    conversation_id: str | None = None,
    project_collection: str | None = None,
    organization_id: str | None = None,
) -> None:
    _ensure_job_access_schema(db_url)
    with _job_access_connection(db_url) as conn:
        conn.execute(
            _job_access_upsert_sql(db_url),
            _principal_params(job_id, principal, conversation_id, project_collection, organization_id),
        )
        conn.commit()


def get_job_access(job_id: str, db_url: str) -> dict[str, Any] | None:
    _ensure_job_access_schema(db_url)
    with _job_access_connection(db_url) as conn:
        row = conn.execute(_JOB_ACCESS_SELECT_SQL, {"job_id": job_id}).mappings().first()
        return dict(row) if row is not None else None


async def get_job_project_collection(job_id: str, db_url: str) -> str | None:
    loop = asyncio.get_running_loop()
    access = await loop.run_in_executor(None, get_job_access, job_id, db_url)
    if access is None:
        return None
    collection = access.get("project_collection")
    return collection if isinstance(collection, str) and collection else None


def job_exists(job_id: str, db_url: str) -> bool:
    from sqlalchemy import inspect

    _ensure_job_access_schema(db_url)
    with _job_access_connection(db_url) as conn:
        row = conn.execute(text("SELECT 1 FROM job_access WHERE job_id = :job_id"), {"job_id": job_id}).first()
        if row is not None:
            return True
        if inspect(conn.engine).has_table("job_info"):
            row = conn.execute(text("SELECT 1 FROM job_info WHERE job_id = :job_id"), {"job_id": job_id}).first()
            return row is not None
    return False


def delete_job_access(job_id: str, db_url: str) -> int:
    _ensure_job_access_schema(db_url)
    with _job_access_connection(db_url) as conn:
        result = conn.execute(_JOB_ACCESS_DELETE_SQL, {"job_id": job_id})
        conn.commit()
        return result.rowcount or 0


def cleanup_job_access(db_url: str, conn: Connection | None = None) -> int:
    _ensure_job_access_schema(db_url)
    if conn is not None:
        result = conn.execute(_JOB_ACCESS_CLEANUP_SQL)
        return result.rowcount or 0

    with _job_access_connection(db_url) as owned_conn:
        result = owned_conn.execute(_JOB_ACCESS_CLEANUP_SQL)
        owned_conn.commit()
        return result.rowcount or 0


def expire_terminal_jobs(
    db_url: str,
    delete_grace_seconds: int,
    conn: Connection | None = None,
) -> tuple[int, int]:
    if conn is not None:
        return _expire_terminal_jobs(conn, db_url, delete_grace_seconds)
    with _job_access_connection(db_url) as owned_conn:
        marked, deleted = _expire_terminal_jobs(owned_conn, db_url, delete_grace_seconds)
        owned_conn.commit()
        return marked, deleted


def _expire_terminal_jobs(conn: Connection, db_url: str, delete_grace_seconds: int) -> tuple[int, int]:
    from sqlalchemy import bindparam
    from sqlalchemy import inspect

    if not inspect(conn.engine).has_table("job_info"):
        return (0, 0)

    is_pg = _is_postgres(db_url)
    status_params: dict[str, Any] = {f"s{i}": s for i, s in enumerate(_TERMINAL_STATUSES)}
    placeholders = ", ".join(f":s{i}" for i in range(len(_TERMINAL_STATUSES)))
    keep_newest = (
        f"job_id <> COALESCE((SELECT job_id FROM job_info WHERE status IN ({placeholders}) "
        "ORDER BY updated_at DESC LIMIT 1), '')"
    )
    if is_pg:
        past_expiry = "updated_at < NOW() - make_interval(secs => expiry_seconds)"
        past_grace = "updated_at < NOW() - make_interval(secs => :grace)"
        not_expired = "is_expired IS NOT TRUE"
        set_expired = "is_expired = true"
    else:
        past_expiry = "datetime(updated_at, '+' || expiry_seconds || ' seconds') < datetime('now')"
        past_grace = "datetime(updated_at, '+' || :grace || ' seconds') < datetime('now')"
        not_expired = "COALESCE(is_expired, 0) = 0"
        set_expired = "is_expired = 1"

    marked = (
        conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(
                f"UPDATE job_info SET {set_expired} "
                f"WHERE {not_expired} AND status IN ({placeholders}) AND {past_expiry} AND {keep_newest}"
            ),
            status_params,
        ).rowcount
        or 0
    )

    stale_ids = list(
        conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(
                f"SELECT job_id FROM job_info WHERE status IN ({placeholders}) "
                f"AND {past_grace} AND {past_expiry} AND {keep_newest}"
            ),
            {**status_params, "grace": delete_grace_seconds},
        ).scalars()
    )
    if not stale_ids:
        return (marked, 0)

    for table in ("job_events", "job_access", "job_info"):
        conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(f"DELETE FROM {table} WHERE job_id IN :ids").bindparams(bindparam("ids", expanding=True)),
            {"ids": stale_ids},
        )
    return (marked, len(stale_ids))


def rollback_job_submission(job_id: str, db_url: str) -> None:
    from .event_store import EventStore

    EventStore._ensure_table_exists(db_url)
    _ensure_job_access_schema(db_url)
    with _job_access_connection(db_url) as conn:
        conn.execute(_JOB_ACCESS_DELETE_SQL, {"job_id": job_id})
        conn.execute(_JOB_EVENTS_DELETE_SQL, {"job_id": job_id})
        conn.execute(_JOB_INFO_DELETE_SQL, {"job_id": job_id})
        conn.commit()


def _make_no_auth_principal(owner: str | None = None) -> Principal:
    try:
        from agent.auth.request_identity import get_current_user

        current_user = get_current_user()
    except Exception:
        current_user = {}

    principal_type = str(current_user.get("type") or "anonymous")
    subject = owner if owner else principal_type
    email = owner if owner and "@" in owner else None
    return Principal(type=principal_type, sub=subject, email=email)


def require_verified_principal() -> Principal:
    principal = get_current_principal()
    if principal is not None:
        return principal

    if _auth_required():
        raise HTTPException(403, "Verified principal required for async job access")

    return _make_no_auth_principal()


def _auth_required() -> bool:
    return os.environ.get("REQUIRE_AUTH", "false").lower() == "true"


def _base_collection_name() -> str:
    return os.environ.get("OIB_COLLECTION_NAME") or os.environ.get("COLLECTION_NAME") or "oib_knowledge"


def derive_project_collection(collection_scope: list[str] | None) -> str | None:
    if not collection_scope:
        return None

    base_collection = _base_collection_name()
    candidates = {
        base_collection_of(collection)
        for collection in collection_scope
        if collection != base_collection
        and not collection.startswith("s_")
        and not is_office_shelf_collection(collection)
    }
    if len(candidates) == 1:
        return candidates.pop()
    return None


JOB_ENVELOPE_MAX_AGE_MS = 6 * 60 * 60 * 1000

JobAction = Literal["read", "control"]


@dataclass(frozen=True)
class SignedJobScope:
    organization_id: str
    project_collection: str | None
    conversation_id: str | None


@dataclass(frozen=True)
class JobCaller:
    principal: Principal
    scope: SignedJobScope | None = None


def verified_envelope(
    headers: Mapping[str, str],
    *,
    user_id: str | None,
    organization_id: str | None = None,
    now_ms: int | None = None,
) -> RequestContext | None:
    secret = os.environ.get("INTERNAL_API_TOKEN")
    if not secret or not user_id:
        return None
    context = RequestContext.from_envelope(
        headers.get(REQUEST_CONTEXT_ENVELOPE_HEADER),
        headers.get(REQUEST_CONTEXT_ENVELOPE_SIG_HEADER),
        secret,
    )
    if context is None or not context.organization_id or context.issued_at is None:
        return None
    if context.user_id != user_id:
        return None
    if organization_id is not None and context.organization_id != organization_id:
        return None
    now = now_ms if now_ms is not None else int(time.time() * 1000)
    if abs(now - context.issued_at) > JOB_ENVELOPE_MAX_AGE_MS:
        return None
    return context


def signed_job_scope(
    headers: Mapping[str, str],
    principal: Principal,
    *,
    now_ms: int | None = None,
) -> SignedJobScope | None:
    context = verified_envelope(headers, user_id=principal.sub, now_ms=now_ms)
    if context is None or context.organization_id is None:
        return None
    return SignedJobScope(
        organization_id=context.organization_id,
        project_collection=derive_project_collection(context.collection_scope),
        conversation_id=context.conversation_id,
    )


def job_access_allows(access: Mapping[str, Any], caller: JobCaller, action: JobAction) -> bool:
    if _principal_matches_access(caller.principal, access):
        return True
    scope = caller.scope
    if scope is None:
        return False
    organization_id = access.get("organization_id")
    if not organization_id or organization_id != scope.organization_id:
        return False
    project_collection = access.get("project_collection")
    if project_collection and project_collection == scope.project_collection:
        return True
    if action != "read":
        return False
    conversation_id = access.get("conversation_id")
    return bool(conversation_id) and conversation_id == scope.conversation_id


def job_visibility_clause(caller: JobCaller) -> tuple[str, dict[str, Any]]:
    clauses = ["(ja.owner_auth_type = :owner_auth_type AND ja.owner_subject = :owner_subject)"]
    params: dict[str, Any] = {
        "owner_auth_type": caller.principal.type,
        "owner_subject": caller.principal.sub,
    }
    scope = caller.scope
    shared: list[str] = []
    if scope is not None and scope.project_collection:
        shared.append("ja.project_collection = :scope_project_collection")
        params["scope_project_collection"] = scope.project_collection
    if scope is not None and scope.conversation_id:
        shared.append("ja.conversation_id = :scope_conversation_id")
        params["scope_conversation_id"] = scope.conversation_id
    if scope is not None and shared:
        clauses.append(f"(ja.organization_id = :scope_organization_id AND ({' OR '.join(shared)}))")
        params["scope_organization_id"] = scope.organization_id
    return f"({' OR '.join(clauses)})", params


async def authorize_job_access(
    job_store: Any,
    db_url: str,
    job_id: str,
    caller: JobCaller,
    action: JobAction,
) -> Any:
    job = await job_store.get_job(job_id)
    if not job:
        raise HTTPException(404, f"Job not found: {job_id}")

    if not _auth_required():
        return job

    loop = asyncio.get_running_loop()
    access = await loop.run_in_executor(None, get_job_access, job_id, db_url)
    if access is None:
        raise HTTPException(404, f"Job not found: {job_id}")

    if not job_access_allows(access, caller, action):
        raise HTTPException(404, f"Job not found: {job_id}")

    return job


def _principal_matches_access(principal: Principal, access: Mapping[str, Any]) -> bool:
    return principal.type == access.get("owner_auth_type") and principal.sub == access.get("owner_subject")


def _job_access_connection(db_url: str):
    from .event_store import EventStore

    engine = EventStore._get_or_create_sync_engine(db_url)
    return engine.connect()


def _ensure_job_access_schema(db_url: str) -> None:
    if db_url in _job_access_schema_initialized:
        return
    from .event_store import EventStore

    engine = EventStore._get_or_create_sync_engine(db_url)
    ensure_schema(engine, "job_access", lambda conn: _create_job_access_schema(conn, db_url))
    _job_access_schema_initialized.add(db_url)


def _create_job_access_schema(conn: Connection, db_url: str) -> None:
    conn.execute(text(_job_access_table_sql(db_url)))
    indexes = present_indexes(conn, "job_access")
    if "idx_job_access_owner" not in indexes:
        conn.execute(text(_JOB_ACCESS_INDEX_SQL))
    if _is_postgres(db_url):
        for statement in _job_access_add_column_statements(db_url, present_columns(conn, "job_access")):
            conn.execute(text(statement))
    else:
        _ensure_sqlite_job_access_columns(conn)
    if "idx_job_access_owner_project" not in indexes:
        conn.execute(text(_JOB_ACCESS_PROJECT_INDEX_SQL))


def _job_access_table_sql(db_url: str) -> str:
    created_at_type = (
        "TIMESTAMP WITH TIME ZONE DEFAULT NOW()" if _is_postgres(db_url) else "DATETIME DEFAULT CURRENT_TIMESTAMP"
    )
    return (
        "CREATE TABLE IF NOT EXISTS job_access ("
        "  job_id VARCHAR PRIMARY KEY,"
        "  owner_auth_type VARCHAR NOT NULL,"
        "  owner_subject VARCHAR NOT NULL,"
        "  owner_email VARCHAR,"
        "  conversation_id VARCHAR,"
        "  project_collection VARCHAR,"
        "  organization_id VARCHAR,"
        f"  created_at {created_at_type}"
        ")"
    )


_JOB_ACCESS_BACKFILL_COLUMNS = {
    "conversation_id": "ALTER TABLE job_access ADD COLUMN IF NOT EXISTS conversation_id VARCHAR",
    "project_collection": "ALTER TABLE job_access ADD COLUMN IF NOT EXISTS project_collection VARCHAR",
    "organization_id": "ALTER TABLE job_access ADD COLUMN IF NOT EXISTS organization_id VARCHAR",
}


def _job_access_add_column_statements(db_url: str, present: set[str] | frozenset[str] = frozenset()) -> list[str]:
    if _is_postgres(db_url):
        return [statement for column, statement in _JOB_ACCESS_BACKFILL_COLUMNS.items() if column not in present]
    return []


def _ensure_sqlite_job_access_columns(conn: Connection) -> None:
    existing_columns = {row[1] for row in conn.execute(text("PRAGMA table_info(job_access)")).fetchall()}
    if "conversation_id" not in existing_columns:
        conn.execute(text("ALTER TABLE job_access ADD COLUMN conversation_id VARCHAR"))
    if "project_collection" not in existing_columns:
        conn.execute(text("ALTER TABLE job_access ADD COLUMN project_collection VARCHAR"))
    if "organization_id" not in existing_columns:
        conn.execute(text("ALTER TABLE job_access ADD COLUMN organization_id VARCHAR"))


def _job_access_upsert_sql(db_url: str):
    postgres_upsert = (
        "INSERT INTO job_access "
        "(job_id, owner_auth_type, owner_subject, owner_email, conversation_id, project_collection, organization_id) "
        "VALUES (:job_id, :owner_auth_type, :owner_subject, :owner_email, :conversation_id, :project_collection, "
        ":organization_id) "
        "ON CONFLICT(job_id) DO UPDATE SET "
        "owner_auth_type = excluded.owner_auth_type, "
        "owner_subject = excluded.owner_subject, "
        "owner_email = excluded.owner_email, "
        "conversation_id = excluded.conversation_id, "
        "project_collection = excluded.project_collection, "
        "organization_id = excluded.organization_id"
    )
    sqlite_upsert = (
        "INSERT OR REPLACE INTO job_access "
        "(job_id, owner_auth_type, owner_subject, owner_email, conversation_id, project_collection, organization_id) "
        "VALUES (:job_id, :owner_auth_type, :owner_subject, :owner_email, :conversation_id, :project_collection, "
        ":organization_id)"
    )
    return text(postgres_upsert if _is_postgres(db_url) else sqlite_upsert)


def _principal_params(
    job_id: str,
    principal: Principal,
    conversation_id: str | None = None,
    project_collection: str | None = None,
    organization_id: str | None = None,
) -> dict[str, str | None]:
    return {
        "job_id": job_id,
        "owner_auth_type": principal.type,
        "owner_subject": principal.sub,
        "owner_email": principal.email,
        "conversation_id": conversation_id,
        "project_collection": project_collection,
        "organization_id": organization_id,
    }
