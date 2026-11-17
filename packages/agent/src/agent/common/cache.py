from __future__ import annotations

import json
import logging
import os
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from dataclasses import replace
from typing import Any

try:
    from redis import exceptions as _redis_exceptions
except ImportError:  # pragma: no cover - redis is optional; no client either
    _redis_exceptions = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

_REDIS_URL_ENV = "REDIS_URL"

_MAX_LOCAL_ENTRIES = 2048

_local_store: dict[str, tuple[float, str]] = {}
_local_lock = threading.Lock()

_TOMBSTONE_TTL_SECONDS = 30.0
_local_tombstones: dict[str, float] = {}

_client: Any | None = None
_client_failed_at: float | None = None
_client_lock = threading.Lock()

_CLIENT_RETRY_SECONDS = 30.0


_STORE_DOWN_WARN_INTERVAL_SECONDS = 300.0

_store_down_warned_at: float | None = None
_warn_lock = threading.Lock()


@dataclass(frozen=True)
class CacheCounters:
    shared_hits: int = 0
    shared_misses: int = 0
    local_hits: int = 0
    local_misses: int = 0
    errors: int = 0

    def __bool__(self) -> bool:
        return any(vars(self).values())

    def since(self, earlier: CacheCounters) -> CacheCounters:
        return CacheCounters(
            shared_hits=self.shared_hits - earlier.shared_hits,
            shared_misses=self.shared_misses - earlier.shared_misses,
            local_hits=self.local_hits - earlier.local_hits,
            local_misses=self.local_misses - earlier.local_misses,
            errors=self.errors - earlier.errors,
        )

    def as_facts(self, prefix: str = "cache") -> dict[str, int]:
        return {f"{prefix}_{name}": value for name, value in vars(self).items()}


_process_counters = CacheCounters()
_counters_lock = threading.Lock()

_turn_counters: ContextVar[CacheCounters | None] = ContextVar("turn_cache_counters", default=None)


def _count(**deltas: int) -> None:
    global _process_counters
    with _counters_lock:
        _process_counters = replace(
            _process_counters, **{name: getattr(_process_counters, name) + value for name, value in deltas.items()}
        )
    scoped = _turn_counters.get()
    if scoped is not None:
        _turn_counters.set(replace(scoped, **{name: getattr(scoped, name) + value for name, value in deltas.items()}))


def cache_counters() -> CacheCounters:
    scoped = _turn_counters.get()
    return scoped if scoped is not None else _process_counters


@contextmanager
def count_cache_operations() -> Iterator[None]:
    token = _turn_counters.set(CacheCounters())
    try:
        yield
    finally:
        _turn_counters.reset(token)


def _warn_store_down(message: str, *args: Any) -> None:
    global _store_down_warned_at
    now = time.monotonic()
    with _warn_lock:
        first = _store_down_warned_at is None or now - _store_down_warned_at >= _STORE_DOWN_WARN_INTERVAL_SECONDS
        if first:
            _store_down_warned_at = now
    if first:
        logger.warning(message, *args, exc_info=True)
    else:
        logger.debug(message, *args)


def _get_client() -> Any | None:
    global _client, _client_failed_at
    url = os.environ.get(_REDIS_URL_ENV)
    if not url:
        return None
    with _client_lock:
        if _client is not None:
            return _client
        if _client_failed_at is not None and time.monotonic() - _client_failed_at < _CLIENT_RETRY_SECONDS:
            return None
        try:
            import redis

            _client = redis.Redis.from_url(
                url,
                decode_responses=True,
                socket_timeout=0.5,
                socket_connect_timeout=0.5,
            )
            return _client
        except Exception:
            _warn_store_down("Shared cache unavailable; using in-process fallback")
            _count(errors=1)
            _client_failed_at = time.monotonic()
            return None


def _mark_client_failed() -> None:
    global _client, _client_failed_at
    with _client_lock:
        _client = None
        _client_failed_at = time.monotonic()


def _exc_type(name: str) -> Any | None:
    return getattr(_redis_exceptions, name, None) if _redis_exceptions is not None else None


_STORE_DOWN_ERRORS: tuple[type, ...] = tuple(
    t
    for t in (
        _exc_type("ConnectionError"),
        _exc_type("TimeoutError"),
        _exc_type("AuthenticationError"),  # subclass of ConnectionError; persistent misconfig
        _exc_type("BusyLoadingError"),  # subclass of ConnectionError; server starting
        _exc_type("NoPermissionError"),  # ACL rejection is per-deployment, not per-key
        _exc_type("OutOfMemoryError"),  # store full: every write fails, not this key
        _exc_type("ReadOnlyError"),  # replica/failover: every write fails
        _exc_type("ClusterDownError"),
        _exc_type("MasterDownError"),
        _exc_type("InvalidResponse"),
    )
    if isinstance(t, type)
)
_MAX_CONNECTIONS_ERROR: Any | None = _exc_type("MaxConnectionsError")


def _is_transport_error(exc: BaseException) -> bool:
    if _redis_exceptions is None:
        return False
    if _MAX_CONNECTIONS_ERROR is not None and isinstance(exc, _MAX_CONNECTIONS_ERROR):
        return False
    return isinstance(exc, _STORE_DOWN_ERRORS) if _STORE_DOWN_ERRORS else False


