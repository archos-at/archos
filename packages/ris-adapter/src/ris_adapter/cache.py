from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from typing import TYPE_CHECKING
from typing import Any

if TYPE_CHECKING:  # a type import only — cache.py stays free of client.py at runtime
    from .client import RisClient
    from .client import RisDocument

logger = logging.getLogger(__name__)

try:
    from agent.common.cache import get_json as _get_json
    from agent.common.cache import set_json as _set_json

    _CACHE_AVAILABLE = True
except Exception:  # standalone adapter, or cache module unavailable
    _get_json = None  # type: ignore[assignment]
    _set_json = None  # type: ignore[assignment]
    _CACHE_AVAILABLE = False

_DEFAULT_TTL_DAYS = 7
_SECONDS_PER_DAY = 24 * 60 * 60


def ris_cache_ttl_seconds() -> int:
    raw = os.environ.get("RIS_CACHE_TTL_DAYS", "").strip()
    if raw.startswith("${"):
        raw = ""
    try:
        days = int(raw)
    except TypeError, ValueError:
        days = _DEFAULT_TTL_DAYS
    if days <= 0:
        days = _DEFAULT_TTL_DAYS
    return days * _SECONDS_PER_DAY


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]


DOC_TEXT_VERSION = 2


def doc_cache_key(url: str) -> str:
    return f"ris:doc:v{DOC_TEXT_VERSION}:{_digest(url)}"


def search_cache_key(payload: str) -> str:
    return f"ris:search:{_digest(payload)}"


def ingested_marker_key(collection: str, url: str) -> str:
    return f"ris:ingested:{collection}:{_digest(url)}"


async def cache_get_json(key: str) -> Any | None:
    if not _CACHE_AVAILABLE:
        return None
    try:
        return await asyncio.to_thread(_get_json, key)
    except Exception:
        logger.debug("RIS cache read failed for %s", key, exc_info=True)
        return None


async def cache_set_json(key: str, value: Any, ttl_seconds: int) -> None:
    if not _CACHE_AVAILABLE:
        return
    try:
        await asyncio.to_thread(_set_json, key, value, ttl_seconds)
    except Exception:
        logger.debug("RIS cache write failed for %s", key, exc_info=True)


async def fetch_document_cached(client: RisClient, url: str) -> RisDocument:
    from .client import RisDocument

    key = doc_cache_key(url)
    cached = await cache_get_json(key)
    if isinstance(cached, dict) and cached.get("text"):
        return RisDocument(
            url=cached.get("url", url),
            title=cached.get("title", ""),
            text=cached["text"],
        )

    document = await client.fetch_document_text(url)
    await cache_set_json(
        key,
        {"url": document.url, "title": document.title, "text": document.text},
        ris_cache_ttl_seconds(),
    )
    return document
