from __future__ import annotations

from typing import TYPE_CHECKING
from typing import Any

from agent.knowledge.title_block import normalise_revision_facts

if TYPE_CHECKING:
    pass

from agent.knowledge.document_metadata_constants import TABLE_NAME
from agent.knowledge.document_metadata_constants import logger
from agent.knowledge.document_metadata_helpers import _batch_bind
from agent.knowledge.document_metadata_helpers import _batch_keys
from agent.knowledge.document_metadata_helpers import _batch_match
from agent.knowledge.document_metadata_helpers import _current_doc_class
from agent.knowledge.document_metadata_helpers import _decode_page_count
from agent.knowledge.document_metadata_helpers import _encode_page_count
from agent.knowledge.document_metadata_helpers import _escape_like
from agent.knowledge.document_metadata_helpers import _match
from agent.knowledge.document_metadata_helpers import _stamp


def set_doc_class(
    store, collection: str, filename: str, doc_class: str | None, *, document_id: str | None = None
) -> bool:
    return store._update_column(
        collection, filename, "doc_class", _current_doc_class(doc_class), document_id=document_id
    )


def get_doc_class(store, collection: str, filename: str, *, document_id: str | None = None) -> str | None:
    return _current_doc_class(store._get_column(collection, filename, "doc_class", document_id=document_id))


def get_doc_classes_batch(
    store, collection: str, filenames: list[str], *, document_ids: list[str] | None = None
) -> dict[str, str]:
    found = store._get_column_batch(collection, filenames, "doc_class", document_ids=document_ids)
    return {name: _current_doc_class(value) for name, value in found.items()}


def set_doc_class_suggestion(
    store, collection: str, filename: str, doc_class: str | None, *, document_id: str | None = None
) -> bool:
    return store._update_column(
        collection, filename, "doc_class_suggestion", _current_doc_class(doc_class), document_id=document_id
    )


def get_doc_class_suggestions_batch(
    store, collection: str, filenames: list[str], *, document_ids: list[str] | None = None
) -> dict[str, str]:
    found = store._get_column_batch(collection, filenames, "doc_class_suggestion", document_ids=document_ids)
    return {name: _current_doc_class(value) for name, value in found.items()}


def set_display_title(
    store, collection: str, filename: str, display_title: str | None, *, document_id: str | None = None
) -> bool:
    return store._update_column(collection, filename, "display_title", display_title, document_id=document_id)


def get_display_title(store, collection: str, filename: str, *, document_id: str | None = None) -> str | None:
    return store._get_column(collection, filename, "display_title", document_id=document_id)


def get_display_titles_batch(
    store, collection: str, filenames: list[str], *, document_ids: list[str] | None = None
) -> dict[str, str]:
    return store._get_column_batch(collection, filenames, "display_title", document_ids=document_ids)


def set_folder_path(
    store, collection: str, filename: str, folder_path: str | None, *, document_id: str | None = None
) -> bool:
    return store._update_column(collection, filename, "folder_path", folder_path, document_id=document_id)


def get_folder_path(store, collection: str, filename: str, *, document_id: str | None = None) -> str | None:
    return store._get_column(collection, filename, "folder_path", document_id=document_id)


def get_folder_paths_batch(
    store, collection: str, filenames: list[str], *, document_ids: list[str] | None = None
) -> dict[str, str]:
    return store._get_column_batch(collection, filenames, "folder_path", document_ids=document_ids)


def set_provenance(
    store, collection: str, filename: str, provenance: dict[str, str] | None, *, document_id: str | None = None
) -> bool:
    import json

    encoded = json.dumps(provenance) if provenance else None
    return store._update_column(collection, filename, "provenance", encoded, document_id=document_id)


def get_provenance(store, collection: str, filename: str, *, document_id: str | None = None) -> dict[str, str] | None:
    import json

    raw = store._get_column(collection, filename, "provenance", document_id=document_id)
    if not raw:
        return None
    try:
        decoded = json.loads(raw)
    except TypeError, ValueError:
        logger.warning("Ignoring unreadable provenance for %s in %s", filename, collection)
        return None
    return decoded if isinstance(decoded, dict) else None


def set_capture(
    store, collection: str, filename: str, capture: dict[str, Any] | None, *, document_id: str | None = None
) -> bool:
    import json

    encoded = json.dumps(capture) if capture else None
    return store._update_column(collection, filename, "capture", encoded, document_id=document_id)


def set_revision_facts(
    store, collection: str, filename: str, facts: dict[str, Any] | None, *, document_id: str | None = None
) -> bool:
    import json

    normalised = normalise_revision_facts(facts)
    encoded = json.dumps(normalised, ensure_ascii=False) if normalised else None
    return store._update_column(collection, filename, "revision_facts", encoded, document_id=document_id)


def set_reading(
    store,
    collection: str,
    filename: str,
    *,
    dossier: dict[str, Any] | None,
    references: list[dict[str, Any]] | None,
    coverage: dict[str, Any] | None,
    document_id: str | None = None,
) -> bool:
    import json

    written = True
    for column, value in (("dossier", dossier), ("doc_references", references), ("coverage", coverage)):
        encoded = json.dumps(value, ensure_ascii=False) if value else None
        written = store._update_column(collection, filename, column, encoded, document_id=document_id) and written
    return written


