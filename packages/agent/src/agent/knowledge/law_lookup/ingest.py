"""[5] The full text into the session collection.

Best-effort (a lookup must succeed even when ingestion cannot), once per
session per document (a marker in the shared cache). It is what keeps a passage
answer from costing the conversation the rest of the law: ``read_passage``
reopens any other provision of a document that is in the session collection.
"""

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

#: Room for the readable part of the name, leaving space for the document number that anchors it.
_NAME_TITLE_CHARS = 60


async def ingest_documents(documents: list[FetchedDocument], enabled: bool, law: LawSource, ttl: int) -> str | None:
    """Ingest every fetched document; return the first stored name, or ``None``.

    The name is what the model is told to reach for later, so the FIRST one is
    the one reported: naming both would put a list in a sentence that exists to
    give the reader one handle.
    """
    if not enabled:
        return None
    names = [await ingest_one(fetched, law, ttl) for fetched in documents]
    return next((name for name in names if name), None)


async def ingest_one(fetched: FetchedDocument, law: LawSource, ttl: int) -> str | None:
    """Ingest one fetched document once per session; returns its stored name."""
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
    """The document number a reference identifies: a bare number, or read out of a source URL.

    A number and a URL for the same document MUST anchor the same name: the
    ingest marker is keyed on the fetched URL, so otherwise a URL fetch reusing a
    number fetch's ingestion would report a file name that was never stored. A
    URL whose identity cannot be read contributes no anchor rather than a
    mangled URL; so does one ``urlparse`` refuses.
    """
    ref = (reference or "").strip()
    if ref.lower().startswith(("http://", "https://")):
        ref = _reference_in_url(ref, law)
    return re.sub(r"[^\w.\-]+", "", ref)


def _reference_in_url(url: str, law: LawSource) -> str:
    """The reference a URL carries in a query parameter the record names, or in the document path."""
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
    """A stable, filesystem- and citation-friendly name for an ingested document.

    The name becomes a CITATION KEY the reader sees, so it is both legible and
    stable across fetches: the document number anchors it, so two fetches of
    the same law converge on one document instead of piling up date-stamped
    copies.
    """
    base = re.sub(r"[^\w.\- ]+", "_", clean_title(title, law)).strip("_ ").replace(" ", "_")
    # Trim on the truncation boundary too: a trailing "." collided with the extension.
    base = re.sub(r"[._\-]+$", "", base[:_NAME_TITLE_CHARS])
    parts = [part for part in (base, document_anchor(reference, law)) if part]
    prefix = law.wording.title_prefix or law.namespace
    if parts:
        return f"{prefix}_{'_'.join(parts)}.txt"
    return f"{re.sub(r'[^\w.]+', '_', law.wording.untitled)}.txt"


def _session_collection() -> str | None:
    """The per-session knowledge collection name, or None outside a session."""
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
    """Write the document to a temp file and submit it to the active ingestor; None when unavailable."""
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
