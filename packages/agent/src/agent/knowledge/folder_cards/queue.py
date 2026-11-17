"""The folder card builder's state: which folders are dirty, and what it keeps per collection and card (ADR-0127).

Four small tables in the agent database, beside ``document_metadata``. This module
creates them at first use (``ensure_schema``); no migration owns them.

* ``folder_card_queue``: the dirty set, one row per dirty folder,
  ``(collection, folder_path)``. :func:`mark` writes a folder and every ancestor in
  one statement; a second mark moves ``marked_at`` and keeps ``dirty_since``, so a
  burst of 200 uploads is one row per folder, not 200. :func:`due` names the
  folders that have been quiet for :data:`QUIET_SECONDS`, or dirty for
  :data:`MAX_DIRTY_SECONDS` whatever happens, deepest first, and never a folder
  while a folder below it is still dirty: a card is built from its children's
  cards, so the children go first.
* ``folder_card_collections``: the organization each collection belongs to, as the
  builder learned it, and when the collection was last reconciled. The BFF route
  takes the organization in its body; a mark made outside an ingest (a folder
  move through a route) may not know it.
* ``folder_card_usage``: tokens spent per organization and month, the budget the
  builder checks before every model call.
* ``folder_card_manifests``: per card, the inputs it was written from
  (``incremental.Manifest`` as JSON), so the next build updates it from a diff. It
  lives here, beside the rest of the builder's state, rather than on the BFF's
  card row: it is the builder's bookkeeping, nothing a reader needs, and no BFF
  migration is needed for it. Lost, it costs one full rebuild.

**This is no job queue any more** (ADR-0150). Until November 2026 the dirty set
was also one: a claim (``claimed_at``), a reclaim of claims older than 900 s with
no heartbeat, an attempt counter and a polling loop in every ingest worker.
Hatchet does that now (``workflow``): it holds the run, retries it and counts its
attempts, and one live run per collection is its idempotency key.

Why the dirty set stays ours: it is a record three rules read, and none of them
is an engine feature. The debounce (two clocks per folder, moved by every mark),
the order (a parent waits for every dirty folder below it), and the dedupe of a
burst into one row. A folder path is also a name a person chose, which Hatchet's
database must never hold; the run carries the collection and the organization.

``attempts`` is ours again, with a new meaning: how many runs of the folder's
collection failed for good while the folder was dirty (:func:`defer`). After
:data:`GIVE_UP_ROUNDS` of them the folder leaves the set until the nightly
reconcile marks it again, so a build that dies on every attempt is tried a few
times a day, not every quiet period for ever.

``claimed_at`` is dead: nothing here creates, reads or writes it, and a table
made before November 2026 still has it. It is deliberately not dropped yet.
Production runs the release whose claim loop reads it, and this module's
``ensure_schema`` runs in the first new pod of a rollout: a drop there would
break every old pod's claim until the rollout ends. Drop it in
``_create_tables`` in the release after the one that removes the claim loop is
on production (``docs/deployment/hatchet.md``, "Folder cards need no
re-dispatch").

Plain SQL both SQLite (the tests) and PostgreSQL speak; times are epoch seconds.
"""

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

#: A folder is built once nothing marked it for this long (an import of 200 files is one build).
QUIET_SECONDS = 600
#: ... or once it has been dirty this long, however busy it stays.
MAX_DIRTY_SECONDS = 3600
#: Runs that may fail for good over a dirty folder before it leaves the set until the nightly reconcile.
GIVE_UP_ROUNDS = 3

_lock = threading.Lock()
_ensured: set[str] = set()


@dataclass(frozen=True)
class Due:
    """One folder that is due: quiet long enough, and nothing below it still dirty."""

    collection: str
    folder_path: str
    organization_id: str | None
    depth: int


def ancestors(folder_path: str) -> list[str]:
    """``a/b/c`` → ``["a/b/c", "a/b", "a"]``. The root is no folder and has no card. Pure."""
    parts = [part for part in (folder_path or "").strip().strip("/").split("/") if part]
    return ["/".join(parts[:count]) for count in range(len(parts), 0, -1)]


def parent_of(folder_path: str) -> str | None:
    """The folder above, or ``None`` at the top level. Pure."""
    chain = ancestors(folder_path)
    return chain[1] if len(chain) > 1 else None


