from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass

from agent.knowledge.document_metadata_constants import _RETAINED_COLUMNS
from agent.knowledge.document_metadata_constants import RETAINED_TABLE_NAME
from agent.knowledge.document_metadata_constants import TABLE_NAME
from agent.knowledge.document_metadata_constants import TAGS_SET_BY_PERSON
from agent.knowledge.document_metadata_constants import logger
from agent.knowledge.document_metadata_helpers import _LinkRow
from agent.knowledge.document_metadata_helpers import _person_made_facts


def register(
    store,
    collection: str,
    filename: str,
    summary: str,
    tags: list[str] | None = None,
    topics: list[str] | None = None,
) -> None:
    import json

    tags_json = json.dumps(tags) if tags else None
    topics_json = json.dumps(topics) if topics else None

    try:
        with store._sync_engine.connect() as conn:
            _upsert_metadata(conn, collection, filename, summary, tags_json, topics_json)
            store._take_back_retained(conn, collection, filename)
            conn.commit()
            logger.debug("Registered metadata for %s in %s", filename, collection)
    except Exception as e:
        logger.warning("Failed to register metadata for %s: %s", filename, e)


def _upsert_metadata(
    conn, collection: str, filename: str, summary: str, tags_json: str | None, topics_json: str | None
) -> None:
    from sqlalchemy import text

    conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(
            f"INSERT INTO {TABLE_NAME} (collection, filename, summary, tags, topics) "
            "VALUES (:collection, :filename, :summary, :tags, :topics) "
            "ON CONFLICT (collection, filename) DO UPDATE SET "
            "summary = excluded.summary, "
            f"tags = CASE WHEN {TABLE_NAME}.tags_set_by = :person "
            f"THEN {TABLE_NAME}.tags ELSE excluded.tags END, "
            f"topics = CASE WHEN {TABLE_NAME}.tags_set_by = :person "
            f"THEN {TABLE_NAME}.topics ELSE excluded.topics END"
        ),
        {
            "collection": collection,
            "filename": filename,
            "summary": summary,
            "tags": tags_json,
            "topics": topics_json,
            "person": TAGS_SET_BY_PERSON,
        },
    )


def _take_back_retained(store, conn, collection: str, filename: str) -> None:
    from sqlalchemy import text

    params = {"collection": collection, "filename": filename}
    kept = conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(
            f"SELECT {', '.join(_RETAINED_COLUMNS)} FROM {RETAINED_TABLE_NAME} "
            "WHERE collection = :collection AND filename = :filename"
        ),
        params,
    ).first()
    if kept is None:
        return
    kept = dict(zip(_RETAINED_COLUMNS, kept, strict=True))
    if kept["superseded_by"] and store._closes_a_loop(conn, collection, filename, kept["superseded_by"]):
        kept["superseded_by"] = None
    conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(
            f"UPDATE {TABLE_NAME} SET "
            "superseded_by = COALESCE(superseded_by, :superseded_by), "
            "revision_suggestion = COALESCE(revision_suggestion, :revision_suggestion), "
            "change_basis = CASE WHEN change_summary IS NULL THEN :change_basis ELSE change_basis END, "
            "change_summary = COALESCE(change_summary, :change_summary) "
            "WHERE collection = :collection AND filename = :filename"
        ),
        {**params, **kept},
    )
    store._forget_retained(conn, collection, filename)
    logger.info("Took back the Fassung facts kept for %s in %s", filename, collection)


def _closes_a_loop(conn, collection: str, older: str, newer: str) -> bool:
    from sqlalchemy import text

    from .document_revisions import would_loop

    rows = {
        row[0]: _LinkRow(row[1], None, None)
        for row in conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(f"SELECT filename, superseded_by FROM {TABLE_NAME} WHERE collection = :collection"),
            {"collection": collection},
        )
    }
    return would_loop(rows, newer=newer, older=older)


def _forget_retained(conn, collection: str, filename: str) -> None:
    from sqlalchemy import text

    conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(f"DELETE FROM {RETAINED_TABLE_NAME} WHERE collection = :collection AND filename = :filename"),
        {"collection": collection, "filename": filename},
    )


def unregister(store, collection: str, filename: str, *, permanent: bool = False) -> None:
    from sqlalchemy import text

    params = {"collection": collection, "filename": filename}
    try:
        with store._sync_engine.begin() as conn:
            if permanent:
                store._forget_links_to(conn, collection, filename)
            else:
                store._retain(conn, collection, filename)
            conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(f"DELETE FROM {TABLE_NAME} WHERE collection = :collection AND filename = :filename"),
                params,
            )
        logger.debug("Unregistered metadata for %s in %s (permanent=%s)", filename, collection, permanent)
    except Exception as e:
        logger.warning("Failed to unregister metadata for %s: %s", filename, e)


def _retain(store, conn, collection: str, filename: str) -> None:
    from sqlalchemy import text

    params = {"collection": collection, "filename": filename}
    row = conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(
            f"SELECT {', '.join(_RETAINED_COLUMNS)} FROM {TABLE_NAME} "
            "WHERE collection = :collection AND filename = :filename"
        ),
        params,
    ).first()
    kept = _person_made_facts(filename, *row) if row is not None else None
    store._forget_retained(conn, collection, filename)
    if kept is None:
        return
    conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(
            f"INSERT INTO {RETAINED_TABLE_NAME} (collection, filename, {', '.join(_RETAINED_COLUMNS)}) "
            "VALUES (:collection, :filename, :superseded_by, :revision_suggestion, :change_summary, :change_basis)"
        ),
        {**params, **kept},
    )


def _forget_links_to(store, conn, collection: str, filename: str) -> None:
    from sqlalchemy import text

    store._forget_retained(conn, collection, filename)
    for table in (TABLE_NAME, RETAINED_TABLE_NAME):
        conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(
                f"UPDATE {table} SET superseded_by = NULL WHERE collection = :collection AND superseded_by = :filename"
            ),
            {"collection": collection, "filename": filename},
        )


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
