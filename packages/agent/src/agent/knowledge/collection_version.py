from __future__ import annotations

import logging
import os
import threading
import time

from agent.common import cache

logger = logging.getLogger(__name__)

_REDIS_URL_ENV = "REDIS_URL"

_KEY_PREFIX = "knowledge:collection-version:"

MEMO_TTL_SECONDS = float(os.environ.get("COLLECTION_VERSION_MEMO_SECONDS", "3.0"))

_UNKNOWN_LOG_INTERVAL_SECONDS = 60.0

_BUMP_LUA = """
local key = KEYS[1]
local floor = tonumber(ARGV[1])
local value = redis.call('INCR', key)
if value < floor then
  value = floor
  redis.call('SET', key, value)
end
return value
"""

_READ_LUA = """
local key = KEYS[1]
local floor = tonumber(ARGV[1])
local value = tonumber(redis.call('GET', key) or '0')
if value < floor then
  value = floor
  redis.call('SET', key, value)
end
return value
"""

_lock = threading.Lock()
_floors: dict[str, int] = {}
_memo: dict[str, tuple[float, int]] = {}
_unknown_logged_at: dict[str, float] = {}


def reset_local_versions() -> None:
    with _lock:
        _floors.clear()
        _memo.clear()
        _unknown_logged_at.clear()


def _shared_store_configured() -> bool:
    return bool(os.environ.get(_REDIS_URL_ENV))


def _eval(script: str, collection: str, floor: int) -> int | None:
    try:
        result = cache.eval_script(script, [_KEY_PREFIX + collection], [floor])
    except Exception:
        logger.warning("Collection version script failed for %s", collection, exc_info=True)
        return None
    if result is None:
        return None
    try:
        return int(result)
    except TypeError, ValueError:
        logger.warning("Collection version for %s came back non-numeric: %r", collection, result)
        return None


def _observe(collection: str, version: int) -> None:
    with _lock:
        if version > _floors.get(collection, 0):
            _floors[collection] = version
        _memo[collection] = (time.monotonic(), version)


def _log_unknown(collection: str) -> None:
    now = time.monotonic()
    with _lock:
        last = _unknown_logged_at.get(collection, 0.0)
        if last and now - last < _UNKNOWN_LOG_INTERVAL_SECONDS:
            return
        _unknown_logged_at[collection] = now
    logger.warning(
        "Collection write-version for %s is unresolvable (shared cache unavailable); "
        "retrieval result caching is disabled for it until the store answers again",
        collection,
    )


def bump(collection: str) -> None:
    configured = _shared_store_configured()
    with _lock:
        next_version = _floors.get(collection, 0) + 1
        _memo.pop(collection, None)
        if not configured:
            _floors[collection] = next_version
            _memo[collection] = (time.monotonic(), next_version)
    if not configured:
        return

    shared = _eval(_BUMP_LUA, collection, next_version)
    if shared is None:
        with _lock:
            _floors[collection] = _floors.get(collection, 0) + 1
        logger.warning(
            "Could not publish the write-version bump for %s to the shared cache; "
            "other replicas keep their cached results until the store returns",
            collection,
        )
        return
    _observe(collection, shared)


def current(collection: str) -> int | None:
    now = time.monotonic()
    with _lock:
        memo = _memo.get(collection)
        if memo is not None and now - memo[0] < MEMO_TTL_SECONDS:
            return memo[1]
        floor = _floors.get(collection, 0)

    if not _shared_store_configured():
        return floor

    shared = _eval(_READ_LUA, collection, floor)
    if shared is None:
        _log_unknown(collection)
        return None
    _observe(collection, shared)
    return shared