def _depth(folder_path: str) -> int:
    return len(ancestors(folder_path))


def month_of(now: float) -> str:
    return datetime.fromtimestamp(now, tz=UTC).strftime("%Y-%m")


# ---------------------------------------------------------------------------
# Engine and schema
# ---------------------------------------------------------------------------


def db_url() -> str:
    """The agent database: the one ``document_metadata`` lives in."""
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
    """A transaction on the agent database (or on ``url``, a test's)."""
    return _engine(url or db_url()).begin()


def _execute(conn, statement: str, values: Any = None):
    """Run one statement. Callers interpolate module constants only; every value is bound."""
    from sqlalchemy import text

    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
    return conn.execute(text(statement), values)


def _read(statement: str, values: dict[str, Any], url: str | None) -> list[Any]:
    with _begin(url) as conn:
        return _execute(conn, statement, values).fetchall()


def _write(statement: str, values: Any, url: str | None) -> int:
    """One statement in a transaction of its own; how many rows it touched."""
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
        # No database default (a table made before November 2026 has none either): ``mark`` writes the zero.
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


# ---------------------------------------------------------------------------
# The dirty set
# ---------------------------------------------------------------------------


def mark(
    collection: str,
    folder_paths: Iterable[str],
    organization_id: str | None = None,
    *,
    with_ancestors: bool = True,
    now: float | None = None,
    url: str | None = None,
) -> int:
    """Mark each folder (and, by default, every folder above it) dirty; how many rows were written."""
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
    """The folders that are due, of ``collection`` or of every collection: deepest first, then longest dirty.

    Reading changes nothing: a folder stays in the set until :func:`finish` or
    :func:`drop`. Who builds it, and that nobody else does meanwhile, is the
    run's business (``workflow``: one live run per collection).
    """
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
    """The folder is built from what it held at ``started``: the row goes, unless it was marked since."""
    keys = {"collection": collection, "path": folder_path, "started": started}
    where = "WHERE collection = :collection AND folder_path = :path"
    with _begin(url) as conn:
        if not _execute(conn, f"DELETE FROM {QUEUE_TABLE} {where} AND marked_at <= :started", keys).rowcount:
            # Marked during the build, which passed: a new quiet period starts from that mark, with no failed run.
            _execute(conn, f"UPDATE {QUEUE_TABLE} SET dirty_since = marked_at, attempts = 0 {where}", keys)


def drop(collection: str, folder_path: str | None = None, *, url: str | None = None) -> int:
    """Take a folder out of the set whatever marked it, or every folder of ``collection``; how many went.

    For a folder given up after its run's last attempt, and for a collection
    whose organization lost the flag or cannot be named.
    """
    scope = "" if folder_path is None else " AND folder_path = :path"
    return _write(
        f"DELETE FROM {QUEUE_TABLE} WHERE collection = :collection{scope}",
        {"collection": collection, "path": folder_path},
        url,
    )


def defer(collection: str, *, now: float | None = None, url: str | None = None) -> tuple[int, int]:
    """A run of ``collection`` failed for good without settling its folders: ``(deferred, dropped)`` rows.

    Every dirty folder counts the run and starts both clocks again, so the next
    run waits out a quiet period and a build that cannot pass is no tight loop.
    A folder that counted :data:`GIVE_UP_ROUNDS` of them is dropped instead.
    """
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
    """``(folder_path, dirty_since, marked_at)`` of a collection's rows: what is waiting, for an operator or a test."""
    rows = _read(
        f"SELECT folder_path, dirty_since, marked_at FROM {QUEUE_TABLE} "
        "WHERE collection = :collection ORDER BY folder_path",
        {"collection": collection},
        url,
    )
    return [(row[0], float(row[1]), float(row[2])) for row in rows]


# ---------------------------------------------------------------------------
# Which organization a collection belongs to
# ---------------------------------------------------------------------------


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
    """``(collection, organization_id)`` not reconciled in the last ``older_than`` seconds."""
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


# ---------------------------------------------------------------------------
# The monthly budget
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# What each card was written from
# ---------------------------------------------------------------------------

_MANIFEST_KEY = "WHERE collection = :collection AND folder_path = :path"


def get_manifest(collection: str, folder_path: str, *, url: str | None = None) -> str | None:
    """The stored manifest's JSON, or ``None``."""
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
