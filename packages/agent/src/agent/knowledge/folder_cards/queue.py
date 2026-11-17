from __future__ import annotations

import threading
import time
from collections.abc import Iterable
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC
from datetime import datetime
from typing import Any

from agent.common.db_utils import ensure_schema

QUEUE_TABLE = "folder_card_queue"
COLLECTIONS_TABLE = "folder_card_collections"
USAGE_TABLE = "folder_card_usage"
MANIFEST_TABLE = "folder_card_manifests"

QUIET_SECONDS = 600
MAX_DIRTY_SECONDS = 3600
GIVE_UP_ROUNDS = 3

_lock = threading.Lock()
_ensured: set[str] = set()


@dataclass(frozen=True)
class Due:
    collection: str
    folder_path: str
    organization_id: str | None
    depth: int


def ancestors(folder_path: str) -> list[str]:
    parts = [part for part in (folder_path or "").strip().strip("/").split("/") if part]
    return ["/".join(parts[:count]) for count in range(len(parts), 0, -1)]


def parent_of(folder_path: str) -> str | None:
    chain = ancestors(folder_path)
    return chain[1] if len(chain) > 1 else None


def _depth(folder_path: str) -> int:
    return len(ancestors(folder_path))


def month_of(now: float) -> str:
    return datetime.fromtimestamp(now, tz=UTC).strftime("%Y-%m")


def db_url() -> str:
    from agent.knowledge.factory import _get_document_metadata_store

    return _get_document_metadata_store().db_url


def _engine(url: str):
    from agent.knowledge.document_metadata_store import DocumentMetadataStore

    engine = DocumentMetadataStore._get_or_create_sync_engine(url)
    with _lock:
        if url not in _ensured:
            ensure_schema(engine, QUEUE_TABLE, _create_tables)
            _ensured.add(url)
    return engine


def _begin(url: str | None):
    return _engine(url or db_url()).begin()


def _execute(conn, statement: str, values: Any = None):
    from sqlalchemy import text

    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
    return conn.execute(text(statement), values)


def _read(statement: str, values: dict[str, Any], url: str | None) -> list[Any]:
    with _begin(url) as conn:
        return _execute(conn, statement, values).fetchall()


def _write(statement: str, values: Any, url: str | None) -> int:
    with _begin(url) as conn:
        return _execute(conn, statement, values).rowcount


def _create_tables(conn) -> None:
    from sqlalchemy import Column
    from sqlalchemy import Float
    from sqlalchemy import Index
    from sqlalchemy import Integer
    from sqlalchemy import MetaData
    from sqlalchemy import String
    from sqlalchemy import Table
    from sqlalchemy import Text

    metadata = MetaData()
    Table(
        QUEUE_TABLE,
        metadata,
        Column("collection", String(255), primary_key=True),
        Column("folder_path", Text, primary_key=True),
        Column("organization_id", String(255), nullable=True),
        Column("depth", Integer, nullable=False),
        Column("dirty_since", Float, nullable=False),
        Column("marked_at", Float, nullable=False),
        Column("attempts", Integer, nullable=False),
        Index("ix_folder_card_queue_marked", "marked_at"),
    )
    Table(
        COLLECTIONS_TABLE,
        metadata,
        Column("collection", String(255), primary_key=True),
        Column("organization_id", String(255), nullable=False),
        Column("reconciled_at", Float, nullable=True),
    )
    Table(
        USAGE_TABLE,
        metadata,
        Column("organization_id", String(255), primary_key=True),
        Column("month", String(7), primary_key=True),
        Column("tokens", Integer, nullable=False, default=0),
    )
    Table(
        MANIFEST_TABLE,
        metadata,
        Column("collection", String(255), primary_key=True),
        Column("folder_path", Text, primary_key=True),
        Column("manifest", Text, nullable=False),
    )
    metadata.create_all(conn, checkfirst=True)


