from __future__ import annotations

import logging
import os
import socket
import uuid
from collections.abc import Iterable
from datetime import UTC
from datetime import datetime

from sqlalchemy import bindparam
from sqlalchemy import inspect
from sqlalchemy import text

from agent.common.db_utils import ensure_schema

from . import ingest_settle_push
from .document_metadata_store import DocumentMetadataStore
from .ingest_failures import classify_failure
from .schema import FileStatus
from .schema import IngestionJobStatus
from .schema import JobState

logger = logging.getLogger(__name__)

_initialized: set[str] = set()

OWNER = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"

HEARTBEAT_INTERVAL_SECONDS = 30

STALE_AFTER_SECONDS = 4 * HEARTBEAT_INTERVAL_SECONDS

_LEGACY_STALE_AFTER_SECONDS = 15 * 60

INTERRUPTED = "interrupted"
INTERRUPTED_MESSAGE = f"{INTERRUPTED}: ingestion stopped when the service restarted; retry to index this file"

CANCELLED = "cancelled"
CANCELLED_MESSAGE = f"{CANCELLED}: ingestion was stopped; start it again to index this file"

_SWEEP_LIMIT = 500

_ADDED_COLUMNS = {"owner": "VARCHAR", "dispatch_key": "VARCHAR", "collection_name": "VARCHAR", "run_id": "VARCHAR"}

_HOLD_QUEUED_AT_CUTOVER = (
    "UPDATE ingest_jobs SET held_until = {until} WHERE (held_until IS NULL OR held_until <= {now}) AND job_id IN "
    "(SELECT job_id FROM ingest_job_queue WHERE status IN ('queued', 'claimed'))"
)
_CUTOVER_HOLD_SECONDS = 24 * 3600

_BACKFILL_COLLECTION_NAME = {
    True: "UPDATE ingest_jobs SET collection_name = CAST(status_json AS json) ->> 'collection_name' "
    "WHERE collection_name IS NULL",
    False: "UPDATE ingest_jobs SET collection_name = json_extract(status_json, '$.collection_name') "
    "WHERE collection_name IS NULL",
}


def _db_url() -> str | None:
    url = os.environ.get("SUMMARY_DB") or os.environ.get("NAT_JOB_STORE_DB_URL")
    return url or None


def _is_postgres(url: str) -> bool:
    return url.startswith("postgres")


def _ensure_table(url: str) -> None:
    if url in _initialized:
        return
    engine = DocumentMetadataStore._get_or_create_sync_engine(url)
    ts = "TIMESTAMP WITH TIME ZONE DEFAULT NOW()" if _is_postgres(url) else "DATETIME DEFAULT CURRENT_TIMESTAMP"

    def create(conn) -> None:
        conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(
                "CREATE TABLE IF NOT EXISTS ingest_jobs ("
                "  job_id VARCHAR PRIMARY KEY,"
                "  status_json TEXT NOT NULL,"
                f"  updated_at {ts}"
                ")"
            )
        )
        _add_missing_columns(conn, url)

    ensure_schema(engine, "ingest_jobs", create)
    _initialized.add(url)


def _add_missing_columns(conn, url: str) -> None:
    heartbeat_type = "TIMESTAMP WITH TIME ZONE" if _is_postgres(url) else "DATETIME"
    columns = {**_ADDED_COLUMNS, "heartbeat_at": heartbeat_type, "held_until": heartbeat_type}
    present = {column["name"] for column in inspect(conn).get_columns("ingest_jobs")}
    guard = "IF NOT EXISTS " if _is_postgres(url) else ""
    for name, column_type in columns.items():
        if name in present:
            continue
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        conn.execute(text(f"ALTER TABLE ingest_jobs ADD COLUMN {guard}{name} {column_type}"))
    if "collection_name" not in present:
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        conn.execute(text(_BACKFILL_COLLECTION_NAME[_is_postgres(url)]))
    if "held_until" not in present and "ingest_job_queue" in inspect(conn).get_table_names():
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        conn.execute(text(_HOLD_QUEUED_AT_CUTOVER.format(until=_from_now(url, _CUTOVER_HOLD_SECONDS), now=_now(url))))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ingest_jobs_dispatch_key ON ingest_jobs (dispatch_key)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ingest_jobs_collection_name ON ingest_jobs (collection_name)"))


def _now(url: str) -> str:
    return "NOW()" if _is_postgres(url) else "CURRENT_TIMESTAMP"


def _ago(url: str, seconds: int) -> str:
    return f"NOW() - INTERVAL '{seconds} seconds'" if _is_postgres(url) else f"DATETIME('now', '-{seconds} seconds')"


def _from_now(url: str, seconds: int) -> str:
    return f"NOW() + INTERVAL '{seconds} seconds'" if _is_postgres(url) else f"DATETIME('now', '+{seconds} seconds')"


