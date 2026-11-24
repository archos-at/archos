import base64
import json
import logging
import os
import re
import threading
import time
import types
from enum import StrEnum

from agent.common import residency
from agent.common.org_config_shared import read_shared
from agent.common.org_config_shared import write_shared
from agent.common.residency import UNREADABLE_POLICY
from agent.common.residency import ProcessingPolicy
from agent.common.residency import parse_policy

logger = logging.getLogger(__name__)

MODEL_OVERRIDES_HEADER = "x-grid-model-overrides"

_POSITIVE_TTL_SECONDS = 10.0
_NEGATIVE_TTL_SECONDS = 1.0

_inflight_lock = threading.Lock()
_inflight_fetches: dict[str, threading.Lock] = {}


def _org_fetch_lock(organization_id: str) -> threading.Lock:
    with _inflight_lock:
        lock = _inflight_fetches.get(organization_id)
        if lock is None:
            if len(_inflight_fetches) > 512:
                for key, held in [(k, v) for k, v in _inflight_fetches.items() if not v.locked()]:
                    del _inflight_fetches[key]
                    del held
            lock = threading.Lock()
            _inflight_fetches[organization_id] = lock
        return lock


_REQUEST_TIMEOUT_SECONDS = 3.0

_MODEL_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,64}(/[A-Za-z0-9_.:-]{1,128})?$")


class AgentGroup(StrEnum):
    CLARIFIER = "clarifier"
    RESEARCH = "shallow_research"
    DEEP_RESEARCH = "deep_research"
    DEEP_RESEARCH_ROUTER = "deep_research_router"
    MEMORY_REFLECTION = "memory_reflection"
    FOLLOW_UPS = "follow_ups"
    INGEST_VLM = "ingest_vlm"


