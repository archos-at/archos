"""The provider's ``usage`` object, read into the shape the ledger books. Pure.

Split out of ``cost_tracking`` (the tracker, the flush and the carriers stay
there): what a call reports, in whichever of its three shapes it arrives,
is a question of its own.
"""

from __future__ import annotations

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