def _stale_predicate(url: str) -> str:
    return (
        f"(((heartbeat_at IS NOT NULL AND heartbeat_at < {_ago(url, STALE_AFTER_SECONDS)}) "
        f"OR (heartbeat_at IS NULL AND updated_at < {_ago(url, _LEGACY_STALE_AFTER_SECONDS)})) "
        f"AND (held_until IS NULL OR held_until <= {_now(url)}))"
    )


def _is_live(status: IngestionJobStatus) -> bool:
    return status.status in (JobState.PENDING, JobState.PROCESSING)


def interrupted(status: IngestionJobStatus) -> IngestionJobStatus:
    failed = status.model_copy(deep=True)
    failed.status = JobState.FAILED
    failed.error_message = INTERRUPTED_MESSAGE
    failed.completed_at = datetime.now(UTC).replace(tzinfo=None).isoformat()
    failed.metadata = {**failed.metadata, "failure_reason": INTERRUPTED, "retryable": True}
    verdict = classify_failure(INTERRUPTED_MESSAGE)
    for detail in failed.file_details:
        if detail.status in (FileStatus.SUCCESS, FileStatus.FAILED):
            continue
        detail.status = FileStatus.FAILED
        detail.error_message = INTERRUPTED_MESSAGE
        detail.failure_category = verdict.category
        detail.retryable = verdict.retryable
    return failed


def cancelled(status: IngestionJobStatus) -> IngestionJobStatus:
    stopped = status.model_copy(deep=True)
    stopped.status = JobState.CANCELLED
    stopped.error_message = CANCELLED_MESSAGE
    stopped.completed_at = datetime.now(UTC).replace(tzinfo=None).isoformat()
    stopped.metadata = {**stopped.metadata, "cancelled": True}
    for detail in stopped.file_details:
        if detail.status in (FileStatus.SUCCESS, FileStatus.FAILED):
            continue
        detail.status = FileStatus.FAILED
        detail.error_message = CANCELLED_MESSAGE
    return stopped


def _settle_lost(conn, url: str, status: IngestionJobStatus) -> IngestionJobStatus | None:
    settled = interrupted(status)
    result = conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(
            f"UPDATE ingest_jobs SET status_json = :status_json, updated_at = {_now(url)}, owner = NULL "
            f"WHERE job_id = :job_id AND {_stale_predicate(url)}"
        ),
        {"job_id": status.job_id, "status_json": settled.model_dump_json(warnings=False)},
    )
    conn.commit()
    if result.rowcount == 0:
        return None
    logger.warning("Ingest job %s lost its owner; recorded as %s", status.job_id, INTERRUPTED)
    return settled


def _read(conn, job_id: str) -> IngestionJobStatus | None:
    row = conn.execute(
        text("SELECT status_json FROM ingest_jobs WHERE job_id = :job_id"), {"job_id": job_id}
    ).scalar_one_or_none()
    return IngestionJobStatus.model_validate_json(row) if row is not None else None


def put(status: IngestionJobStatus) -> bool:
    url = _db_url()
    if not url:
        return True
    try:
        _ensure_table(url)
        engine = DocumentMetadataStore._get_or_create_sync_engine(url)
        now = _now(url)
        with engine.connect() as conn:
            conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(
                    "INSERT INTO ingest_jobs "
                    "(job_id, status_json, updated_at, owner, heartbeat_at, dispatch_key, collection_name) "
                    f"VALUES (:job_id, :status_json, {now}, :owner, {now}, :dispatch_key, :collection_name) "
                    "ON CONFLICT (job_id) DO UPDATE SET "
                    f"status_json = EXCLUDED.status_json, updated_at = {now}, "
                    f"owner = EXCLUDED.owner, heartbeat_at = {now}, "
                    "dispatch_key = COALESCE(EXCLUDED.dispatch_key, ingest_jobs.dispatch_key), "
                    "collection_name = EXCLUDED.collection_name"
                ),
                {
                    "job_id": status.job_id,
                    "status_json": status.model_dump_json(warnings=False),
                    "owner": OWNER,
                    "dispatch_key": status.metadata.get("dispatch_key"),
                    "collection_name": status.collection_name,
                },
            )
            conn.commit()
    except Exception:
        logger.warning("Failed to persist ingest status for %s (will retry)", status.job_id, exc_info=True)
        return False
    return True


def _write_cancelled(conn, url: str, job_id: str) -> bool:
    status = _read(conn, job_id)
    if status is None or not _is_live(status):
        return False
    conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(
            f"UPDATE ingest_jobs SET status_json = :status_json, updated_at = {_now(url)}, owner = NULL, "
            "held_until = NULL WHERE job_id = :job_id"
        ),
        {"job_id": job_id, "status_json": cancelled(status).model_dump_json(warnings=False)},
    )
    conn.commit()
    return True


