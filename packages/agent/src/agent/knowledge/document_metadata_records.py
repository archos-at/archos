from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass

from agent.knowledge.document_metadata_constants import _RETAINED_COLUMNS
from agent.knowledge.document_metadata_constants import RETAINED_TABLE_NAME
from agent.knowledge.document_metadata_constants import TABLE_NAME
from agent.knowledge.document_metadata_constants import TAGS_SET_BY_PERSON
from agent.knowledge.document_metadata_constants import logger
from agent.knowledge.document_metadata_helpers import _match
from agent.knowledge.document_metadata_helpers import _person_made_facts
from agent.knowledge.document_metadata_helpers import link_rows
from agent.knowledge.document_metadata_helpers import resolve_node

_KEEP_PERSON_LISTS = (
    f"tags = CASE WHEN {TABLE_NAME}.tags_set_by = :person THEN {TABLE_NAME}.tags ELSE excluded.tags END, "
    f"topics = CASE WHEN {TABLE_NAME}.tags_set_by = :person THEN {TABLE_NAME}.topics ELSE excluded.topics END"
)


def register(
    store,
    collection: str,
    filename: str,
    summary: str,
    tags: list[str] | None = None,
    topics: list[str] | None = None,
    *,
    document_id: str | None = None,
) -> None:
    import json

    tags_json = json.dumps(tags) if tags else None
    topics_json = json.dumps(topics) if topics else None

    try:
        with store._sync_engine.connect() as conn:
            _upsert_metadata(conn, collection, filename, summary, tags_json, topics_json, document_id)
            store._take_back_retained(conn, collection, filename, document_id=document_id)
            conn.commit()
            logger.debug("Registered metadata for %s in %s", filename, collection)
    except Exception as e:
        logger.warning("Failed to register metadata for %s: %s", filename, e)


def _upsert_metadata(
    conn,
    collection: str,
    filename: str,
    summary: str,
    tags_json: str | None,
    topics_json: str | None,
    document_id: str | None = None,
) -> None:
    from sqlalchemy import text

    params = {
        "collection": collection,
        "filename": filename,
        "document_id": document_id,
        "summary": summary,
        "tags": tags_json,
        "topics": topics_json,
        "person": TAGS_SET_BY_PERSON,
    }
    if document_id:
        conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(
                f"INSERT INTO {TABLE_NAME} (collection, filename, document_id, summary, tags, topics) "
                "VALUES (:collection, :filename, :document_id, :summary, :tags, :topics) "
                "ON CONFLICT (collection, document_id) WHERE document_id IS NOT NULL DO UPDATE SET "
                f"filename = excluded.filename, summary = excluded.summary, {_KEEP_PERSON_LISTS}"
            ),
            params,
        )
        return
    updated = conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(
            f"UPDATE {TABLE_NAME} SET summary = :summary, "
            "tags = CASE WHEN tags_set_by = :person THEN tags ELSE :tags END, "
            "topics = CASE WHEN tags_set_by = :person THEN topics ELSE :topics END "
            "WHERE collection = :collection AND filename = :filename AND document_id IS NULL"
        ),
        params,
    )
    if (updated.rowcount or 0) > 0:
        return
    conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(
            f"INSERT INTO {TABLE_NAME} (collection, filename, summary, tags, topics) "
            "VALUES (:collection, :filename, :summary, :tags, :topics) "
            "ON CONFLICT (collection, filename) WHERE document_id IS NULL DO UPDATE SET "
            f"summary = excluded.summary, {_KEEP_PERSON_LISTS}"
        ),
        params,
    )


def _take_back_retained(store, conn, collection: str, filename: str, *, document_id: str | None = None) -> None:
    from sqlalchemy import text

    where, keyed = _match(filename, document_id)
    params = {"collection": collection, **keyed}
    kept = conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(
            f"SELECT {', '.join(_RETAINED_COLUMNS)} FROM {RETAINED_TABLE_NAME} "
            f"WHERE collection = :collection AND {where}"
        ),
        params,
    ).first()
    if kept is None:
        return
    kept = dict(zip(_RETAINED_COLUMNS, kept, strict=True))
    if (kept["superseded_by"] or kept["superseded_by_id"]) and store._closes_a_loop(
        conn, collection, filename, kept["superseded_by"], document_id=document_id, newer_id=kept["superseded_by_id"]
    ):
        kept["superseded_by"] = kept["superseded_by_id"] = None
    where, keyed = _match(filename, document_id)
    conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(
            f"UPDATE {TABLE_NAME} SET "
            "superseded_by_id = CASE WHEN superseded_by IS NULL THEN :superseded_by_id ELSE superseded_by_id END, "
            "superseded_by = COALESCE(superseded_by, :superseded_by), "
            "revision_suggestion = COALESCE(revision_suggestion, :revision_suggestion), "
            "change_basis = CASE WHEN change_summary IS NULL THEN :change_basis ELSE change_basis END, "
            "change_summary = COALESCE(change_summary, :change_summary) "
            f"WHERE collection = :collection AND {where}"
        ),
        {**kept, "collection": collection, **keyed},
    )
    store._forget_retained(conn, collection, filename, document_id=document_id)
    logger.info("Took back the Fassung facts kept for %s in %s", filename, collection)


