from __future__ import annotations

from typing import Any


def with_cost(usage: dict[str, Any], responses: Any, depth: int) -> dict[str, Any]:
    from agent.common.cost_tracking import RESPONSES_ACCOUNTING_KEY
    from agent.observability.langfuse_trace_attributes import _find_usage

    carrier = _find_usage(responses, lambda node: isinstance(node.get(RESPONSES_ACCOUNTING_KEY), dict), depth)
    cost = carrier[RESPONSES_ACCOUNTING_KEY].get("cost") if carrier is not None else None
    # Without the carried cost Langfuse prices from its own table and misses the cache discount (signals T1, 2026-11-02: $53.53 in Langfuse against a $43.75 bill).
    if isinstance(cost, int | float) and not isinstance(cost, bool):
        usage["cost"] = cost
    return usage
