"""The cost a Responses-API call carries beside its usage, for the trace's usage object."""

from __future__ import annotations

from typing import Any


def with_cost(usage: dict[str, Any], responses: Any, depth: int) -> dict[str, Any]:
    """``usage`` with OpenRouter's ``cost``, when the cost carrier kept one beside the call's response.

    The Responses path has no provider usage object, but the cost carrier
    (``cost_tracking.install_responses_cost_carrier``) keeps OpenRouter's ``cost`` beside it. Without it
    Langfuse prices the span from its own table, ignores the cache discount and prices a model it
    does not know at $0 (signals T1, 2026-11-02: $53.53 in Langfuse against a $43.75 bill).
    """
    from agent.common.cost_tracking import RESPONSES_ACCOUNTING_KEY
    from agent.observability.langfuse_trace_attributes import _find_usage

    carrier = _find_usage(responses, lambda node: isinstance(node.get(RESPONSES_ACCOUNTING_KEY), dict), depth)
    cost = carrier[RESPONSES_ACCOUNTING_KEY].get("cost") if carrier is not None else None
    if isinstance(cost, int | float) and not isinstance(cost, bool):
        usage["cost"] = cost
    return usage
