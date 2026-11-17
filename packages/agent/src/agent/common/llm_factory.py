from __future__ import annotations

import logging
from collections import OrderedDict
from contextlib import nullcontext
from typing import Any

from agent.common import provider_limiter
from agent.common import residency
from agent.common.licensed_reply import ChunkCap
from agent.common.licensed_reply import capped_result
from agent.common.licensed_text import expand_messages
from agent.common.licensed_text import licensed_scope_active
from agent.common.licensed_text import refuse_unattested_model_read
from agent.common.message_contract import normalize_chat_request
from agent.common.openrouter import targets_openrouter
from nat.plugin_api import LLMFrameworkEnum
from nat.utils.exception_handlers.automatic_retries import patch_with_retry

logger = logging.getLogger(__name__)

_RESPONSE_HEALING_PLUGIN = {"id": "response-healing"}

_CONTRACT_MARKER = "__request_contract__"

_CONTRACT_SUBCLASSES: dict[type, type] = {}

_STREAMED_RATE_LIMIT_MESSAGES = ("rate_limit_exceeded",)


_REASONING_FLOOR = "minimal"

_REASONING_MANDATORY: OrderedDict[str, None] = OrderedDict()
_REASONING_MANDATORY_MAX = 64


def retry_messages(configured: list[str] | None) -> list[str]:
    merged = list(configured or [])
    merged.extend(m for m in _STREAMED_RATE_LIMIT_MESSAGES if m not in merged)
    return merged


def _llm_base_url(llm: Any) -> str:
    for attr in ("openai_api_base", "base_url"):
        value = getattr(llm, attr, None)
        if value:
            return str(value)
    client = getattr(llm, "async_client", None) or getattr(llm, "client", None)
    base = getattr(client, "base_url", None)
    return str(base) if base else ""


def _with_openrouter_structured_defaults(extra_body: Any) -> dict[str, Any]:
    merged: dict[str, Any] = dict(extra_body) if isinstance(extra_body, dict) else {}

    plugins = list(merged.get("plugins") or [])
    if not any(isinstance(p, dict) and p.get("id") == _RESPONSE_HEALING_PLUGIN["id"] for p in plugins):
        plugins.append(dict(_RESPONSE_HEALING_PLUGIN))
    merged["plugins"] = plugins

    return merged


def llm_targets_openrouter(llm: Any) -> bool:
    return targets_openrouter(_llm_base_url(llm))


def apply_openrouter_structured_defaults(llm: Any) -> Any:
    if not llm_targets_openrouter(llm):
        return llm
    if not hasattr(llm, "extra_body"):
        return llm

    merged = _with_openrouter_structured_defaults(getattr(llm, "extra_body", None))
    if merged == getattr(llm, "extra_body", None):
        return llm
    try:
        llm.extra_body = merged
    except Exception:  # noqa: BLE001 - never let hardening break model resolution
        logger.warning("Could not apply OpenRouter structured defaults to %s", type(llm).__name__, exc_info=True)
    return llm


def disable_previous_response_id(llm: Any) -> Any:
    if not llm_targets_openrouter(llm):
        return llm
    if not getattr(llm, "use_previous_response_id", False):
        return llm
    try:
        llm.use_previous_response_id = False
    except Exception:  # noqa: BLE001 - never let hardening break model resolution
        logger.warning("Could not disable previous_response_id on %s", type(llm).__name__, exc_info=True)
    return llm


def _request_organization_id() -> str | None:
    try:
        from agent.project_context import get_organization_id_from_context

        return get_organization_id_from_context()
    except Exception:  # noqa: BLE001 - identity is a cache-key ingredient, never a precondition
        logger.debug("Could not read the organization id for the prompt-cache key", exc_info=True)
        return None


def prepare_request(llm: Any, messages: Any, kwargs: dict[str, Any]) -> Any:
    from agent.common.prompt_caching import prompt_cache_extra_body
    from agent.common.prompt_caching import strip_block_breakpoints

    model = getattr(llm, "model_name", None) or getattr(llm, "model", None)
    on_openrouter = llm_targets_openrouter(llm)
    normalized = strip_block_breakpoints(normalize_chat_request(messages), model, openrouter=on_openrouter)
    if not on_openrouter:
        return normalized

    base = getattr(llm, "extra_body", None)
    merged_base = {**(dict(base) if isinstance(base, dict) else {}), **(kwargs.get("extra_body") or {})}
    extra_body = prompt_cache_extra_body(
        normalized,
        kwargs,
        extra_body=merged_base,
        organization_id=_request_organization_id(),
        model=model,
    )
    if extra_body is not None:
        kwargs["extra_body"] = extra_body
    return normalized


