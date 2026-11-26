from __future__ import annotations

from datetime import UTC
from datetime import date
from datetime import datetime
from typing import TYPE_CHECKING
from typing import Any

if TYPE_CHECKING:
    from .schema import AvailableDocument

from agent.knowledge import document_metadata_mail as mail_impl
from agent.knowledge.document_metadata_constants import _DOCUMENT_COLUMNS
from agent.knowledge.document_metadata_constants import _OFFICE_TIMEZONE
from agent.knowledge.document_metadata_constants import TABLE_NAME
from agent.knowledge.document_metadata_constants import logger
from agent.knowledge.document_metadata_helpers import _batch_bind
from agent.knowledge.document_metadata_helpers import _batch_match
from agent.knowledge.document_metadata_helpers import _current_doc_class
from agent.knowledge.document_metadata_helpers import _decode_page_count
from agent.knowledge.mail_facts import normalise_mail_origin
from agent.knowledge.mail_facts import normalise_mail_thread


def _row_to_document(store, row: Any, collection: str | None = None) -> AvailableDocument:
    from .schema import AvailableDocument

    return AvailableDocument(
        file_name=row[0],
        summary=row[1],
        tags=store._decode_tags(row[2]),
        doc_class=_current_doc_class(row[3] or None),
        display_title=row[4] or None,
        folder_path=row[5] or None,
        added_at=store._iso_date(row[6]) if len(row) > 6 else None,
        topics=store._decode_tags(row[7]) if len(row) > 7 else None,
        capture=store._decode_object(row[8]) if len(row) > 8 else None,
        superseded_by=(row[9] or None) if len(row) > 9 else None,
        revision_suggestion=store._decode_suggestion(row[10]) if len(row) > 10 else None,
        change_summary=(row[11] or None) if len(row) > 11 else None,
        change_basis=(row[12] or None) if len(row) > 12 else None,
        revision_facts=store._decode_revision_facts(row[13]) if len(row) > 13 else None,
        page_count=_decode_page_count(row[14]) if len(row) > 14 else None,
        dossier=store._decode_json(row[15], dict) if len(row) > 15 else None,
        doc_references=store._decode_json(row[16], list) if len(row) > 16 else None,
        coverage=store._decode_json(row[17], dict) if len(row) > 17 else None,
        mail_thread=mail_impl.decode_mail(row[18], normalise_mail_thread) if len(row) > 18 else None,
        mail_origin=mail_impl.decode_mail(row[19], normalise_mail_origin) if len(row) > 19 else None,
        document_id=(row[20] or None) if len(row) > 20 else None,
        superseded_by_id=(row[21] or None) if len(row) > 21 else None,
        collection=collection,
    )


def _resolve_links(
    documents: list[AvailableDocument], present: list[AvailableDocument]
) -> list[tuple[AvailableDocument, AvailableDocument]]:
    by_id = {doc.document_id: doc for doc in present if doc.document_id}
    by_name: dict[str, list[AvailableDocument]] = {}
    for doc in present:
        by_name.setdefault(doc.file_name, []).append(doc)
    links = []
    for doc in documents:
        newer = by_id.get(doc.superseded_by_id) if doc.superseded_by_id else None
        holders = [
            held
            for held in by_name.get(doc.superseded_by or "", [])
            if not doc.superseded_by_id or not held.document_id
        ]
        if newer is None and len(holders) == 1:
            newer = holders[0]
        doc.superseded_by = newer.file_name if newer is not None else None
        doc.superseded_by_id = newer.document_id if newer is not None else None
        if newer is not None:
            links.append((doc, newer))
    return links


def _attach_supersedes(documents: list[AvailableDocument]) -> list[AvailableDocument]:
    replaced: dict[int, list[str]] = {}
    for older, newer in _resolve_links(documents, documents):
        replaced.setdefault(id(newer), []).append(older.file_name)
    for doc in documents:
        doc.supersedes = sorted(replaced[id(doc)]) if id(doc) in replaced else None
    return documents


def _iso_date(raw: Any) -> str | None:
    if raw is None:
        return None
    if isinstance(raw, datetime):
        moment = raw
    elif isinstance(raw, date):
        return raw.isoformat()
    else:
        text_value = str(raw).strip()
        try:
            moment = datetime.fromisoformat(text_value)
        except ValueError:
            return text_value[:10] or None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(_OFFICE_TIMEZONE).date().isoformat()


def get_all(store, collection: str) -> list[AvailableDocument]:
    from sqlalchemy import text

    try:
        with store._sync_engine.connect() as conn:
            result = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(f"SELECT {_DOCUMENT_COLUMNS} FROM {TABLE_NAME} WHERE collection = :collection"),
                {"collection": collection},
            )
            return store._attach_supersedes([store._row_to_document(row, collection) for row in result])
    except Exception as e:
        logger.warning("Failed to get metadata for %s: %s", collection, e)
        return []


def _select(store, conn, collection: str, asked: tuple[str, dict[str, Any]]) -> list[AvailableDocument]:
    from sqlalchemy import text

    where, params = asked
    select = _batch_bind(
        text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            f"SELECT {_DOCUMENT_COLUMNS} FROM {TABLE_NAME} WHERE collection = :collection AND {where}"
        ),
        params,
    )
    return [
        store._row_to_document(row, collection) for row in conn.execute(select, {"collection": collection, **params})
    ]


def get_many(
    store, collection: str, filenames: list[str], *, document_ids: list[str] | None = None
) -> list[AvailableDocument]:
    asked = _batch_match(filenames, document_ids)
    if asked is None:
        return []
    try:
        with store._sync_engine.connect() as conn:
            documents = _select(store, conn, collection, asked)
            newer = _batch_match(
                [doc.superseded_by for doc in documents if doc.superseded_by],
                [doc.superseded_by_id for doc in documents if doc.superseded_by_id],
            )
            kept = _select(store, conn, collection, newer) if newer else []
    except Exception as e:
        logger.warning("Failed to get metadata of %d file(s) in %s: %s", len(filenames), collection, e)
        return []
    _resolve_links(documents, kept)
    return documents


async def get_all_async(store, collection: str) -> list[AvailableDocument]:
    from sqlalchemy import text

    try:
        await store._ensure_table_async(store.db_url)
        engine = store._get_or_create_async_engine(store.db_url)
        async with engine.connect() as conn:
            result = await conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(f"SELECT {_DOCUMENT_COLUMNS} FROM {TABLE_NAME} WHERE collection = :collection"),
                {"collection": collection},
            )
            return store._attach_supersedes([store._row_to_document(row, collection) for row in result])
    except Exception as e:
        logger.warning("Failed to get metadata async for %s: %s", collection, e)
        return store.get_all(collection)