def settle_cancelled(job_id: str) -> bool:
    url = _db_url()
    if not url:
        return False
    try:
        _ensure_table(url)
        engine = DocumentMetadataStore._get_or_create_sync_engine(url)
        with engine.connect() as conn:
            written = _write_cancelled(conn, url, job_id)
    except Exception:
        logger.warning("Failed to settle cancelled ingest job %s", job_id, exc_info=True)
        return False
    if not written:
        return False
    logger.info("Ingest job %s was cancelled; status settled", job_id)
    ingest_settle_push.notify_settled([job_id])
    return True


def heartbeat(job_ids: Iterable[str]) -> int | None:
    ids = list(job_ids)
    url = _db_url()
    if not url:
        return None
    if not ids:
        return 0
    try:
        _ensure_table(url)
        engine = DocumentMetadataStore._get_or_create_sync_engine(url)
        statement = text(
            "UPDATE ingest_jobs SET heartbeat_at = CURRENT_TIMESTAMP WHERE owner = :owner AND job_id IN :ids"
        ).bindparams(bindparam("ids", expanding=True))
        with engine.connect() as conn:
            refreshed = conn.execute(statement, {"owner": OWNER, "ids": ids}).rowcount
            conn.commit()
    except Exception:
        logger.warning("Ingest heartbeat failed for %d job(s) (continuing)", len(ids), exc_info=True)
        return None
    return refreshed


def get(job_id: str) -> IngestionJobStatus | None:
    url = _db_url()
    if not url:
        return None
    try:
        _ensure_table(url)
        engine = DocumentMetadataStore._get_or_create_sync_engine(url)
        with engine.connect() as conn:
            row = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(f"SELECT status_json, {_stale_predicate(url)} AS stale FROM ingest_jobs WHERE job_id = :job_id"),
                {"job_id": job_id},
            ).first()
            return _as_read(conn, url, row[0], row[1]) if row is not None else None
    except Exception:
        logger.warning("Failed to read ingest status for %s", job_id, exc_info=True)
        return None


def _as_read(conn, url: str, status_json: str, stale: bool) -> IngestionJobStatus | None:
    status = IngestionJobStatus.model_validate_json(status_json)
    if not (stale and _is_live(status)):
        return status
    return _settle_lost(conn, url, status) or _read(conn, status.job_id)


def find_live(dispatch_key: str) -> IngestionJobStatus | None:
    url = _db_url()
    if not url or not dispatch_key:
        return None
    try:
        _ensure_table(url)
        engine = DocumentMetadataStore._get_or_create_sync_engine(url)
        with engine.connect() as conn:
            rows = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(
                    f"SELECT status_json, {_stale_predicate(url)} AS stale FROM ingest_jobs "
                    "WHERE dispatch_key = :key ORDER BY updated_at DESC LIMIT 5"
                ),
                {"key": dispatch_key},
            ).all()
            for status_json, stale in rows:
                status = IngestionJobStatus.model_validate_json(status_json)
                if not _is_live(status):
                    continue
                if not stale:
                    return status
                if _settle_lost(conn, url, status) is not None:
                    continue
                current = _read(conn, status.job_id)
                if current is not None and _is_live(current):
                    return current
    except Exception:
        logger.warning("Could not look up a live ingest job (continuing)", exc_info=True)
    return None


def fail_interrupted() -> int:
    url = _db_url()
    if not url:
        return 0
    settled = 0
    try:
        _ensure_table(url)
        engine = DocumentMetadataStore._get_or_create_sync_engine(url)
        with engine.connect() as conn:
            rows = (
                conn.execute(
                    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                    text(
                        f"SELECT status_json FROM ingest_jobs WHERE {_stale_predicate(url)} "
                        f"ORDER BY updated_at DESC LIMIT {_SWEEP_LIMIT}"
                    )
                )
                .scalars()
                .all()
            )
            live = [status for status in map(IngestionJobStatus.model_validate_json, rows) if _is_live(status)]
            settled = sum(_settle_lost(conn, url, status) is not None for status in live)
    except Exception:
        logger.warning("Could not settle interrupted ingest jobs (continuing)", exc_info=True)
    return settled


_IN_FLIGHT_SCAN_LIMIT = 200