def mark(
    collection: str,
    folder_paths: Iterable[str],
    organization_id: str | None = None,
    *,
    with_ancestors: bool = True,
    now: float | None = None,
    url: str | None = None,
) -> int:
    paths: set[str] = set()
    for path in folder_paths:
        chain = ancestors(path)
        paths.update(chain if with_ancestors else chain[:1])
    if not collection or not paths:
        return 0
    stamp = time.time() if now is None else now
    rows = [
        {
            "collection": collection,
            "folder_path": path,
            "organization_id": organization_id,
            "depth": _depth(path),
            "now": stamp,
        }
        for path in sorted(paths)
    ]
    _write(
        f"INSERT INTO {QUEUE_TABLE} "
        "(collection, folder_path, organization_id, depth, dirty_since, marked_at, attempts) "
        "VALUES (:collection, :folder_path, :organization_id, :depth, :now, :now, 0) "
        "ON CONFLICT (collection, folder_path) DO UPDATE SET marked_at = excluded.marked_at, "
        f"organization_id = COALESCE(excluded.organization_id, {QUEUE_TABLE}.organization_id)",
        rows,
        url,
    )
    return len(rows)


def _has_queued_descendant(path: str, queued: Sequence[str]) -> bool:
    prefix = f"{path}/"
    return any(other.startswith(prefix) for other in queued)


def due(collection: str | None = None, *, now: float | None = None, url: str | None = None) -> list[Due]:
    stamp = time.time() if now is None else now
    scope = "AND collection = :collection " if collection else ""
    with _begin(url) as conn:
        rows = _execute(
            conn,
            f"SELECT collection, folder_path, organization_id, depth FROM {QUEUE_TABLE} "
            f"WHERE (marked_at <= :quiet OR dirty_since <= :overdue) {scope}"
            "ORDER BY depth DESC, dirty_since ASC, folder_path ASC",
            {"quiet": stamp - QUIET_SECONDS, "overdue": stamp - MAX_DIRTY_SECONDS, "collection": collection},
        ).fetchall()
        dirty = {name: _dirty_paths(conn, name) for name in sorted({row[0] for row in rows})}
    return [
        Due(name, path, organization_id, int(depth))
        for name, path, organization_id, depth in rows
        if not _has_queued_descendant(path, dirty[name])
    ]


def _dirty_paths(conn, collection: str) -> list[str]:
    statement = f"SELECT folder_path FROM {QUEUE_TABLE} WHERE collection = :collection"
    return [row[0] for row in _execute(conn, statement, {"collection": collection}).fetchall()]


def finish(collection: str, folder_path: str, started: float, *, url: str | None = None) -> None:
    keys = {"collection": collection, "path": folder_path, "started": started}
    where = "WHERE collection = :collection AND folder_path = :path"
    with _begin(url) as conn:
        if not _execute(conn, f"DELETE FROM {QUEUE_TABLE} {where} AND marked_at <= :started", keys).rowcount:
            _execute(conn, f"UPDATE {QUEUE_TABLE} SET dirty_since = marked_at, attempts = 0 {where}", keys)


def drop(collection: str, folder_path: str | None = None, *, url: str | None = None) -> int:
    scope = "" if folder_path is None else " AND folder_path = :path"
    return _write(
        f"DELETE FROM {QUEUE_TABLE} WHERE collection = :collection{scope}",
        {"collection": collection, "path": folder_path},
        url,
    )


def defer(collection: str, *, now: float | None = None, url: str | None = None) -> tuple[int, int]:
    values = {"collection": collection, "now": time.time() if now is None else now, "last": GIVE_UP_ROUNDS - 1}
    where = "WHERE collection = :collection"
    with _begin(url) as conn:
        dropped = _execute(conn, f"DELETE FROM {QUEUE_TABLE} {where} AND attempts >= :last", values).rowcount
        deferred = _execute(
            conn,
            f"UPDATE {QUEUE_TABLE} SET marked_at = :now, dirty_since = :now, attempts = attempts + 1 {where}",
            values,
        ).rowcount
    return deferred, dropped