def _closes_a_loop(
    conn,
    collection: str,
    older: str,
    newer: str | None,
    *,
    document_id: str | None = None,
    newer_id: str | None = None,
) -> bool:
    from sqlalchemy import text

    from .document_revisions import would_loop

    rows = link_rows(
        (*row, None, None)
        for row in conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(
                f"SELECT filename, document_id, superseded_by, superseded_by_id FROM {TABLE_NAME} "
                "WHERE collection = :collection"
            ),
            {"collection": collection},
        )
    )
    older_node = resolve_node(rows, older, document_id)
    newer_node = resolve_node(rows, newer, newer_id)
    if older_node is None or newer_node is None:
        return False
    return would_loop(rows, newer=newer_node, older=older_node)


def _forget_retained(conn, collection: str, filename: str, *, document_id: str | None = None) -> None:
    from sqlalchemy import text

    where, keyed = _match(filename, document_id)
    conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(f"DELETE FROM {RETAINED_TABLE_NAME} WHERE collection = :collection AND {where}"),
        {"collection": collection, **keyed},
    )


def unregister(
    store, collection: str, filename: str, *, permanent: bool = False, document_id: str | None = None
) -> None:
    from sqlalchemy import text

    where, keyed = _match(filename, document_id)
    try:
        with store._sync_engine.begin() as conn:
            if permanent:
                store._forget_links_to(conn, collection, filename, document_id=document_id)
            else:
                store._retain(conn, collection, filename, document_id=document_id)
            conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(f"DELETE FROM {TABLE_NAME} WHERE collection = :collection AND {where}"),
                {"collection": collection, **keyed},
            )
        logger.debug("Unregistered metadata for %s in %s (permanent=%s)", filename, collection, permanent)
    except Exception as e:
        logger.warning("Failed to unregister metadata for %s: %s", filename, e)


def _retain(store, conn, collection: str, filename: str, *, document_id: str | None = None) -> None:
    from sqlalchemy import text

    where, keyed = _match(filename, document_id)
    row = conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(
            f"SELECT document_id, {', '.join(_RETAINED_COLUMNS)} FROM {TABLE_NAME} "
            f"WHERE collection = :collection AND {where}"
        ),
        {"collection": collection, **keyed},
    ).first()
    kept = _person_made_facts(filename, dict(zip(_RETAINED_COLUMNS, row[1:], strict=True))) if row else None
    stored_id = (row[0] if row is not None else None) or document_id
    store._forget_retained(conn, collection, filename, document_id=stored_id)
    if kept is None:
        return
    conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(
            f"INSERT INTO {RETAINED_TABLE_NAME} (collection, filename, document_id, {', '.join(_RETAINED_COLUMNS)}) "
            "VALUES (:collection, :filename, :document_id, :superseded_by, :revision_suggestion, :change_summary, "
            ":change_basis, :superseded_by_id)"
        ),
        {"collection": collection, "filename": filename, "document_id": stored_id, **kept},
    )


def _forget_links_to(store, conn, collection: str, filename: str, *, document_id: str | None = None) -> None:
    from sqlalchemy import text

    store._forget_retained(conn, collection, filename, document_id=document_id)
    for table in (TABLE_NAME, RETAINED_TABLE_NAME):
        conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(
                f"UPDATE {table} SET superseded_by = NULL, superseded_by_id = NULL WHERE collection = :collection "
                "AND (superseded_by_id = :document_id OR (superseded_by_id IS NULL AND superseded_by = :filename))"
            ),
            {"collection": collection, "filename": filename, "document_id": document_id or ""},
        )


def _rename_in(conn, table: str, collection: str, document_id: str, file_name: str, previous: str) -> int:
    from sqlalchemy import text

    params = {"collection": collection, "document_id": document_id, "file_name": file_name}
    where, keyed = _match(previous, document_id)
    renamed = conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(
            f"UPDATE {table} SET filename = :file_name, document_id = :document_id "
            f"WHERE collection = :collection AND {where}"
        ),
        {**params, **keyed},
    )
    conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(
            f"UPDATE {table} SET superseded_by = :file_name, superseded_by_id = :document_id "
            "WHERE collection = :collection AND (superseded_by_id = :document_id "
            "OR (superseded_by_id IS NULL AND superseded_by = :previous))"
        ),
        {**params, "previous": previous},
    )
    return renamed.rowcount or 0


def set_file_name(
    store, collection: str, document_id: str, file_name: str, *, previous_file_name: str | None = None
) -> bool:
    previous = previous_file_name or ""
    try:
        with store._sync_engine.begin() as conn:
            renamed = _rename_in(conn, TABLE_NAME, collection, document_id, file_name, previous)
            _rename_in(conn, RETAINED_TABLE_NAME, collection, document_id, file_name, previous)
            return renamed > 0
    except Exception as e:
        logger.warning("Failed to rename document %s in %s: %s", document_id, collection, e)
        return False


def clear_collection(store, collection: str) -> None:
    from sqlalchemy import text

    try:
        with store._sync_engine.connect() as conn:
            conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(f"DELETE FROM {TABLE_NAME} WHERE collection = :collection"),
                {"collection": collection},
            )
            conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(f"DELETE FROM {RETAINED_TABLE_NAME} WHERE collection = :collection"),
                {"collection": collection},
            )
            conn.commit()
            logger.debug("Cleared metadata for collection %s", collection)
    except Exception as e:
        logger.warning("Failed to clear metadata for %s: %s", collection, e)


def clear_all(store) -> None:
    from sqlalchemy import text

    try:
        with store._sync_engine.connect() as conn:
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            conn.execute(text(f"DELETE FROM {TABLE_NAME}"))
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            conn.execute(text(f"DELETE FROM {RETAINED_TABLE_NAME}"))
            conn.commit()
            logger.debug("Cleared all document metadata")
    except Exception as e:
        logger.warning("Failed to clear all document metadata: %s", e)