def in_flight_files(collections: Iterable[str]) -> dict[str, list[str]]:
    wanted = {c for c in collections if c}
    if not wanted:
        return {}
    url = _db_url()
    if not url:
        return {}
    try:
        _ensure_table(url)
        engine = DocumentMetadataStore._get_or_create_sync_engine(url)
        with engine.connect() as conn:
            rows = (
                conn.execute(
                    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                    text(
                        "SELECT status_json FROM ingest_jobs "
                        f"WHERE NOT {_stale_predicate(url)} "
                        "ORDER BY updated_at DESC "
                        f"LIMIT {_IN_FLIGHT_SCAN_LIMIT}"
                    )
                )
                .scalars()
                .all()
            )
    except Exception:
        logger.warning("Could not read in-flight ingest jobs (continuing)", exc_info=True)
        return {}

    pending: dict[str, list[str]] = {}
    for row in rows:
        try:
            status = IngestionJobStatus.model_validate_json(row)
        except Exception:  # noqa: BLE001 - one unreadable row must not cost the rest
            continue
        if status.collection_name not in wanted:
            continue
        if status.status not in (JobState.PENDING, JobState.PROCESSING):
            continue
        names = [
            detail.file_name
            for detail in status.file_details
            if detail.status not in (FileStatus.SUCCESS, FileStatus.FAILED) and detail.file_name
        ]
        bucket = pending.setdefault(status.collection_name, [])
        for name in names:
            if name not in bucket:
                bucket.append(name)
    return pending


def _submitted(status: IngestionJobStatus) -> datetime:
    return status.submitted_at.replace(tzinfo=None)


def collection_jobs(collection_name: str, within_seconds: int) -> list[IngestionJobStatus]:
    url = _db_url()
    if not url:
        return []
    _ensure_table(url)
    engine = DocumentMetadataStore._get_or_create_sync_engine(url)
    with engine.connect() as conn:
        rows = conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(
                f"SELECT status_json, {_stale_predicate(url)} AS stale FROM ingest_jobs "
                f"WHERE collection_name = :collection_name AND updated_at > {_ago(url, int(within_seconds))}"
            ),
            {"collection_name": collection_name},
        ).all()
        seen = [_as_read(conn, url, status_json, stale) for status_json, stale in rows]
    return sorted((status for status in seen if status is not None), key=lambda s: (_submitted(s), s.job_id))


def forget_file(collection_name: str, file_name: str) -> int:
    url = _db_url()
    if not url:
        return 0
    _ensure_table(url)
    engine = DocumentMetadataStore._get_or_create_sync_engine(url)
    forgotten = 0
    with engine.connect() as conn:
        rows = conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(
                f"SELECT status_json, {_stale_predicate(url)} AS stale FROM ingest_jobs "
                "WHERE collection_name = :collection_name"
            ),
            {"collection_name": collection_name},
        ).all()
        for status_json, stale in rows:
            status = _as_read(conn, url, status_json, stale)
            if status is None or _is_live(status):
                continue
            kept = [detail for detail in status.file_details if detail.file_name != file_name]
            if len(kept) == len(status.file_details):
                continue
            if kept:
                status.file_details = kept
                conn.execute(
                    text("UPDATE ingest_jobs SET status_json = :status_json WHERE job_id = :job_id"),
                    {"job_id": status.job_id, "status_json": status.model_dump_json(warnings=False)},
                )
            else:
                conn.execute(text("DELETE FROM ingest_jobs WHERE job_id = :job_id"), {"job_id": status.job_id})
            forgotten += 1
        conn.commit()
    return forgotten


def forget_collection(collection_name: str) -> None:
    url = _db_url()
    if not url:
        return
    try:
        _ensure_table(url)
        engine = DocumentMetadataStore._get_or_create_sync_engine(url)
        with engine.connect() as conn:
            conn.execute(
                text("DELETE FROM ingest_jobs WHERE collection_name = :collection_name"),
                {"collection_name": collection_name},
            )
            conn.commit()
    except Exception:
        logger.warning("Failed to forget the ingest jobs of collection %s", collection_name, exc_info=True)


def prune_expired(older_than_seconds: int) -> int:
    url = _db_url()
    if not url:
        return 0
    try:
        _ensure_table(url)
        engine = DocumentMetadataStore._get_or_create_sync_engine(url)
        with engine.connect() as conn:
            deleted = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(
                    f"DELETE FROM ingest_jobs WHERE updated_at < {_ago(url, int(older_than_seconds))} "
                    f"AND {_stale_predicate(url)}"
                )
            ).rowcount
            conn.commit()
    except Exception:
        logger.warning("Could not prune expired ingest jobs (continuing)", exc_info=True)
        return 0
    return deleted


def delete(job_id: str) -> None:
    url = _db_url()
    if not url:
        return
    try:
        _ensure_table(url)
        engine = DocumentMetadataStore._get_or_create_sync_engine(url)
        with engine.connect() as conn:
            conn.execute(text("DELETE FROM ingest_jobs WHERE job_id = :job_id"), {"job_id": job_id})
            conn.commit()
    except Exception:
        logger.warning("Failed to delete ingest status for %s", job_id, exc_info=True)
