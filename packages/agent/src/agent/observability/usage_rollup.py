from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class UsageRollup:

    llm_calls: int
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cost_usd: float
    cost_source: str
    error: str | None = None

    def to_payload(self) -> dict[str, Any]:
        return {
            "llmCalls": self.llm_calls,
            "promptTokens": self.prompt_tokens,
            "completionTokens": self.completion_tokens,
            "totalTokens": self.total_tokens,
            "costUsd": self.cost_usd,
            "costSource": self.cost_source,
            "error": self.error,
        }


NO_CALLS_ERROR = "no_llm_calls"


def build_usage_rollup(
    *,
    llm_calls: int,
    prompt_tokens: int,
    completion_tokens: int,
    total_tokens: int | None = None,
    cost_usd: float = 0.0,
    cost_source: str | None = None,
) -> UsageRollup:
    calls = max(0, int(llm_calls or 0))
    if calls <= 0:
        return UsageRollup(
            llm_calls=0,
            prompt_tokens=0,
            completion_tokens=0,
            total_tokens=0,
            cost_usd=0.0,
            cost_source=cost_source or "missing",
            error=NO_CALLS_ERROR,
        )
    prompt = max(0, int(prompt_tokens or 0))
    completion = max(0, int(completion_tokens or 0))
    total = max(0, int(total_tokens)) if total_tokens is not None else prompt + completion
    cost = max(0.0, float(cost_usd or 0.0))
    return UsageRollup(
        llm_calls=calls,
        prompt_tokens=prompt,
        completion_tokens=completion,
        total_tokens=total,
        cost_usd=round(cost, 6),
        cost_source=cost_source or ("usage_field" if cost > 0 else "missing"),
    )


def from_tracker(tracker: Any) -> UsageRollup | None:
    try:
        return build_usage_rollup(
            llm_calls=int(getattr(tracker, "events_recorded", 0) or 0),
            prompt_tokens=int(getattr(tracker, "prompt_tokens", 0) or 0),
            completion_tokens=int(getattr(tracker, "completion_tokens", 0) or 0),
            cost_usd=float(getattr(tracker, "turn_cost_usd", 0.0) or 0.0),
            cost_source=getattr(tracker, "cost_source", None),
        )
    except Exception:
        logger.debug("Could not build a usage rollup from the tracker", exc_info=True)
        return None


def _resolve_turn(turn_id: str | None, job_id: str | None, tracker: Any) -> tuple[str | None, str | None]:
    resolved_turn = turn_id
    resolved_job = job_id if job_id is not None else getattr(tracker, "job_id", None)
    if resolved_turn is None:
        try:
            from agent.common.profiler import agent_profiler_var

            profiler = agent_profiler_var.get()
            if profiler is not None:
                resolved_turn = getattr(profiler, "turn_id", None)
                if resolved_job is None:
                    resolved_job = getattr(profiler, "job_id", None)
        except Exception:
            logger.debug("Could not read the active agent profiler for the usage rollup", exc_info=True)
    return resolved_turn, resolved_job


def record_usage_turn(
    *,
    tracker: Any,
    agent: str = "chat",
    turn_id: str | None = None,
    job_id: str | None = None,
    identity: dict[str, str | None] | None = None,
) -> dict[str, Any] | None:
    try:
        rollup = from_tracker(tracker)
    except Exception:
        logger.warning("Could not build the turn usage rollup", exc_info=True)
        return None
    if rollup is None:
        return None
    try:
        resolved_turn, resolved_job = _resolve_turn(turn_id, job_id, tracker)
        payload: dict[str, Any] = {
            "agent": agent,
            "organizationId": (identity or {}).get("organization_id", getattr(tracker, "organization_id", None)),
            "conversationId": (identity or {}).get("conversation_id", getattr(tracker, "conversation_id", None)),
            "turnId": resolved_turn,
            "jobId": resolved_job,
            "rollup": rollup.to_payload(),
        }
    except Exception:
        logger.warning("Could not assemble the turn usage rollup", exc_info=True)
        return None
    try:
        from agent.observability.langfuse_trace_attributes import record_trace_metadata

        record_trace_metadata(
            usage_llm_calls=rollup.llm_calls,
            usage_prompt_tokens=rollup.prompt_tokens,
            usage_completion_tokens=rollup.completion_tokens,
            usage_total_tokens=rollup.total_tokens,
            usage_cost_usd=rollup.cost_usd,
            usage_cost_source=rollup.cost_source,
            usage_error=rollup.error,
        )
    except Exception:
        logger.debug("Could not stamp the turn usage rollup onto the trace", exc_info=True)
    return payload