def _model_label(llm: Any) -> str | None:
    name = getattr(llm, "model_name", None) or getattr(llm, "model", None)
    return str(name) if name else None


def _provider_slot(llm: Any):
    if not llm_targets_openrouter(llm):
        return nullcontext()
    return provider_limiter.slot(model=_model_label(llm))


def _provider_slot_async(llm: Any):
    if not llm_targets_openrouter(llm):
        return nullcontext()
    return provider_limiter.aslot(model=_model_label(llm))


def _reasoning_off(llm: Any) -> bool:
    return getattr(llm, "reasoning_effort", None) == "none"


def _with_reasoning_floor(llm: Any) -> Any:
    if not _reasoning_off(llm) or _model_label(llm) not in _REASONING_MANDATORY:
        return llm
    return llm.model_copy(update={"reasoning_effort": _REASONING_FLOOR})


def _needs_reasoning_floor(llm: Any, target: Any, error: BaseException) -> bool:
    from agent.common.model_overrides import is_reasoning_incompatible_error

    if target is not llm or not _reasoning_off(llm) or not is_reasoning_incompatible_error(error):
        return False
    model = _model_label(llm) or "?"
    if model not in _REASONING_MANDATORY:
        logger.warning(
            "Model %s cannot run with reasoning off; sending its calls at reasoning_effort=%s. "
            "Add it to REASONING_MANDATORY_PREFIXES so the admin UI stops offering it to reasoning-off groups.",
            model,
            _REASONING_FLOOR,
        )
    _REASONING_MANDATORY[model] = None
    while len(_REASONING_MANDATORY) > _REASONING_MANDATORY_MAX:
        _REASONING_MANDATORY.popitem(last=False)
    return True


def _expanded(llm: Any, messages: Any, kwargs: dict[str, Any]) -> tuple[Any, Any]:
    from agent.common.openrouter import ZERO_DATA_RETENTION

    body = {**(getattr(llm, "extra_body", None) or {}), **(kwargs.get("extra_body") or {})}
    on_openrouter = llm_targets_openrouter(llm)
    if licensed_scope_active():  # work on a licensed document goes to zero retention, whatever the org chose
        refuse_unattested_model_read(_llm_base_url(llm), openrouter=on_openrouter)
        body = kwargs["extra_body"] = ZERO_DATA_RETENTION.apply(body)
    pinned = on_openrouter and ZERO_DATA_RETENTION.is_applied_to(body)
    return expand_messages(messages, zero_retention=pinned)


def _route(llm: Any) -> residency.Route:
    return residency.enforce(_llm_base_url(llm), rewrite=False)[1]


def _capped_chunk(chunk: Any, cap: Any, run_manager: Any) -> Any:
    if cap is None:
        return chunk
    capper = _chunk_capper(cap)
    capped = capper.chunk(chunk)
    if run_manager is not None:
        run_manager.on_llm_new_token(capped.text, chunk=capped)
    return capped


async def _acapped_chunk(chunk: Any, cap: Any, run_manager: Any) -> Any:
    if cap is None:
        return chunk
    capped = _chunk_capper(cap).chunk(chunk)
    if run_manager is not None:
        await run_manager.on_llm_new_token(capped.text, chunk=capped)
    return capped


def _chunk_capper(cap: Any) -> ChunkCap:
    capper = getattr(cap, "chunk_capper", None)
    if capper is None:
        capper = cap.chunk_capper = ChunkCap(cap)
    return capper


def _contract_generate(base: type) -> Any:

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        residency.check_current_organization()
        route = _route(self)
        prepared, cap = _expanded(self, prepare_request(self, messages, kwargs), kwargs)
        target = _with_reasoning_floor(self)
        with _provider_slot(self):
            try:
                result = base._generate(target, prepared, stop=stop, run_manager=run_manager, **kwargs)
                return residency.stamp_result(capped_result(result, cap), route)
            except Exception as exc:
                if not _needs_reasoning_floor(self, target, exc):
                    raise
            floored = _with_reasoning_floor(self)
            result = base._generate(floored, prepared, stop=stop, run_manager=run_manager, **kwargs)
            return residency.stamp_result(capped_result(result, cap), route)

    return _generate


