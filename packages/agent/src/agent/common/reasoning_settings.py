import logging
import os
import threading
import time
from contextvars import ContextVar

logger = logging.getLogger(__name__)

_POSITIVE_TTL_SECONDS = 60.0
_NEGATIVE_TTL_SECONDS = 30.0
_REQUEST_TIMEOUT_SECONDS = 5.0

_EFFORTS: frozenset[str] = frozenset({"none", "minimal", "low", "medium", "high", "xhigh"})

CHAT_EFFORTS: tuple[str, ...] = ("minimal", "low", "medium", "high", "xhigh")

_turn_effort: ContextVar[str | None] = ContextVar("turn_reasoning_effort", default=None)


class _CacheEntry:
    __slots__ = ("efforts", "expires_at")

    def __init__(self, efforts: dict[str, str], ttl: float) -> None:
        self.efforts = efforts
        self.expires_at = time.monotonic() + ttl


_cache: _CacheEntry | None = None
_cache_lock = threading.Lock()


def reset_reasoning_settings_cache() -> None:
    global _cache
    with _cache_lock:
        _cache = None


def sanitize_reasoning_efforts(data: object) -> dict[str, str]:
    from agent.common.model_overrides import AgentGroup

    if not isinstance(data, dict):
        logger.warning("Ignoring reasoning efforts: expected JSON object, got %s", type(data).__name__)
        return {}

    valid_groups = {group.value for group in AgentGroup}
    efforts: dict[str, str] = {}
    for group, effort in data.items():
        if group not in valid_groups:
            logger.debug("Dropping reasoning effort for unknown agent group %r", group)
            continue
        if not isinstance(effort, str) or effort not in _EFFORTS:
            logger.warning("Dropping invalid reasoning effort %r for agent group %r", effort, group)
            continue
        efforts[group] = effort
    return efforts


def _fetch_efforts() -> dict[str, str]:
    token = os.environ.get("INTERNAL_API_TOKEN")
    if not token:
        return {}

    import httpx

    base_url = (os.environ.get("FRONTEND_INTERNAL_URL") or "http://frontend:3000").rstrip("/")
    response = httpx.get(
        f"{base_url}/api/internal/reasoning-efforts",
        headers={"x-internal-token": token},
        timeout=_REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        return {}
    efforts = payload.get("efforts")
    return sanitize_reasoning_efforts(efforts) if efforts else {}


def _resolve() -> dict[str, str]:
    global _cache
    now = time.monotonic()
    from agent.common.profiler import annotate_current_span

    with _cache_lock:
        if _cache is not None and _cache.expires_at > now:
            annotate_current_span(cache_reasoning_settings="hit")
            return _cache.efforts

    annotate_current_span(cache_reasoning_settings="miss")
    try:
        efforts = _fetch_efforts()
        ttl = _POSITIVE_TTL_SECONDS if efforts else _NEGATIVE_TTL_SECONDS
    except Exception as exc:  # noqa: BLE001 - fail open by design
        logger.warning("Reasoning-effort resolution failed: %s", type(exc).__name__)
        efforts, ttl = {}, _NEGATIVE_TTL_SECONDS

    with _cache_lock:
        _cache = _CacheEntry(efforts, ttl)
    return efforts


def get_reasoning_effort(group: str) -> str | None:
    return _resolve().get(group)


def get_reasoning_efforts() -> dict[str, str]:
    return dict(_resolve())


def set_turn_reasoning_effort(effort: str | None) -> None:
    _turn_effort.set(effort if effort in CHAT_EFFORTS else None)


def get_turn_reasoning_effort() -> str | None:
    return _turn_effort.get()


def effort_of(llm: object) -> str | None:
    effort = getattr(llm, "reasoning_effort", None)
    return effort if effort in _EFFORTS else None
