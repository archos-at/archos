from __future__ import annotations

from typing import TYPE_CHECKING

from agent.common.db_utils import ensure_schema
from agent.common.db_utils import lock_schema
from agent.common.db_utils import present_columns
from agent.common.db_utils import present_indexes
from agent.common.db_utils import redact_db_url
from agent.knowledge.document_classification import LEGACY_DOC_CLASSES

if TYPE_CHECKING:
    pass

from agent.knowledge import document_metadata_store as facade
from agent.knowledge.document_metadata_constants import _INDEX_NAME
from agent.knowledge.document_metadata_constants import _LEGACY_INDEX_NAME
from agent.knowledge.document_metadata_constants import _OPTIONAL_COLUMN_TYPES
from agent.knowledge.document_metadata_constants import _OPTIONAL_COLUMNS
from agent.knowledge.document_metadata_constants import _RETAINED_COLUMNS
from agent.knowledge.document_metadata_constants import LEGACY_RETAINED_TABLE_NAME
from agent.knowledge.document_metadata_constants import LEGACY_TABLE_NAME
from agent.knowledge.document_metadata_constants import RETAINED_TABLE_NAME
from agent.knowledge.document_metadata_constants import TABLE_NAME
from agent.knowledge.document_metadata_constants import logger


def _is_postgres(store) -> bool:
    return store.db_url.startswith("postgres")


def _ensure_table_sync(store):
    with facade.DocumentMetadataStore._cache_lock:
        if store.db_url in facade.DocumentMetadataStore._tables_initialized:
            return

        try:
            ensure_schema(store._sync_engine, TABLE_NAME, store._run_schema)
        except Exception as e:
            logger.warning("Failed to ensure document_metadata schema (sync): %s", e)
            return
        facade.DocumentMetadataStore._tables_initialized.add(store.db_url)


async def _ensure_table_async(cls, db_url: str):
    if db_url in cls._tables_initialized:
        return

    engine = cls._get_or_create_async_engine(db_url)
    store = cls.__new__(cls)
    store.db_url = db_url

    try:
        async with engine.begin() as conn:
            await conn.run_sync(lock_schema, TABLE_NAME)
            await conn.run_sync(store._run_schema)
    except Exception as e:
        logger.warning("Failed to ensure document_metadata schema (async): %s", e)
        return
    cls._tables_initialized.add(db_url)
    logger.info("Created/migrated document_metadata table (async) in %s", redact_db_url(db_url))


def _run_schema(store, conn) -> None:
    from sqlalchemy import inspect
    from sqlalchemy import text

    inspector = inspect(conn)
    has_current = inspector.has_table(TABLE_NAME)
    has_legacy = inspector.has_table(LEGACY_TABLE_NAME)

    if not has_current and has_legacy:
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        conn.execute(text(f"ALTER TABLE {LEGACY_TABLE_NAME} RENAME TO {TABLE_NAME}"))
        logger.info("Migrated legacy '%s' table to '%s' (rows preserved)", LEGACY_TABLE_NAME, TABLE_NAME)
    elif not has_current:
        store._create_table(conn)

    present = present_columns(conn, TABLE_NAME)
    for column in _OPTIONAL_COLUMNS:
        if column not in present:
            store._add_column_if_missing(conn, column, _OPTIONAL_COLUMN_TYPES.get(column, "TEXT"))

    store._ensure_index(conn)
    store._create_retained_table(conn)
    store._rename_legacy_doc_classes(conn)


def _rename_legacy_doc_classes(store, conn) -> None:
    from sqlalchemy import text

    names = list(LEGACY_DOC_CLASSES.items())
    params = {f"old{i}": legacy for i, (legacy, _) in enumerate(names)}
    params |= {f"new{i}": current for i, (_, current) in enumerate(names)}
    old_keys = ", ".join(f":old{i}" for i in range(len(names)))
    cases = " ".join(f"WHEN :old{i} THEN :new{i}" for i in range(len(names)))
    for column in ("doc_class", "doc_class_suggestion"):
        conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(
                f"UPDATE {TABLE_NAME} SET {column} = CASE {column} {cases} ELSE {column} END "
                f"WHERE {column} IN ({old_keys})"
            ),
            params,
        )


def _create_retained_table(store, conn) -> None:
    from sqlalchemy import inspect
    from sqlalchemy import text

    inspector = inspect(conn)
    has_legacy = inspector.has_table(LEGACY_RETAINED_TABLE_NAME)
    if has_legacy and not inspector.has_table(RETAINED_TABLE_NAME):
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        conn.execute(text(f"ALTER TABLE {LEGACY_RETAINED_TABLE_NAME} RENAME TO {RETAINED_TABLE_NAME}"))
        logger.info("Renamed '%s' to '%s' (rows preserved)", LEGACY_RETAINED_TABLE_NAME, RETAINED_TABLE_NAME)
        return
    if has_legacy:
        columns = ", ".join(("collection", "filename", *_RETAINED_COLUMNS))
        conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(
                f"INSERT INTO {RETAINED_TABLE_NAME} ({columns}) SELECT {columns} FROM {LEGACY_RETAINED_TABLE_NAME} "
                "WHERE true ON CONFLICT (collection, filename) DO NOTHING"
            )
        )
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        conn.execute(text(f"DELETE FROM {LEGACY_RETAINED_TABLE_NAME}"))
        return
    conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(
            f"CREATE TABLE IF NOT EXISTS {RETAINED_TABLE_NAME} ("
            "collection VARCHAR(256) NOT NULL, "
            "filename VARCHAR(512) NOT NULL, "
            "superseded_by TEXT, "
            "revision_suggestion TEXT, "
            "change_summary TEXT, "
            "change_basis TEXT, "
            "PRIMARY KEY (collection, filename))"
        )
    )


def _create_table(store, conn) -> None:
    from sqlalchemy import text

    conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(
            f"CREATE TABLE {TABLE_NAME} ("
            "collection VARCHAR(256) NOT NULL, "
            "filename VARCHAR(512) NOT NULL, "
            "summary TEXT NOT NULL, "
            "tags TEXT, "
            "doc_class TEXT, "
            "display_title TEXT, "
            "folder_path TEXT, "
            "provenance TEXT, "
            "created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, "
            "PRIMARY KEY (collection, filename))"
        )
    )
    logger.info("Created document_metadata table in %s", redact_db_url(store.db_url))


def _add_column_if_missing(store, conn, column: str, ddl_type: str = "TEXT") -> None:
    from sqlalchemy import text

    if store._is_postgres():
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        conn.execute(text(f"ALTER TABLE {TABLE_NAME} ADD COLUMN IF NOT EXISTS {column} {ddl_type}"))
        return
    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
    existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({TABLE_NAME})")).fetchall()}
    if column not in existing:
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        conn.execute(text(f"ALTER TABLE {TABLE_NAME} ADD COLUMN {column} {ddl_type}"))


def _ensure_index(store, conn) -> None:
    from sqlalchemy import text

    if _INDEX_NAME not in present_indexes(conn, TABLE_NAME):
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        conn.execute(text(f"CREATE INDEX IF NOT EXISTS {_INDEX_NAME} ON {TABLE_NAME} (collection)"))
    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
    conn.execute(text(f"DROP INDEX IF EXISTS {_LEGACY_INDEX_NAME}"))