def _contract_agenerate(base: type) -> Any:

    async def _agenerate(self, messages, stop=None, run_manager=None, **kwargs):
        await residency.acheck_current_organization()
        route = _route(self)
        prepared, cap = _expanded(self, prepare_request(self, messages, kwargs), kwargs)
        target = _with_reasoning_floor(self)
        async with _provider_slot_async(self):
            try:
                result = await base._agenerate(target, prepared, stop=stop, run_manager=run_manager, **kwargs)
                return residency.stamp_result(capped_result(result, cap), route)
            except Exception as exc:
                if not _needs_reasoning_floor(self, target, exc):
                    raise
            floored = _with_reasoning_floor(self)
            result = await base._agenerate(floored, prepared, stop=stop, run_manager=run_manager, **kwargs)
            return residency.stamp_result(capped_result(result, cap), route)

    return _agenerate


def _contract_stream(base: type) -> Any:

    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        residency.check_current_organization()
        route = _route(self)
        prepared, cap = _expanded(self, prepare_request(self, messages, kwargs), kwargs)
        target = _with_reasoning_floor(self)
        inner_manager = None if cap is not None else run_manager
        with _provider_slot(self):
            started = False
            try:
                for chunk in base._stream(target, prepared, stop=stop, run_manager=inner_manager, **kwargs):
                    first, started = not started, True
                    yield residency.stamp_chunk(_capped_chunk(chunk, cap, run_manager), route if first else None)
                return
            except Exception as exc:
                if started or not _needs_reasoning_floor(self, target, exc):
                    raise
            floored = _with_reasoning_floor(self)
            for chunk in base._stream(floored, prepared, stop=stop, run_manager=inner_manager, **kwargs):
                yield residency.stamp_chunk(_capped_chunk(chunk, cap, run_manager), route)
                route = None

    return _stream


def _contract_astream(base: type) -> Any:

    async def _astream(self, messages, stop=None, run_manager=None, **kwargs):
        await residency.acheck_current_organization()
        route = _route(self)
        prepared, cap = _expanded(self, prepare_request(self, messages, kwargs), kwargs)
        target = _with_reasoning_floor(self)
        inner_manager = None if cap is not None else run_manager
        async with _provider_slot_async(self):
            started = False
            try:
                async for chunk in base._astream(target, prepared, stop=stop, run_manager=inner_manager, **kwargs):
                    first, started = not started, True
                    capped = await _acapped_chunk(chunk, cap, run_manager)
                    yield residency.stamp_chunk(capped, route if first else None)
                return
            except Exception as exc:
                if started or not _needs_reasoning_floor(self, target, exc):
                    raise
            floored = _with_reasoning_floor(self)
            async for chunk in base._astream(floored, prepared, stop=stop, run_manager=inner_manager, **kwargs):
                yield residency.stamp_chunk(await _acapped_chunk(chunk, cap, run_manager), route)
                route = None

    return _astream


def _contract_subclass(base: type) -> type:
    cached = _CONTRACT_SUBCLASSES.get(base)
    if cached is not None:
        return cached

    from langchain_core.language_models.chat_models import BaseChatModel

    _generate = _contract_generate(base)
    _agenerate = _contract_agenerate(base)
    _stream = _contract_stream(base)
    _astream = _contract_astream(base)

    namespace: dict[str, Any] = {_CONTRACT_MARKER: True, "_generate": _generate, "_agenerate": _agenerate}
    if base._stream is not BaseChatModel._stream:
        namespace["_stream"] = _stream
    if base._astream is not BaseChatModel._astream:
        namespace["_astream"] = _astream

    subclass = type(f"RequestContract{base.__name__}", (base,), namespace)
    _CONTRACT_SUBCLASSES[base] = subclass
    return subclass


def enforce_chat_request_contract(llm: Any) -> Any:
    base = type(llm)
    if getattr(base, _CONTRACT_MARKER, False):
        return llm
    try:
        llm.__class__ = _contract_subclass(base)
    except Exception:  # noqa: BLE001 - hardening must never break model resolution
        logger.warning("Could not enforce the chat-request contract on %s", base.__name__, exc_info=True)
    return llm




async def get_langchain_llm(builder: Any, ref: Any) -> Any:
    wrapped = await builder.get_llm(ref, wrapper_type=LLMFrameworkEnum.LANGCHAIN)
    config = builder.get_llm_config(ref)
    llm = patch_with_retry(
        wrapped.default,
        retries=config.num_retries,
        retry_codes=config.retry_on_status_codes,
        retry_on_messages=retry_messages(config.retry_on_errors),
    )
    hardened = disable_previous_response_id(apply_openrouter_structured_defaults(llm))
    return enforce_chat_request_contract(hardened)


def strict_response_format(schema: Any) -> Any:
    from langchain.agents.structured_output import ProviderStrategy

    return ProviderStrategy(schema, strict=True)


def strict_json_response_format(schema: Any) -> dict[str, Any]:
    return strict_response_format(schema).to_model_kwargs()["response_format"]
