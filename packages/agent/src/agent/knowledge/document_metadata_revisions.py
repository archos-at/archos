from __future__ import annotations

import json
from collections.abc import Callable
from collections.abc import Mapping
from typing import TYPE_CHECKING
from typing import Any

if TYPE_CHECKING:
    pass

from agent.knowledge import document_metadata_store as facade
from agent.knowledge.document_metadata_constants import TABLE_NAME
from agent.knowledge.document_metadata_constants import logger
from agent.knowledge.document_metadata_constants import DocumentRef
from agent.knowledge.document_metadata_helpers import LinkOutcome
from agent.knowledge.document_metadata_helpers import _link_lock_key
from agent.knowledge.document_metadata_helpers import _LinkRow
from agent.knowledge.document_metadata_helpers import _match
from agent.knowledge.document_metadata_helpers import _merged_suggestion
from agent.knowledge.document_metadata_helpers import _set_columns
from agent.knowledge.document_metadata_helpers import _stamp
from agent.knowledge.document_metadata_helpers import _with_refusal
from agent.knowledge.document_metadata_helpers import link_rows
from agent.knowledge.document_metadata_helpers import names_older
from agent.knowledge.document_metadata_helpers import node_key
from agent.knowledge.document_metadata_helpers import resolve_node


def set_superseded_by(
    store,
    collection: str,
    older: str,
    newer: str | None,
    *,
    document_id: str | None = None,
    newer_id: str | None = None,
) -> bool:
    from sqlalchemy import text

    where, keyed = _match(older, document_id)
    try:
        with store._sync_engine.begin() as conn:
            result = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(
                    f"UPDATE {TABLE_NAME} SET superseded_by = :newer, superseded_by_id = :newer_id{_stamp(document_id)} "
                    f"WHERE collection = :collection AND {where}"
                ),
                {"newer": newer or None, "newer_id": (newer_id or None) if newer else None, "collection": collection}
                | keyed,
            )
            return (result.rowcount or 0) > 0
    except Exception as e:
        logger.warning("Failed to set the newer Fassung of %s: %s", older, e)
        return False


def set_revision_suggestion(
    store, collection: str, filename: str, suggestion: dict[str, Any] | None, *, document_id: str | None = None
) -> bool:
    normalised = None
    if suggestion is not None:
        normalised = store._normalise_suggestion(suggestion)
        if normalised is None:
            logger.warning("Refused an invalid revision suggestion for %s", filename)
            return False
    return store._rewrite_suggestion(
        collection, filename, lambda stored: _merged_suggestion(stored, normalised), document_id=document_id
    )


def dismiss_revision_suggestion(
    store,
    collection: str,
    filename: str,
    older: str,
    *,
    document_id: str | None = None,
    older_id: str | None = None,
) -> bool:
    if not older.strip():
        return False
    return store._rewrite_suggestion(
        collection, filename, lambda stored: _with_refusal(stored, older, older_id), document_id=document_id
    )


def _rewrite_suggestion(
    store,
    collection: str,
    filename: str,
    rewrite: Callable[[dict[str, Any] | None], dict[str, Any] | None],
    *,
    document_id: str | None = None,
) -> bool:
    from sqlalchemy import text

    where, keyed = _match(filename, document_id)
    params = {"collection": collection, **keyed}
    try:
        with store._sync_engine.begin() as conn:
            row = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(f"SELECT revision_suggestion FROM {TABLE_NAME} WHERE collection = :collection AND {where}"),
                params,
            ).first()
            if row is None:
                return False
            written = rewrite(store._decode_suggestion(row[0]))
            conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(
                    f"UPDATE {TABLE_NAME} SET revision_suggestion = :value{_stamp(document_id)} "
                    f"WHERE collection = :collection AND {where}"
                ),
                {**params, "value": json.dumps(written) if written else None},
            )
            return True
    except Exception as e:
        logger.warning("Failed to write the revision suggestion for %s: %s", filename, e)
        return False


def link_revision(
    store, collection: str, older: str, newer: str, *, older_id: str | None = None, newer_id: str | None = None
) -> LinkOutcome:
    if store._is_postgres():
        return store._link_revision_locked(collection, older, newer, older_id=older_id, newer_id=newer_id)
    with facade.DocumentMetadataStore._link_lock:
        return store._link_revision_locked(collection, older, newer, older_id=older_id, newer_id=newer_id)


def _locate(rows: Mapping[str, _LinkRow], file_name: str, document_id: str | None) -> str | None:
    node = resolve_node(rows, file_name, document_id)
    if document_id and node not in rows and node_key(file_name, None) in rows:
        return node_key(file_name, None)
    return node


