from __future__ import annotations

import asyncio
import logging

from ris_adapter.cache import cache_get_json
from ris_adapter.cache import cache_set_json
from ris_adapter.cache import ingested_marker_key
from ris_adapter.cache import ris_cache_ttl_seconds
from ris_adapter.lookup.fetch import FetchedDocument
from ris_adapter.register import _ingest_document_sync
from ris_adapter.register import _resolve_session_collection
from ris_adapter.register import _safe_document_name

logger = logging.getLogger(__name__)


async def ingest_documents(documents: list[FetchedDocument], enabled: bool) -> str | None:
    if not enabled:
        return None
    names = [await ingest_one(fetched) for fetched in documents]
    return next((name for name in names if name), None)


async def ingest_one(fetched: FetchedDocument) -> str | None:
    document = fetched.document
    file_name = _safe_document_name(fetched.candidate.document_number or document.url, document.title)
    collection = _resolve_session_collection()
    marker = ingested_marker_key(collection, document.url) if collection else None
    if marker and await cache_get_json(marker):
        return file_name
    try:
        stored = await asyncio.to_thread(_ingest_document_sync, document.text, file_name, document.url)
    except Exception:  # noqa: BLE001 — fetching must succeed even when ingestion cannot
        logger.warning("ris_lookup: knowledge ingestion failed (non-fatal)", exc_info=True)
        return None
    if stored and marker:
        await cache_set_json(marker, True, ris_cache_ttl_seconds())
    return stored
