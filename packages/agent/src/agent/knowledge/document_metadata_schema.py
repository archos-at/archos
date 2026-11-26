from __future__ import annotations

from typing import TYPE_CHECKING

from agent.common.db_utils import ensure_schema
from agent.common.db_utils import lock_schema
from agent.common.db_utils import present_columns
from agent.common.db_utils import present_indexes
from agent.common.db_utils import redact_db_url
from agent.common.source_kinds import BASE_CORPUS_COLLECTION
from agent.common.source_kinds import LEGACY_BASE_CORPUS_COLLECTION
from agent.knowledge.document_classification import LEGACY_DOC_CLASSES

if TYPE_CHECKING:
    pass

from agent.knowledge import document_metadata_store as facade
from agent.knowledge.document_metadata_constants import _INDEX_NAME
from agent.knowledge.document_metadata_constants import _LEGACY_RETAINED_COLUMNS
from agent.knowledge.document_metadata_constants import _LEGACY_INDEX_NAME
from agent.knowledge.document_metadata_constants import _OPTIONAL_COLUMN_TYPES
from agent.knowledge.document_metadata_constants import _OPTIONAL_COLUMNS
from agent.knowledge.document_metadata_constants import DOCUMENT_ID_INDEXES
from agent.knowledge.document_metadata_constants import IDENTITY_COLUMNS
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

    _key_by_document_id(store, conn, TABLE_NAME)
    store._ensure_index(conn)
    store._create_retained_table(conn)
    store._rename_legacy_doc_classes(conn)
    _rename_legacy_base_corpus(conn)


def _rename_legacy_base_corpus(conn) -> None:
    from sqlalchemy import text

    names = {"current": BASE_CORPUS_COLLECTION, "legacy": LEGACY_BASE_CORPUS_COLLECTION}
    for table in (TABLE_NAME, RETAINED_TABLE_NAME):
        conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(
                f"UPDATE {table} SET collection = :current WHERE collection = :legacy "
                f"AND NOT EXISTS (SELECT 1 FROM {table} AS kept WHERE kept.collection = :current "
                f"AND kept.filename = {table}.filename)"
            ),
            names,
        )
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        conn.execute(text(f"DELETE FROM {table} WHERE collection = :legacy"), names)


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
    has_current = inspector.has_table(RETAINED_TABLE_NAME)
    if has_legacy and not has_current:
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        conn.execute(text(f"ALTER TABLE {LEGACY_RETAINED_TABLE_NAME} RENAME TO {RETAINED_TABLE_NAME}"))
        logger.info("Renamed '%s' to '%s' (rows preserved)", LEGACY_RETAINED_TABLE_NAME, RETAINED_TABLE_NAME)
    elif not has_current:
        conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(
                f"CREATE TABLE {RETAINED_TABLE_NAME} ("
                "collection VARCHAR(256) NOT NULL, "
                "filename VARCHAR(512) NOT NULL, "
                "document_id TEXT, "
                "superseded_by TEXT, "
                "superseded_by_id TEXT, "
                "revision_suggestion TEXT, "
                "change_summary TEXT, "
                "change_basis TEXT)"
            )
        )
    _key_by_document_id(store, conn, RETAINED_TABLE_NAME)
    if has_legacy and has_current:
        columns = ", ".join(("collection", "filename", *_LEGACY_RETAINED_COLUMNS))
        conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(
                f"INSERT INTO {RETAINED_TABLE_NAME} ({columns}) SELECT {columns} FROM {LEGACY_RETAINED_TABLE_NAME} "
                "WHERE true ON CONFLICT DO NOTHING"
            )
        )
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        conn.execute(text(f"DELETE FROM {LEGACY_RETAINED_TABLE_NAME}"))


def _key_by_document_id(store, conn, table: str) -> None:
    from sqlalchemy import text

    present = present_columns(conn, table)
    for column in IDENTITY_COLUMNS:
        if column not in present:
            store._add_column_if_missing(conn, column, "TEXT", table=table)
    if not store._is_postgres():
        _rebuild_without_primary_key(conn, table)
    by_id, by_name = DOCUMENT_ID_INDEXES[table]
    conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(
            f"CREATE UNIQUE INDEX IF NOT EXISTS {by_id} ON {table} (collection, document_id) "
            "WHERE document_id IS NOT NULL"
        )
    )
    conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(f"CREATE UNIQUE INDEX IF NOT EXISTS {by_name} ON {table} (collection, filename) WHERE document_id IS NULL")
    )


def _rebuild_without_primary_key(conn, table: str) -> None:
    from sqlalchemy import text

    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
    columns = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    if not any(column[5] for column in columns):
        return
    definitions = ", ".join(
        f"{name} {kind}{' NOT NULL' if not_null else ''}{f' DEFAULT {default}' if default is not None else ''}"
        for _, name, kind, not_null, default, _ in columns
    )
    names = ", ".join(column[1] for column in columns)
    rebuilt = f"{table}__by_document_id"
    for statement in (
        f"DROP TABLE IF EXISTS {rebuilt}",
        f"CREATE TABLE {rebuilt} ({definitions})",
        f"INSERT INTO {rebuilt} ({names}) SELECT {names} FROM {table}",
        f"DROP TABLE {table}",
        f"ALTER TABLE {rebuilt} RENAME TO {table}",
    ):
        conn.execute(text(statement))  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
    logger.info("Re-keyed '%s' by document id: the (collection, filename) primary key is gone", table)


def name_primary_keys(conn) -> dict[str, str]:
    from sqlalchemy import bindparam
    from sqlalchemy import text

    if conn.dialect.name != "postgresql":
        return {}
    rows = conn.execute(
        text(
            "SELECT rel.relname, con.conname FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid "
            "WHERE con.contype = 'p' AND rel.relname IN :tables AND pg_table_is_visible(rel.oid)"
        ).bindparams(bindparam("tables", expanding=True)),
        {"tables": [TABLE_NAME, RETAINED_TABLE_NAME]},
    )
    return {row[0]: row[1] for row in rows}


def drop_name_primary_keys(conn) -> int:
    from sqlalchemy import text

    dropped = name_primary_keys(conn)
    for table, constraint in dropped.items():
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        conn.execute(text(f'ALTER TABLE {table} DROP CONSTRAINT "{constraint}"'))
        logger.info("Dropped %s's (collection, filename) primary key %s", table, constraint)
    return len(dropped)


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
            "document_id TEXT, "
            "superseded_by_id TEXT, "
            "created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP)"
        )
    )
    logger.info("Created document_metadata table in %s", redact_db_url(store.db_url))


def _add_column_if_missing(store, conn, column: str, ddl_type: str = "TEXT", *, table: str = TABLE_NAME) -> None:
    from sqlalchemy import text

    if store._is_postgres():
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {ddl_type}"))
        return
    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
    existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})")).fetchall()}
    if column not in existing:
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))


def _ensure_index(store, conn) -> None:
    from sqlalchemy import text

    if _INDEX_NAME not in present_indexes(conn, TABLE_NAME):
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        conn.execute(text(f"CREATE INDEX IF NOT EXISTS {_INDEX_NAME} ON {TABLE_NAME} (collection)"))
    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
    conn.execute(text(f"DROP INDEX IF EXISTS {_LEGACY_INDEX_NAME}"))
