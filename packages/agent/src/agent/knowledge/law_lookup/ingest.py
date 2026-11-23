from __future__ import annotations

import asyncio
import logging
import os
import re
import tempfile
from urllib.parse import parse_qs
from urllib.parse import urlparse

from agent.knowledge.law_lookup.cache import cache_get_json
from agent.knowledge.law_lookup.cache import cache_set_json
from agent.knowledge.law_lookup.cache import ingested_marker_key
from agent.knowledge.law_lookup.fetch import FetchedDocument
from agent.knowledge.law_lookup.passages import clean_title
from agent.knowledge.law_lookup.source import LawSource

logger = logging.getLogger(__name__)

_NAME_TITLE_CHARS = 60


async def ingest_documents(documents: list[FetchedDocument], enabled: bool, law: LawSource, ttl: int) -> str | None:
    if not enabled:
        return None
    names = [await ingest_one(fetched, law, ttl) for fetched in documents]
    return next((name for name in names if name), None)


async def ingest_one(fetched: FetchedDocument, law: LawSource, ttl: int) -> str | None:
    document = fetched.document
    file_name = safe_document_name(fetched.candidate.document_number or document.url, document.title, law)
    collection = _session_collection()
    marker = ingested_marker_key(law.namespace, collection, document.url) if collection else None
    if marker and await cache_get_json(marker):
        return file_name
    try:
        stored = await asyncio.to_thread(_ingest_sync, document.text, file_name, document.url, collection)
    except Exception:  # noqa: BLE001 — fetching must succeed even when ingestion cannot
        logger.warning("law_lookup: knowledge ingestion failed (non-fatal)", exc_info=True)
        return None
    if stored and marker:
        await cache_set_json(marker, True, ttl)
    return stored


def document_anchor(reference: str, law: LawSource) -> str:
    ref = (reference or "").strip()
    if ref.lower().startswith(("http://", "https://")):
        ref = _reference_in_url(ref, law)
    return re.sub(r"[^\w.\-]+", "", ref)


def _reference_in_url(url: str, law: LawSource) -> str:
    try:
        parsed = urlparse(url)
    except ValueError:
        return ""
    query = {key.lower(): values for key, values in parse_qs(parsed.query).items()}
    for param in law.lookup.reference.url_parameters:
        value = next((v.strip() for v in query.get(param.lower(), []) if v.strip()), "")
        if value:
            return value
    pattern = law.document_path_pattern()
    match = pattern.search(parsed.path) if pattern else None
    return match.group(1) if match else ""


def safe_document_name(reference: str, title: str, law: LawSource) -> str:
    base = re.sub(r"[^\w.\- ]+", "_", clean_title(title, law)).strip("_ ").replace(" ", "_")
    base = re.sub(r"[._\-]+$", "", base[:_NAME_TITLE_CHARS])
    parts = [part for part in (base, document_anchor(reference, law)) if part]
    prefix = law.wording.title_prefix or law.namespace
    if parts:
        return f"{prefix}_{'_'.join(parts)}.txt"
    return f"{re.sub(r'[^\w.]+', '_', law.wording.untitled)}.txt"


def _session_collection() -> str | None:
    from agent.knowledge.base import SESSION_COLLECTION_PREFIX
    from nat.plugin_api import Context

    try:
        ctx = Context.get()
        session_id = ctx.conversation_id if ctx else None
    except Exception:  # noqa: BLE001
        return None
    if not session_id:
        return None
    if session_id.startswith(SESSION_COLLECTION_PREFIX):
        return session_id
    return f"{SESSION_COLLECTION_PREFIX}{session_id}"


def _ingest_sync(text: str, file_name: str, source_url: str, collection: str | None) -> str | None:
    from agent.knowledge.factory import get_active_ingestor

    ingestor = get_active_ingestor()
    if ingestor is None or not collection:
        logger.debug("law_lookup: no active ingestor or session collection, skipping ingestion")
        return None
    staging_dir = tempfile.mkdtemp(prefix="law_lookup_")
    file_path = os.path.join(staging_dir, file_name)
    with open(file_path, "w", encoding="utf-8") as handle:
        handle.write(f"Source: {source_url}\n\n{text}")
    ingestor.submit_job([file_path], collection)
    logger.info("law_lookup: submitted '%s' for ingestion into '%s'", file_name, collection)
    return file_name