def _link_revision_locked(
    store, collection: str, older: str, newer: str, *, older_id: str | None = None, newer_id: str | None = None
) -> LinkOutcome:
    from sqlalchemy import text

    from .document_revisions import would_loop

    with store._sync_engine.begin() as conn:
        if conn.dialect.name == "postgresql":
            conn.execute(
                text("SELECT pg_advisory_xact_lock(CAST(:key AS bigint))"), {"key": _link_lock_key(collection)}
            )
        rows = link_rows(
            conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(
                    "SELECT filename, document_id, superseded_by, superseded_by_id, change_basis, revision_suggestion "
                    f"FROM {TABLE_NAME} WHERE collection = :collection"
                ),
                {"collection": collection},
            )
        )
        older_node = _locate(rows, older, older_id)
        newer_node = _locate(rows, newer, newer_id)
        if older_node is None or older_node not in rows or newer_node is None:
            return LinkOutcome.MISSING
        if would_loop(rows, newer=newer_node, older=older_node):
            return LinkOutcome.LOOP
        store._write_link(conn, collection, older_node, newer_node, rows, newer_name=newer, newer_id=newer_id)
    return LinkOutcome.LINKED


def _write_link(
    store,
    conn,
    collection: str,
    older: str,
    newer: str,
    rows: dict[str, _LinkRow],
    *,
    newer_name: str,
    newer_id: str | None = None,
) -> None:
    own = rows.get(newer)
    linked_name = own.file_name if own is not None else newer_name
    linked_id = own.document_id if own is not None else newer_id
    older_row = rows[older]
    _set_columns(
        conn,
        collection,
        older_row.file_name,
        document_id=older_row.document_id,
        superseded_by=linked_name,
        superseded_by_id=linked_id,
    )
    previous = rows.get(older_row.superseded_by or "")
    if (
        previous is not None
        and older_row.superseded_by != newer
        and previous.change_basis == older_row.file_name
    ):
        _set_columns(
            conn, collection, previous.file_name, document_id=previous.document_id, change_summary=None, change_basis=None
        )
    stored = store._decode_suggestion(own.revision_suggestion) if own is not None else None
    if (
        own is not None
        and stored is not None
        and names_older(stored, older_row.file_name, older_row.document_id)
        and not stored["dismissed"]
    ):
        kept = _merged_suggestion(stored, None)
        _set_columns(
            conn,
            collection,
            own.file_name,
            document_id=own.document_id,
            revision_suggestion=json.dumps(kept) if kept else None,
        )


def get_superseded_by_batch(
    store, collection: str, filenames: list[str], *, document_ids: list[str] | None = None
) -> dict[str, str]:
    return store._get_column_batch(collection, filenames, "superseded_by", document_ids=document_ids)


def documents_linked_to(store, collection: str, newer: str, *, document_id: str | None = None) -> list[DocumentRef]:
    from sqlalchemy import text

    try:
        with store._sync_engine.connect() as conn:
            rows = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(
                    f"SELECT filename, document_id FROM {TABLE_NAME} WHERE collection = :collection "
                    "AND (superseded_by_id = :newer_id OR (superseded_by_id IS NULL AND superseded_by = :newer))"
                ),
                {"collection": collection, "newer": newer, "newer_id": document_id or ""},
            )
            return sorted(DocumentRef(row[0], row[1] or None) for row in rows)
    except Exception as e:
        logger.warning("Failed to read the files linked to %s in %s: %s", newer, collection, e)
        return []


def files_linked_to(store, collection: str, newer: str, *, document_id: str | None = None) -> list[str]:
    return [linked.file_name for linked in store.documents_linked_to(collection, newer, document_id=document_id)]


def get_superseded_files(store, collection: str) -> dict[str, str]:
    from sqlalchemy import text

    try:
        with store._sync_engine.connect() as conn:
            rows = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(
                    f"SELECT older.filename, older.superseded_by FROM {TABLE_NAME} older "
                    "WHERE older.collection = :collection AND older.superseded_by IS NOT NULL "
                    "AND (older.document_id IS NULL OR older.superseded_by_id IS NULL) "
                    f"AND EXISTS (SELECT 1 FROM {TABLE_NAME} newer "
                    "WHERE newer.collection = older.collection AND newer.filename = older.superseded_by)"
                ),
                {"collection": collection},
            )
            return {row[0]: row[1] for row in rows}
    except Exception as e:
        logger.warning("Failed to read the replaced files of %s: %s", collection, e)
        return {}


def get_superseded_ids(store, collection: str) -> dict[str, str]:
    from sqlalchemy import text

    try:
        with store._sync_engine.connect() as conn:
            rows = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(
                    f"SELECT older.document_id, older.superseded_by_id FROM {TABLE_NAME} older "
                    "WHERE older.collection = :collection AND older.document_id IS NOT NULL "
                    "AND older.superseded_by_id IS NOT NULL "
                    f"AND EXISTS (SELECT 1 FROM {TABLE_NAME} newer "
                    "WHERE newer.collection = older.collection AND newer.document_id = older.superseded_by_id)"
                ),
                {"collection": collection},
            )
            return {row[0]: row[1] for row in rows}
    except Exception as e:
        logger.warning("Failed to read the replaced documents of %s: %s", collection, e)
        return {}


def get_revision_suggestions_batch(
    store, collection: str, filenames: list[str], *, document_ids: list[str] | None = None
) -> dict[str, str]:
    return store._get_column_batch(collection, filenames, "revision_suggestion", document_ids=document_ids)