def queued(collection: str, *, url: str | None = None) -> list[tuple[str, float, float]]:
    rows = _read(
        f"SELECT folder_path, dirty_since, marked_at FROM {QUEUE_TABLE} "
        "WHERE collection = :collection ORDER BY folder_path",
        {"collection": collection},
        url,
    )
    return [(row[0], float(row[1]), float(row[2])) for row in rows]


def remember_collection(collection: str, organization_id: str, *, url: str | None = None) -> None:
    _write(
        f"INSERT INTO {COLLECTIONS_TABLE} (collection, organization_id, reconciled_at) "
        "VALUES (:collection, :organization_id, NULL) "
        "ON CONFLICT (collection) DO UPDATE SET organization_id = excluded.organization_id",
        {"collection": collection, "organization_id": organization_id},
        url,
    )


def organization_of(collection: str, *, url: str | None = None) -> str | None:
    statement = f"SELECT organization_id FROM {COLLECTIONS_TABLE} WHERE collection = :collection"
    rows = _read(statement, {"collection": collection}, url)
    return rows[0][0] if rows else None


def collections_due_for_reconcile(
    older_than: float, *, now: float | None = None, url: str | None = None
) -> list[tuple[str, str]]:
    rows = _read(
        f"SELECT collection, organization_id FROM {COLLECTIONS_TABLE} "
        "WHERE reconciled_at IS NULL OR reconciled_at < :before ORDER BY collection",
        {"before": (time.time() if now is None else now) - older_than},
        url,
    )
    return [(row[0], row[1]) for row in rows]


def set_reconciled(collection: str, *, now: float | None = None, url: str | None = None) -> None:
    _write(
        f"UPDATE {COLLECTIONS_TABLE} SET reconciled_at = :now WHERE collection = :collection",
        {"collection": collection, "now": time.time() if now is None else now},
        url,
    )


def tokens_used(organization_id: str, *, now: float | None = None, url: str | None = None) -> int:
    rows = _read(
        f"SELECT tokens FROM {USAGE_TABLE} WHERE organization_id = :organization_id AND month = :month",
        {"organization_id": organization_id, "month": month_of(time.time() if now is None else now)},
        url,
    )
    return int(rows[0][0]) if rows else 0


def add_tokens(organization_id: str, tokens: int, *, now: float | None = None, url: str | None = None) -> None:
    if tokens <= 0:
        return
    _write(
        f"INSERT INTO {USAGE_TABLE} (organization_id, month, tokens) "
        "VALUES (:organization_id, :month, :tokens) "
        f"ON CONFLICT (organization_id, month) DO UPDATE SET tokens = {USAGE_TABLE}.tokens + excluded.tokens",
        {"organization_id": organization_id, "month": month_of(time.time() if now is None else now), "tokens": tokens},
        url,
    )


_MANIFEST_KEY = "WHERE collection = :collection AND folder_path = :path"


def get_manifest(collection: str, folder_path: str, *, url: str | None = None) -> str | None:
    statement = f"SELECT manifest FROM {MANIFEST_TABLE} {_MANIFEST_KEY}"
    rows = _read(statement, {"collection": collection, "path": folder_path}, url)
    return rows[0][0] if rows else None


def put_manifest(collection: str, folder_path: str, manifest: str, *, url: str | None = None) -> None:
    _write(
        f"INSERT INTO {MANIFEST_TABLE} (collection, folder_path, manifest) "
        "VALUES (:collection, :path, :manifest) "
        "ON CONFLICT (collection, folder_path) DO UPDATE SET manifest = excluded.manifest",
        {"collection": collection, "path": folder_path, "manifest": manifest},
        url,
    )


def delete_manifest(collection: str, folder_path: str, *, url: str | None = None) -> None:
    _write(f"DELETE FROM {MANIFEST_TABLE} {_MANIFEST_KEY}", {"collection": collection, "path": folder_path}, url)