def set_page_count(
    store, collection: str, filename: str, page_count: int | None, *, document_id: str | None = None
) -> bool:
    return store._update_column(
        collection, filename, "page_count", _encode_page_count(page_count), document_id=document_id
    )


def get_page_count(store, collection: str, filename: str, *, document_id: str | None = None) -> int | None:
    return _decode_page_count(store._get_column(collection, filename, "page_count", document_id=document_id))


def set_change_summary(
    store, collection: str, filename: str, summary: str | None, basis: str | None, *, document_id: str | None = None
) -> bool:
    from sqlalchemy import text

    text_value = (summary or "").strip() or None
    basis_value = (basis or "").strip() or None if text_value else None
    where, keyed = _match(filename, document_id)
    try:
        with store._sync_engine.connect() as conn:
            result = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(
                    f"UPDATE {TABLE_NAME} SET change_summary = :summary, change_basis = :basis{_stamp(document_id)} "
                    f"WHERE collection = :collection AND {where}"
                ),
                {"summary": text_value, "basis": basis_value, "collection": collection, **keyed},
            )
            conn.commit()
            return (result.rowcount or 0) > 0
    except Exception as e:
        logger.warning("Failed to set the change summary for %s: %s", filename, e)
        return False


def _update_column(
    store, collection: str, filename: str, column: str, value: Any, *, document_id: str | None = None
) -> bool:
    from sqlalchemy import text

    where, keyed = _match(filename, document_id)
    try:
        with store._sync_engine.connect() as conn:
            result = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(
                    f"UPDATE {TABLE_NAME} SET {column} = :value{_stamp(document_id)} "
                    f"WHERE collection = :collection AND {where}"
                ),
                {"value": value, "collection": collection, **keyed},
            )
            conn.commit()
            updated = (result.rowcount or 0) > 0
            if updated:
                logger.debug("Updated %s for %s in %s", column, filename, collection)
            else:
                logger.debug("No metadata row to update %s for %s in %s", column, filename, collection)
            return updated
    except Exception as e:
        logger.warning("Failed to update %s for %s: %s", column, filename, e)
        return False


def _get_column(store, collection: str, filename: str, column: str, *, document_id: str | None = None) -> str | None:
    from sqlalchemy import text

    where, keyed = _match(filename, document_id)
    try:
        with store._sync_engine.connect() as conn:
            result = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(f"SELECT {column} FROM {TABLE_NAME} WHERE collection = :collection AND {where}"),
                {"collection": collection, **keyed},
            )
            row = result.first()
            return row[0] if row and row[0] else None
    except Exception as e:
        logger.warning("Failed to get %s for %s: %s", column, filename, e)
        return None


def _get_column_batch(
    store, collection: str, filenames: list[str], column: str, *, document_ids: list[str] | None = None
) -> dict[str, str]:
    asked = _batch_match(filenames, document_ids)
    if asked is None:
        return {}
    from sqlalchemy import text

    where, params = asked
    names, ids = set(filenames), set(document_ids or ())
    result: dict[str, str] = {}
    try:
        with store._sync_engine.connect() as conn:
            rows = conn.execute(
                _batch_bind(
                    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                    text(
                        f"SELECT filename, document_id, {column} FROM {TABLE_NAME} "
                        f"WHERE collection = :collection AND {where}"
                    ),
                    params,
                ),
                {"collection": collection, **params},
            )
            for row in rows:
                if row[2]:
                    for key in _batch_keys(row[0], row[1], names, ids):
                        result[key] = row[2]
    except Exception as e:
        logger.warning("Failed to batch-get %s for %s: %s", column, collection, e)
        return {}
    return result


def find_tmp_upload_names(store, collection: str, filenames: list[str]) -> list[str]:
    names = [name for name in dict.fromkeys(filenames) if name]
    if not names:
        return []
    from sqlalchemy import text

    patterns = {f"p{index}": f"tmp{'_' * 8}\\_{_escape_like(name)}" for index, name in enumerate(names)}
    where = " OR ".join(f"filename LIKE :{key} ESCAPE '\\'" for key in patterns)
    try:
        with store._sync_engine.connect() as conn:
            rows = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(f"SELECT filename FROM {TABLE_NAME} WHERE collection = :collection AND ({where})"),
                {"collection": collection, **patterns},
            )
            return [row[0] for row in rows]
    except Exception as e:
        logger.warning("Failed to look up tmp-prefixed names in %s: %s", collection, e)
        return []


def list_collections(store) -> list[str]:
    from sqlalchemy import text

    try:
        with store._sync_engine.connect() as conn:
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            result = conn.execute(text(f"SELECT DISTINCT collection FROM {TABLE_NAME} ORDER BY collection"))
            return [row[0] for row in result]
    except Exception as e:
        logger.warning("Failed to list metadata collections: %s", e)
        return []
