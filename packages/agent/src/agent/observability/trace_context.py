from __future__ import annotations

import os
import re
from typing import Any

ENVIRONMENT_ATTRIBUTE = "langfuse.environment"
RELEASE_ATTRIBUTE = "langfuse.release"
# Langfuse's trace-level OTel names: https://langfuse.com/integrations/native/opentelemetry
TRACE_NAME_ATTRIBUTE = "langfuse.trace.name"
OBSERVATION_TYPE_ATTRIBUTE = "langfuse.observation.type"
OBSERVATION_LEVEL_ATTRIBUTE = "langfuse.observation.level"
OBSERVATION_STATUS_MESSAGE_ATTRIBUTE = "langfuse.observation.status_message"

ENVIRONMENT_ENV = "APP_ENV"
RELEASE_ENV = "GIT_SHA"

_ENVIRONMENT_INVALID = re.compile(r"[^a-z0-9_-]+")
_ENVIRONMENT_MAX = 40

CHAT_TURN_TRACE = "chat-turn"
RESEARCH_JOB_TRACE = "research-job"
ASYNC_JOB_PREFIX = "async_job:"

_TYPE_BY_KIND = {
    "LLM": "generation",
    "TOOL": "tool",
    "WORKFLOW": "agent",
    "AGENT": "agent",
    "FUNCTION": "chain",
    "RETRIEVER": "retriever",
    "RERANKER": "retriever",
    "EMBEDDER": "embedding",
    "GUARDRAIL": "guardrail",
    "EVALUATOR": "evaluator",
}

_RETRIEVAL_SPAN_PREFIX = "retrieve."
_DECISION_SPAN_PREFIX = "decide."


def langfuse_environment(raw: str | None = None) -> str | None:
    value = (os.environ.get(ENVIRONMENT_ENV, "") if raw is None else raw).strip().lower()
    value = _ENVIRONMENT_INVALID.sub("-", value).strip("-")[:_ENVIRONMENT_MAX]
    if not value or value.startswith("langfuse"):
        return None
    return value


def langfuse_release(raw: str | None = None) -> str | None:
    value = (os.environ.get(RELEASE_ENV, "") if raw is None else raw).strip()
    if not value or value == "unknown":
        return None
    return value


def process_trace_attributes() -> dict[str, Any]:
    attributes: dict[str, Any] = {}
    environment = langfuse_environment()
    if environment:
        attributes[ENVIRONMENT_ATTRIBUTE] = environment
    release = langfuse_release()
    if release:
        attributes[RELEASE_ATTRIBUTE] = release
    return attributes


def span_kind(attributes: dict[str, Any]) -> str | None:
    value = next((value for key, value in attributes.items() if key.endswith(".span.kind")), None)
    return value if isinstance(value, str) else None


def observation_type(*, name: str | None, kind: str | None) -> str | None:
    if name and name.startswith(_RETRIEVAL_SPAN_PREFIX):
        return "retriever"
    if name and name.startswith(_DECISION_SPAN_PREFIX):
        return "generation"
    return _TYPE_BY_KIND.get(kind or "")


def trace_name_for_root(name: str | None) -> str:
    if name and name.startswith(ASYNC_JOB_PREFIX):
        return RESEARCH_JOB_TRACE
    return CHAT_TURN_TRACE