def _on_store_error(operation: str, key: str, exc: BaseException) -> None:
    _count(errors=1)
    if _is_transport_error(exc):
        _warn_store_down("Shared cache %s failed for %s; falling back", operation, key)
        _mark_client_failed()
    else:
        logger.debug("Shared cache %s rejected for %s: %s", operation, key, exc)


def _local_get(key: str) -> str | None:
    with _local_lock:
        entry = _local_store.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if time.monotonic() >= expires_at:
            _local_store.pop(key, None)
            return None
        return value


def _local_set(key: str, value: str, ttl_seconds: float) -> None:
    with _local_lock:
        if len(_local_store) >= _MAX_LOCAL_ENTRIES:
            for stale in sorted(_local_store, key=lambda k: _local_store[k][0])[: len(_local_store) // 4]:
                _local_store.pop(stale, None)
        _local_store[key] = (time.monotonic() + ttl_seconds, value)


def reset_local_store() -> None:
    global _store_down_warned_at, _process_counters
    with _local_lock:
        _local_store.clear()
        _local_tombstones.clear()
    with _warn_lock:
        _store_down_warned_at = None
    with _counters_lock:
        _process_counters = CacheCounters()
    scoped = _turn_counters.get()
    if scoped is not None:
        _turn_counters.set(CacheCounters())


def _tombstone_active(key: str) -> bool:
    with _local_lock:
        expires_at = _local_tombstones.get(key)
        if expires_at is None:
            return False
        if time.monotonic() >= expires_at:
            _local_tombstones.pop(key, None)
            return False
        return True


def get_json(key: str) -> Any | None:
    if _tombstone_active(key):
        _count(local_misses=1)
        return None
    client = _get_client()
    if client is not None:
        try:
            raw = client.get(key)
            if raw is None:
                _count(shared_misses=1)
                return None
            value = json.loads(raw)
            _count(shared_hits=1)
            return value
        except Exception as exc:
            _on_store_error("read", key, exc)
            if not _is_transport_error(exc):
                return None
    raw = _local_get(key)
    if raw is None:
        _count(local_misses=1)
        return None
    try:
        value = json.loads(raw)
    except TypeError, ValueError:
        _count(errors=1)
        return None
    _count(local_hits=1)
    return value


def set_json(key: str, value: Any, ttl_seconds: float) -> None:
    try:
        raw = json.dumps(value)
    except TypeError, ValueError:
        logger.warning("Refusing to cache non-JSON-serializable value for %s", key)
        return
    client = _get_client()
    if client is not None:
        try:
            client.set(key, raw, px=int(ttl_seconds * 1000))
            with _local_lock:
                _local_tombstones.pop(key, None)
            return
        except Exception as exc:
            _on_store_error("write", key, exc)
            if not _is_transport_error(exc):
                return
    _local_set(key, raw, ttl_seconds)
    with _local_lock:
        _local_tombstones.pop(key, None)


def delete(key: str) -> bool:
    client = _get_client()
    if client is not None:
        try:
            client.delete(key)
        except Exception as exc:
            _on_store_error("delete", key, exc)
            with _local_lock:
                _local_store.pop(key, None)
                _local_tombstones[key] = time.monotonic() + _TOMBSTONE_TTL_SECONDS
            return False
        with _local_lock:
            _local_store.pop(key, None)
            _local_tombstones.pop(key, None)
        return True
    with _local_lock:
        _local_store.pop(key, None)
    return True


def _repair_window_ttl(client: Any, key: str, window_seconds: int, cause: BaseException) -> None:
    ttl = client.ttl(key)
    if isinstance(ttl, int) and ttl >= 0:
        return
    logger.warning(
        "Shared cache dropped EXPIRE on %s (%s); repairing the window TTL",
        key,
        type(cause).__name__,
    )
    client.expire(key, window_seconds)


def incr_fixed_window(key: str, window_seconds: int) -> int | None:
    client = _get_client()
    if client is not None:
        try:
            pipe = client.pipeline()
            pipe.incr(key)
            pipe.expire(key, window_seconds, nx=True)
            try:
                results = pipe.execute(raise_on_error=False)
            except TypeError:
                results = pipe.execute()
            count = results[0] if isinstance(results, (list, tuple)) else results
            if isinstance(count, BaseException):
                raise count
            expire = results[1] if isinstance(results, (list, tuple)) and len(results) > 1 else None
            if isinstance(expire, BaseException):
                _repair_window_ttl(client, key, window_seconds, expire)
            return int(count)
        except Exception as exc:
            _on_store_error("incr", key, exc)
            if not _is_transport_error(exc):
                return None
    with _local_lock:
        entry = _local_store.get(key)
        now = time.monotonic()
        if entry is None or now >= entry[0]:
            _local_store[key] = (now + window_seconds, "1")
            return 1
        try:
            count = int(entry[1]) + 1
        except TypeError, ValueError:
            _local_store[key] = (now + window_seconds, "1")
            return 1
        _local_store[key] = (entry[0], str(count))
        return count


def eval_script(script: str, keys: list[str], args: list[Any]) -> Any | None:
    client = _get_client()
    if client is None:
        return None
    try:
        return client.eval(script, len(keys), *keys, *args)
    except Exception as exc:
        _count(errors=1)
        if _is_transport_error(exc):
            _warn_store_down("Shared cache eval failed")
            _mark_client_failed()
        else:
            logger.debug("Shared cache eval rejected by server: %s", exc)
        return None
