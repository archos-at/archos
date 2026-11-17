from __future__ import annotations

import json
from collections.abc import Mapping
from collections.abc import Sequence
from typing import Any

DECISION_SPAN_PREFIX = "decide."


def decision_observation(
    *,
    questions: Sequence[str],
    states: int,
    answers: Sequence[Mapping[str, Any]] = (),
    model: str | None = None,
    latency_ms: int | None = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cost_usd: float | None = None,
    decided: int | None = None,
    skipped: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    body_in: dict[str, Any] = {"questions": list(questions), "states": states}
    body_out: dict[str, Any] = {"decided": states if decided is None else decided}
    if skipped:
        body_out["skipped"] = skipped
    if answers:
        body_out["answers"] = [dict(answer) for answer in answers]
    if model:
        body_out["model"] = model
    if latency_ms is not None:
        body_out["latency_ms"] = latency_ms
    if input_tokens or output_tokens or cost_usd is not None:
        usage: dict[str, Any] = {
            "prompt_tokens": input_tokens,
            "completion_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
        }
        if cost_usd is not None:
            usage["cost"] = cost_usd
        body_out["usage"] = usage
    return body_in, body_out


def emit_decision_span(slot: str, body_in: dict[str, Any], body_out: dict[str, Any]) -> None:
    from agent.observability.retrieval_trace import emit_step_span
    from agent.observability.turn_phases import now

    latency_ms = body_out.get("latency_ms")
    ended = now()
    started = ended - latency_ms / 1000 if isinstance(latency_ms, int | float) and latency_ms >= 0 else None
    emit_step_span(
        f"{DECISION_SPAN_PREFIX}{slot}",
        body_in,
        body_out,
        started_at=started,
        ended_at=ended if started is not None else None,
    )


def is_decision_span(name: str | None) -> bool:
    return bool(name) and str(name).startswith(DECISION_SPAN_PREFIX)


def decision_usage(attributes: Mapping[str, Any]) -> dict[str, Any] | None:
    raw = next((value for key, value in attributes.items() if key.endswith("output.value")), None)
    if not isinstance(raw, str):
        return None
    try:
        body = json.loads(raw)
    except ValueError:
        return None
    usage = body.get("usage") if isinstance(body, Mapping) else None
    if not isinstance(usage, Mapping):
        return None
    cost = usage.get("cost")
    return {
        "prompt_tokens": int(usage.get("prompt_tokens") or 0),
        "completion_tokens": int(usage.get("completion_tokens") or 0),
        "total_tokens": int(usage.get("total_tokens") or 0),
        "cost_usd": cost if isinstance(cost, int | float) and not isinstance(cost, bool) else None,
        "model": body.get("model") if isinstance(body.get("model"), str) else None,
    }
