"""What a generation's usage looks like on its Langfuse span: the keys and the exclusive buckets. Pure.

Split out of ``langfuse_trace_attributes`` so the agent runtime's processor and
the direct traces (``direct_trace``) share one mapping without either growing.
"""

from __future__ import annotations

import json
from typing import Any

#: OTel GenAI semconv usage keys Langfuse maps to ``usageDetails`` (it
#: normalizes cache buckets server-side, so these stay provider-verbatim).
GEN_AI_USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens"
GEN_AI_USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens"
#: The model a generation ran on — what Langfuse matches against its model
#: price table to infer ``costDetails`` when no cost is ingested.
GEN_AI_REQUEST_MODEL = "gen_ai.request.model"
#: Flat Langfuse-style keys, stored verbatim (no server normalization), so
#: their buckets must already be exclusive — see ``usage_observation_attributes``.
OBSERVATION_USAGE_DETAILS = "langfuse.observation.usage_details"
OBSERVATION_COST_DETAILS = "langfuse.observation.cost_details"
OBSERVATION_MODEL_NAME = "langfuse.observation.model.name"


def normalize_langchain_usage(usage: dict[str, Any]) -> dict[str, Any]:
    """LangChain's ``usage_metadata`` reshaped into the provider key names.

    ``input_token_details.cache_read`` is where langchain-openai puts
    OpenRouter's ``input_tokens_details.cached_tokens`` (Responses) /
    ``prompt_tokens_details.cached_tokens`` (Chat Completions). No ``cost``
    exists on this shape, so none is claimed.
    """
    input_details = usage.get("input_token_details") or {}
    output_details = usage.get("output_token_details") or {}
    return {
        "prompt_tokens": usage.get("input_tokens"),
        "completion_tokens": usage.get("output_tokens"),
        "total_tokens": usage.get("total_tokens"),
        "prompt_tokens_details": {
            "cached_tokens": input_details.get("cache_read"),
            "cache_write_tokens": input_details.get("cache_creation"),
        },
        "completion_tokens_details": {"reasoning_tokens": output_details.get("reasoning")},
    }


def usage_observation_attributes(
    *,
    prompt_tokens: int,
    completion_tokens: int,
    total_tokens: int,
    cached_tokens: int = 0,
    reasoning_tokens: int = 0,
    cost_usd: int | float | None = None,
    model: str | None = None,
    cache_write_tokens: int = 0,
) -> dict[str, Any]:
    """The span attributes that land input/output/total (+cost) on a generation.

    ``gen_ai.usage.*`` carries the provider-verbatim counts (Langfuse
    normalizes cache buckets server-side on that path).
    ``langfuse.observation.usage_details`` is stored VERBATIM, so its buckets
    are exclusive here: ``input`` excludes cached tokens (which ride their own
    ``input_cached_tokens`` bucket) and the tokens written to the cache (their
    own ``input_cache_write_tokens`` bucket, priced at 1.25x), and ``output`` excludes reasoning tokens
    (own ``output_reasoning_tokens`` bucket) — otherwise Langfuse's
    per-bucket cost math would bill the same token twice.
    ``cost_details`` carries the provider-reported total when known; without
    it Langfuse infers cost from ``model`` + usage via its model table.
    Pure, so the mapping is testable without a span or an event loop.
    """
    exclusive_input = max(0, prompt_tokens - cached_tokens - cache_write_tokens)
    exclusive_output = max(0, completion_tokens - reasoning_tokens)
    details: dict[str, Any] = {
        "input": exclusive_input,
        "output": exclusive_output,
        "total": total_tokens,
    }
    if cached_tokens > 0:
        details["input_cached_tokens"] = cached_tokens
    if cache_write_tokens > 0:
        details["input_cache_write_tokens"] = cache_write_tokens
    if reasoning_tokens > 0:
        details["output_reasoning_tokens"] = reasoning_tokens
    attributes: dict[str, Any] = {
        GEN_AI_USAGE_INPUT_TOKENS: prompt_tokens,
        GEN_AI_USAGE_OUTPUT_TOKENS: completion_tokens,
        OBSERVATION_USAGE_DETAILS: json.dumps(details, separators=(",", ":")),
    }
    if model:
        attributes[GEN_AI_REQUEST_MODEL] = model
        attributes[OBSERVATION_MODEL_NAME] = model
    if isinstance(cost_usd, int | float):
        attributes[OBSERVATION_COST_DETAILS] = json.dumps({"total": float(cost_usd)}, separators=(",", ":"))
    return attributes
