"""The shared cache a law lookup reads documents through, and the per-session ingest marker.

Wraps the agent's fail-open Dragonfly/Redis cache (``agent.common.cache``,
ADR-0020), so a document fetched for one turn is free for the next turn and the
next replica. Every operation is best-effort: a cache error never breaks a
lookup, it means a live fetch. A source's text is fully reconstructible, which
is the cache-only contract ADR-0020 asks for. Keys live under the source's
namespace (``LawSource.namespace``).
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from typing import Any

from agent.knowledge.law_lookup.client import Document

logger = logging.getLogger(__name__)

#: The shape of the text the engine makes, in the document key. The cache holds
#: CONVERTED text for days, so a change to the conversion is invisible until every
#: entry expires unless the key moves with it. 2: screen-reader twins dropped.
DOC_TEXT_VERSION = 2
_SECONDS_PER_DAY = 24 * 60 * 60


def ttl_seconds(days: int) -> int:
    """The cache lifetime; a non-positive setting is the default week."""
    return (days if days > 0 else 7) * _SECONDS_PER_DAY


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]


def doc_cache_key(namespace: str, url: str) -> str:
    return f"{namespace}:doc:v{DOC_TEXT_VERSION}:{_digest(url)}"


def ingested_marker_key(namespace: str, collection: str, url: str) -> str:
    """Per-session marker that a document was already ingested into a collection."""
    return f"{namespace}:ingested:{collection}:{_digest(url)}"


async def cache_get_json(key: str) -> Any | None:
    """Best-effort shared-cache read; None on miss, unavailable or error."""
    try:
        from agent.common.cache import get_json

        return await asyncio.to_thread(get_json, key)
    except Exception:  # noqa: BLE001 — fail-open by contract
        logger.debug("law_lookup cache read failed for %s", key, exc_info=True)
        return None


async def cache_set_json(key: str, value: Any, ttl: int) -> None:
    """Best-effort shared-cache write; silently ignored on error."""
    try:
        from agent.common.cache import set_json

        await asyncio.to_thread(set_json, key, value, ttl)
    except Exception:  # noqa: BLE001 — fail-open by contract
        logger.debug("law_lookup cache write failed for %s", key, exc_info=True)


async def fetch_document_cached(client, url: str, ttl: int) -> Document:
    """Fetch a document through the shared cache; a miss or a cache fault is a live fetch."""
    key = doc_cache_key(client.law.namespace, url)
    cached = await cache_get_json(key)
    if isinstance(cached, dict) and cached.get("text"):
        return Document(url=cached.get("url", url), title=cached.get("title", ""), text=cached["text"])
    document = await client.fetch_document(url)
    await cache_set_json(key, {"url": document.url, "title": document.title, "text": document.text}, ttl)
    return document
