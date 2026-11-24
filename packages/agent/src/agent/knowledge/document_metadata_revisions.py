from __future__ import annotations

import json
from collections.abc import Callable
from typing import TYPE_CHECKING
from typing import Any

if TYPE_CHECKING:
    pass

from agent.knowledge import document_metadata_store as facade
from agent.knowledge.document_metadata_constants import TABLE_NAME
from agent.knowledge.document_metadata_constants import logger
from agent.knowledge.document_metadata_helpers import LinkOutcome
from agent.knowledge.document_metadata_helpers import _link_lock_key
from agent.knowledge.document_metadata_helpers import _LinkRow
from agent.knowledge.document_metadata_helpers import _merged_suggestion
from agent.knowledge.document_metadata_helpers import _set_columns
from agent.knowledge.document_metadata_helpers import _with_refusal


def set_superseded_by(store, collection: str, older: str, newer: str | None) -> bool:
    return store._update_column(collection, older, "superseded_by", newer or None)


def set_revision_suggestion(store, collection: str, filename: str, suggestion: dict[str, Any] | None) -> bool:
    normalised = None
    if suggestion is not None:
        normalised = store._normalise_suggestion(suggestion)
        if normalised is None:
            logger.warning("Refused an invalid revision suggestion for %s", filename)
            return False
    return store._rewrite_suggestion(collection, filename, lambda stored: _merged_suggestion(stored, normalised))


def dismiss_revision_suggestion(store, collection: str, filename: str, older: str) -> bool:
    if not older.strip():
        return False
    return store._rewrite_suggestion(collection, filename, lambda stored: _with_refusal(stored, older))


def _rewrite_suggestion(
    store, collection: str, filename: str, rewrite: Callable[[dict[str, Any] | None], dict[str, Any] | None]
) -> bool:
    from sqlalchemy import text

    params = {"collection": collection, "filename": filename}
    try:
        with store._sync_engine.begin() as conn:
            row = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(
                    f"SELECT revision_suggestion FROM {TABLE_NAME} "
                    "WHERE collection = :collection AND filename = :filename"
                ),
                params,
            ).first()
            if row is None:
                return False
            written = rewrite(store._decode_suggestion(row[0]))
            conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(
                    f"UPDATE {TABLE_NAME} SET revision_suggestion = :value "
                    "WHERE collection = :collection AND filename = :filename"
                ),
                {**params, "value": json.dumps(written) if written else None},
            )
            return True
    except Exception as e:
        logger.warning("Failed to write the revision suggestion for %s: %s", filename, e)
        return False


def link_revision(store, collection: str, older: str, newer: str) -> LinkOutcome:
    if store._is_postgres():
        return store._link_revision_locked(collection, older, newer)
    with facade.DocumentMetadataStore._link_lock:
        return store._link_revision_locked(collection, older, newer)


def _link_revision_locked(store, collection: str, older: str, newer: str) -> LinkOutcome:
    from sqlalchemy import text

    from .document_revisions import would_loop

    with store._sync_engine.begin() as conn:
        if conn.dialect.name == "postgresql":
            conn.execute(
                text("SELECT pg_advisory_xact_lock(CAST(:key AS bigint))"), {"key": _link_lock_key(collection)}
            )
        rows = {
            row[0]: _LinkRow(row[1], row[2], row[3])
            for row in conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(
                    f"SELECT filename, superseded_by, change_basis, revision_suggestion FROM {TABLE_NAME} "
                    "WHERE collection = :collection"
                ),
                {"collection": collection},
            )
        }
        if older not in rows:
            return LinkOutcome.MISSING
        if would_loop(rows, newer=newer, older=older):
            return LinkOutcome.LOOP
        store._write_link(conn, collection, older, newer, rows)
    return LinkOutcome.LINKED


def _write_link(store, conn, collection: str, older: str, newer: str, rows: dict[str, _LinkRow]) -> None:
    _set_columns(conn, collection, older, superseded_by=newer)
    previous = rows[older].superseded_by
    if previous and previous != newer and previous in rows and rows[previous].change_basis == older:
        _set_columns(conn, collection, previous, change_summary=None, change_basis=None)
    own = rows.get(newer)
    stored = store._decode_suggestion(own.revision_suggestion) if own is not None else None
    if stored is not None and stored["of"] == older and not stored["dismissed"]:
        kept = _merged_suggestion(stored, None)
        _set_columns(conn, collection, newer, revision_suggestion=json.dumps(kept) if kept else None)


def get_superseded_by_batch(store, collection: str, filenames: list[str]) -> dict[str, str]:
    return store._get_column_batch(collection, filenames, "superseded_by")


def files_linked_to(store, collection: str, newer: str) -> list[str]:
    from sqlalchemy import text

    try:
        with store._sync_engine.connect() as conn:
            rows = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(f"SELECT filename FROM {TABLE_NAME} WHERE collection = :collection AND superseded_by = :newer"),
                {"collection": collection, "newer": newer},
            )
            return sorted(row[0] for row in rows)
    except Exception as e:
        logger.warning("Failed to read the files linked to %s in %s: %s", newer, collection, e)
        return []


def get_superseded_files(store, collection: str) -> dict[str, str]:
    from sqlalchemy import text

    try:
        with store._sync_engine.connect() as conn:
            rows = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(
                    f"SELECT older.filename, older.superseded_by FROM {TABLE_NAME} older "
                    "WHERE older.collection = :collection AND older.superseded_by IS NOT NULL "
                    f"AND EXISTS (SELECT 1 FROM {TABLE_NAME} newer "
                    "WHERE newer.collection = older.collection AND newer.filename = older.superseded_by)"
                ),
                {"collection": collection},
            )
            return {row[0]: row[1] for row in rows}
    except Exception as e:
        logger.warning("Failed to read the replaced files of %s: %s", collection, e)
        return {}


def get_revision_suggestions_batch(store, collection: str, filenames: list[str]) -> dict[str, str]:
    return store._get_column_batch(collection, filenames, "revision_suggestion")