def parse_model_overrides(raw: str | None) -> dict[str, str]:
    if not raw:
        return {}
    try:
        padded = raw + "=" * (-len(raw) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
        data = json.loads(decoded)
    except Exception:
        logger.warning("Ignoring malformed %s header", MODEL_OVERRIDES_HEADER, exc_info=True)
        return {}
    return sanitize_model_overrides(data)


def sanitize_model_overrides(data: object) -> dict[str, str]:
    if not isinstance(data, dict):
        logger.warning("Ignoring model overrides: expected JSON object, got %s", type(data).__name__)
        return {}

    valid_groups = {g.value for g in AgentGroup}
    overrides: dict[str, str] = {}
    for group, model_id in data.items():
        if group not in valid_groups:
            logger.debug("Dropping model override for unknown agent group %r", group)
            continue
        if not isinstance(model_id, str) or not _MODEL_ID_RE.match(model_id):
            logger.warning("Dropping invalid model id %r for agent group %r", model_id, group)
            continue
        overrides[group] = model_id
    return overrides


class _OverridesCacheEntry:
    __slots__ = ("expires_at", "overrides", "processing", "zdr_only")

    def __init__(self, overrides: dict[str, str], zdr_only: bool, ttl: float, processing: ProcessingPolicy) -> None:
        self.overrides = overrides
        self.zdr_only = zdr_only
        self.processing = processing
        self.expires_at = time.monotonic() + ttl


_overrides_cache: dict[str, _OverridesCacheEntry] = {}
_overrides_cache_lock = threading.Lock()


def reset_overrides_cache() -> None:
    with _overrides_cache_lock:
        _overrides_cache.clear()


class _NoTrustChannel(RuntimeError): ...


_no_trust_channel_logged = False


def _log_no_trust_channel_once() -> None:
    global _no_trust_channel_logged
    if _no_trust_channel_logged:
        return
    _no_trust_channel_logged = True
    logger.error(
        "INTERNAL_API_TOKEN is not set: organization model settings cannot be read. "
        "Every organization runs on the YAML models with ZDR routing pinned until it is."
    )


def _fetch_org_config(organization_id: str) -> tuple[dict[str, str], bool, ProcessingPolicy]:
    token = os.environ.get("INTERNAL_API_TOKEN")
    if not token:
        raise _NoTrustChannel()

    import httpx

    base_url = (os.environ.get("FRONTEND_INTERNAL_URL") or "http://frontend:3000").rstrip("/")
    response = httpx.get(
        f"{base_url}/api/internal/model-overrides",
        params={"organizationId": organization_id},
        headers={"x-internal-token": token},
        timeout=_REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        return {}, False, UNREADABLE_POLICY
    overrides = payload.get("overrides")
    zdr_only = payload.get("zdrOnly") is True
    processing = parse_policy(payload.get("processingPolicy"))
    return (sanitize_model_overrides(overrides) if overrides else {}), zdr_only, processing


def _resolve_org_config(organization_id: str | None) -> _OverridesCacheEntry | None:
    if not organization_id:
        return None

    from agent.common.profiler import annotate_current_span

    now = time.monotonic()
    with _overrides_cache_lock:
        entry = _overrides_cache.get(organization_id)
        if entry is not None and entry.expires_at > now:
            annotate_current_span(cache_model_config="hit")
            return entry

    with _org_fetch_lock(organization_id):
        return _resolve_org_config_locked(organization_id)


def _resolve_org_config_locked(organization_id: str) -> _OverridesCacheEntry:
    from agent.common.profiler import annotate_current_span

    now = time.monotonic()
    with _overrides_cache_lock:
        entry = _overrides_cache.get(organization_id)
        if entry is not None and entry.expires_at > now:
            annotate_current_span(cache_model_config="hit-coalesced")
            return entry

    shared = read_shared(organization_id)
    if shared is not None:
        overrides, zdr_only, processing = shared
        overrides = sanitize_model_overrides(overrides)
        ttl = _POSITIVE_TTL_SECONDS
        annotate_current_span(cache_model_config="hit-shared")
    else:
        try:
            overrides, zdr_only, processing = _fetch_org_config(organization_id)
            ttl = _POSITIVE_TTL_SECONDS
            write_shared(organization_id, overrides, zdr_only, processing)
            annotate_current_span(cache_model_config="miss")
        except _NoTrustChannel:
            _log_no_trust_channel_once()
            overrides, zdr_only, processing = {}, True, UNREADABLE_POLICY
            ttl = _POSITIVE_TTL_SECONDS
            annotate_current_span(cache_model_config="no-trust-channel")
        except Exception as exc:  # noqa: BLE001 - models fail open, ZDR fails closed
            logger.warning(
                "Org model-config resolution failed for org %s: %s; YAML models, ZDR routing pinned",
                organization_id,
                type(exc).__name__,
            )
            overrides, zdr_only, processing = {}, True, UNREADABLE_POLICY
            ttl = _NEGATIVE_TTL_SECONDS
            annotate_current_span(cache_model_config="error")

    entry = _OverridesCacheEntry(overrides, zdr_only, ttl, processing)
    with _overrides_cache_lock:
        _overrides_cache[organization_id] = entry
        if len(_overrides_cache) > 512:
            expired = [key for key, value in _overrides_cache.items() if value.expires_at <= now]
            for key in expired:
                _overrides_cache.pop(key, None)

    return entry


def resolve_org_model_overrides(organization_id: str | None) -> dict[str, str]:
    entry = _resolve_org_config(organization_id)
    return entry.overrides if entry is not None else {}


def resolve_org_zdr_only(organization_id: str | None) -> bool:
    entry = _resolve_org_config(organization_id)
    if residency.active_cell() is not None:  # a cell's promise is zero retention: the org switch cannot lift it
        return True
    return entry.zdr_only if entry is not None else False


def resolve_org_processing_policy(organization_id: str | None, *, cached_only: bool = False) -> ProcessingPolicy | None:
    if cached_only:
        hit = _overrides_cache.get(organization_id or "")
        return hit.processing if hit is not None and hit.expires_at > time.monotonic() else None
    entry = _resolve_org_config(organization_id)
    return entry.processing if entry is not None else UNREADABLE_POLICY


def get_model_overrides_from_context() -> dict[str, str]:
    from agent.project_context import _read_header
    from agent.project_context import get_signed_request_context

    envelope = get_signed_request_context()
    if envelope is not None:
        if envelope.model_overrides is not None:
            return sanitize_model_overrides(envelope.model_overrides)
        return resolve_org_model_overrides(envelope.organization_id)

    raw = _read_header(MODEL_OVERRIDES_HEADER)
    if raw:
        return parse_model_overrides(raw)

    from agent.project_context import get_organization_id_from_context

    return resolve_org_model_overrides(get_organization_id_from_context())


def get_zdr_only_from_context() -> bool:
    from agent.project_context import get_organization_id_from_context

    return resolve_org_zdr_only(get_organization_id_from_context())


def _rebind_instance_method_patches(original: object, copy_obj: object) -> None:
    try:
        attrs = list(vars(copy_obj).items())
    except TypeError:
        return
    for name, attr in attrs:
        if isinstance(attr, types.MethodType) and attr.__self__ is original:
            object.__setattr__(copy_obj, name, types.MethodType(attr.__func__, copy_obj))


def override_model(llm: object, model_id: str) -> object:
    field = None
    if hasattr(llm, "model_name"):
        field = "model_name"
    elif hasattr(llm, "model"):
        field = "model"
    if field is None or not hasattr(llm, "model_copy"):
        logger.warning("Cannot apply model override to %s: no model field/model_copy", type(llm).__name__)
        return llm
    try:
        overridden = llm.model_copy(update={field: model_id})
    except Exception:
        logger.warning("Failed to apply model override %r to %s", model_id, type(llm).__name__, exc_info=True)
        return llm
    _rebind_instance_method_patches(llm, overridden)
    return overridden


def override_reasoning_effort(llm: object, effort: str) -> object:
    if not hasattr(llm, "reasoning_effort") or not hasattr(llm, "model_copy"):
        logger.debug("Cannot apply reasoning effort to %s: no reasoning_effort field", type(llm).__name__)
        return llm
    if getattr(llm, "reasoning_effort", None) == effort:
        return llm
    try:
        overridden = llm.model_copy(update={"reasoning_effort": effort})
    except Exception:
        logger.warning("Failed to apply reasoning effort %r to %s", effort, type(llm).__name__, exc_info=True)
        return llm
    _rebind_instance_method_patches(llm, overridden)
    return overridden


def _merge_zdr_extra_body(extra_body: object) -> dict[str, object]:
    from agent.common.openrouter import ZERO_DATA_RETENTION

    return ZERO_DATA_RETENTION.apply(extra_body if isinstance(extra_body, dict) else None)


def apply_zdr_routing(llm: object) -> object:
    from agent.common.openrouter import ZERO_DATA_RETENTION
    from agent.common.openrouter import pin_chat_model

    return pin_chat_model(llm, ZERO_DATA_RETENTION)


def is_reasoning_incompatible_error(err: BaseException) -> bool:
    msg = str(err).lower()
    if "reasoning" not in msg:
        return False
    return "mandatory" in msg or "cannot be disabled" in msg or "code: 400" in msg or "[400]" in msg


def apply_model_override(
    llm: object,
    group: AgentGroup,
    overrides: dict[str, str] | None = None,
    zdr_only: bool | None = None,
    reasoning_effort: str | None = None,
) -> object:
    if overrides is None:
        overrides = get_model_overrides_from_context()
    if zdr_only is None:
        zdr_only = get_zdr_only_from_context()
    if reasoning_effort is None:
        from agent.common.reasoning_settings import get_reasoning_effort

        reasoning_effort = get_reasoning_effort(group.value)
    model_id = overrides.get(group.value)
    result = llm
    if model_id:
        logger.info("Model override active: agent group %s -> %s", group.value, model_id)
        result = override_model(llm, model_id)
    if reasoning_effort:
        logger.info("Reasoning effort active: agent group %s -> %s", group.value, reasoning_effort)
        result = override_reasoning_effort(result, reasoning_effort)
    if zdr_only:
        result = apply_zdr_routing(result)
    return result
