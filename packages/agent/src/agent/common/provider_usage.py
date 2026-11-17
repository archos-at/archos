from __future__ import annotations

import functools
import logging
import math
from typing import Any

logger = logging.getLogger(__name__)

ACCOUNTING_FIELDS = ("cost", "is_byok")


def as_int(value: Any) -> int:
    try:
        return int(value)
    except TypeError, ValueError:
        return 0


def usage_from_langchain_metadata(usage_metadata: Any, accounting: Any = None) -> dict[str, Any]:
    if not usage_metadata:
        return {}
    input_details = usage_metadata.get("input_token_details") or {}
    output_details = usage_metadata.get("output_token_details") or {}
    usage: dict[str, Any] = {
        "prompt_tokens": usage_metadata.get("input_tokens", 0),
        "completion_tokens": usage_metadata.get("output_tokens", 0),
        "total_tokens": usage_metadata.get("total_tokens", 0),
        "prompt_tokens_details": {
            "cached_tokens": input_details.get("cache_read", 0),
            "cache_write_tokens": input_details.get("cache_creation", 0),
        },
        "completion_tokens_details": {"reasoning_tokens": output_details.get("reasoning", 0)},
    }
    if isinstance(accounting, dict):
        usage.update({key: accounting[key] for key in ACCOUNTING_FIELDS if key in accounting})
    return usage


def reported_cost(raw: Any, generation_id: str | None) -> float | None:
    if raw is None:
        return None
    if isinstance(raw, int | float) and not isinstance(raw, bool) and math.isfinite(raw) and raw >= 0:
        return float(raw)
    logger.warning("Ignoring malformed provider cost %r on generation %s; recorded as missing", raw, generation_id)
    return None


def chunk_accounting(usage: Any) -> dict[str, Any] | None:
    raw = usage if isinstance(usage, dict) else getattr(usage, "model_extra", None) or {}
    if not isinstance(raw, dict):
        return None
    accounting = {key: raw[key] for key in ACCOUNTING_FIELDS if raw.get(key) is not None}
    return accounting or None


def install_chat_stream_cost_carrier() -> bool:
    logger = logging.getLogger(__name__)
    from agent.common.cost_tracking import RESPONSES_ACCOUNTING_KEY

    try:
        from langchain_openai.chat_models.base import BaseChatOpenAI
    except ImportError:
        return False
    original = getattr(BaseChatOpenAI, "_convert_chunk_to_generation_chunk", None)
    if original is None:
        logger.error("langchain-openai has no _convert_chunk_to_generation_chunk; streamed calls record no cost")
        return False
    if getattr(original, "__cost_carrier__", False):
        return True

    @functools.wraps(original)
    def convert(self: Any, chunk: Any, *args: Any, **kwargs: Any) -> Any:
        generation = original(self, chunk, *args, **kwargs)
        try:
            accounting = chunk_accounting(chunk.get("usage")) if isinstance(chunk, dict) else None
            if generation is not None and accounting:
                generation.message.response_metadata[RESPONSES_ACCOUNTING_KEY] = dict(accounting)
        except Exception:  # noqa: BLE001 - accounting must never break an answer
            logger.warning("Could not carry the streamed usage cost", exc_info=True)
        return generation

    convert.__cost_carrier__ = True  # type: ignore[attr-defined]
    BaseChatOpenAI._convert_chunk_to_generation_chunk = convert  # type: ignore[method-assign]
    return True
