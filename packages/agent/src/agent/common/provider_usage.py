"""The provider's ``usage`` object, read into the shape the ledger books. Pure.

Split out of ``cost_tracking`` (the tracker, the flush and the carriers stay
there): what a call reports, in whichever of its three shapes it arrives,
is a question of its own.
"""

from __future__ import annotations

import functools
import logging
import math
from typing import Any

logger = logging.getLogger(__name__)

#: The provider's accounting fields the Responses carrier keeps beside the
#: normalized usage (``cost_tracking.install_responses_cost_carrier``).
ACCOUNTING_FIELDS = ("cost", "is_byok")


def as_int(value: Any) -> int:
    try:
        return int(value)
    except TypeError, ValueError:
        return 0


def usage_from_langchain_metadata(usage_metadata: Any, accounting: Any = None) -> dict[str, Any]:
    """LangChain's normalized ``usage_metadata``, reshaped as a provider usage object.

    The token counts a Responses-API call carries. ``_construct_lc_result_from_responses_api``
    returns a ``ChatResult`` with no ``llm_output`` at all and a
    ``response_metadata`` that excludes ``usage``; what survives is this
    normalized view, in which OpenRouter's ``input_tokens_details.cached_tokens``
    has become ``input_token_details.cache_read``. Reading only the three
    scalars, as this did before, is what silently zeroed ``cachedTokens`` on
    every row written by an ``api_type: responses`` role.

    ``accounting`` is the provider's ``cost`` and ``is_byok``, which
    :func:`cost_tracking.install_responses_cost_carrier` keeps on ``response_metadata``.
    Without it the cost stays absent and is reported as ``missing``.
    """
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
            # langchain's name for the provider's cache write.
            "cache_write_tokens": input_details.get("cache_creation", 0),
        },
        "completion_tokens_details": {"reasoning_tokens": output_details.get("reasoning", 0)},
    }
    if isinstance(accounting, dict):
        usage.update({key: accounting[key] for key in ACCOUNTING_FIELDS if key in accounting})
    return usage


def reported_cost(raw: Any, generation_id: str | None) -> float | None:
    """The provider's ``cost`` in USD when it is a real one, else ``None`` (recorded as ``missing``).

    ``bool`` is an ``int`` in Python, so ``cost: true`` would book $1.00; NaN
    disables the budget gate (every comparison with it is false); and the BFF
    rejects a non-finite or negative cost, dropping the whole batch with it.
    A present value that is none of those is logged, never booked, so a
    malformed field is visible rather than indistinguishable from an absent one.
    """
    if raw is None:
        return None
    if isinstance(raw, int | float) and not isinstance(raw, bool) and math.isfinite(raw) and raw >= 0:
        return float(raw)
    logger.warning("Ignoring malformed provider cost %r on generation %s; recorded as missing", raw, generation_id)
    return None


def chunk_accounting(usage: Any) -> dict[str, Any] | None:
    """``cost`` and ``is_byok`` off a streamed chunk's ``usage``, plain dict or SDK model; None without them."""
    raw = usage if isinstance(usage, dict) else getattr(usage, "model_extra", None) or {}
    if not isinstance(raw, dict):
        return None
    accounting = {key: raw[key] for key in ACCOUNTING_FIELDS if raw.get(key) is not None}
    return accounting or None


def install_chat_stream_cost_carrier() -> bool:
    """Keep OpenRouter's ``cost`` on a streamed Chat Completions reply. ``True`` once installed.

    OpenRouter sends ``usage.cost`` on the final chunk of a stream. langchain-openai
    turns that chunk into ``usage_metadata`` (token counts only) in
    ``BaseChatOpenAI._convert_chunk_to_generation_chunk`` and drops the rest, and a
    streamed call has no ``llm_output`` to fall back on, so the ledger booked it at
    zero, ``missing``. The chat answer streams (``turn/answer_stream.streaming_call``),
    so since ``research_llm`` runs on Chat Completions that was the main call of
    every turn (found by review, 2026-11-10). The wrapper puts the two fields on the
    chunk's ``response_metadata`` under ``cost_tracking.RESPONSES_ACCOUNTING_KEY``, where the
    merged message carries them to ``cost_tracking.extract_usage_event``.
    Idempotent; ``False`` and an error log when langchain-openai renames the method.
    """
    logger = logging.getLogger(__name__)
    # Called while ``cost_tracking`` finishes importing, after it defined the key.
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
