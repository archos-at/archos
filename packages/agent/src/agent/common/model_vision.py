from __future__ import annotations

import contextvars
import logging
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

logger = logging.getLogger(__name__)

CATALOG_URL = "https://openrouter.ai/api/v1/models"

_CATALOG_TTL_SECONDS = 6 * 3600
_FAILURE_TTL_SECONDS = 300
_TIMEOUT_SECONDS = 5.0

_lock = threading.Lock()
_catalog: dict[str, bool] = {}
_catalog_read_at = 0.0
_catalog_failed_at: float | None = None

_turn_model: contextvars.ContextVar[str | None] = contextvars.ContextVar("turn_chat_model", default=None)


def model_name_of(llm: Any) -> str | None:
    for attribute in ("model_name", "model"):
        value = getattr(llm, attribute, None)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


@contextmanager
def chat_model_scope(model_id: str | None) -> Iterator[None]:
    token = _turn_model.set(model_id)
    try:
        yield
    finally:
        _turn_model.reset(token)


def current_chat_model() -> str | None:
    return _turn_model.get()


def _modalities(entry: dict[str, Any]) -> list[str] | None:
    architecture = entry.get("architecture")
    value = architecture.get("input_modalities") if isinstance(architecture, dict) else None
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else None


def parse_catalog(body: object) -> dict[str, bool]:
    data = body.get("data") if isinstance(body, dict) else None
    parsed: dict[str, bool] = {}
    for entry in data if isinstance(data, list) else []:
        if not isinstance(entry, dict) or not isinstance(entry.get("id"), str):
            continue
        modalities = _modalities(entry)
        if modalities:
            parsed[entry["id"]] = "image" in modalities
    return parsed


def _fetch_catalog() -> dict[str, bool] | None:
    try:
        import httpx

        response = httpx.get(CATALOG_URL, timeout=_TIMEOUT_SECONDS)
        response.raise_for_status()
        return parse_catalog(response.json())
    except Exception:  # noqa: BLE001 - unknown is the fail-open answer
        logger.warning("The model catalog could not be read; image input is assumed", exc_info=True)
        return None


def _refreshed_catalog() -> dict[str, bool]:
    global _catalog, _catalog_read_at, _catalog_failed_at
    now = time.monotonic()
    with _lock:
        fresh = _catalog and now - _catalog_read_at < _CATALOG_TTL_SECONDS
        backing_off = _catalog_failed_at is not None and now - _catalog_failed_at < _FAILURE_TTL_SECONDS
        if fresh or backing_off:
            return _catalog
        fetched = _fetch_catalog()
        if fetched is None:
            _catalog_failed_at = now
            return _catalog
        _catalog, _catalog_read_at = fetched, now
        return _catalog


def model_accepts_images(model_id: str | None) -> bool | None:
    if not model_id:
        return None
    catalog = _refreshed_catalog()
    base = model_id.split(":", 1)[0]
    return catalog.get(model_id, catalog.get(base))


def turn_model_accepts_images() -> bool | None:
    return model_accepts_images(current_chat_model())


def reset_catalog_cache() -> None:
    global _catalog, _catalog_read_at, _catalog_failed_at
    with _lock:
        _catalog, _catalog_read_at, _catalog_failed_at = {}, 0.0, None
