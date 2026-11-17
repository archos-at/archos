"""What every span this process exports carries, whoever built it (ADR-0089).

Langfuse files a trace under an *environment* and a *release* and draws each
observation by its *type*. None of the three reached it before this module:
``deployment.environment`` was a resource attribute Langfuse does not read as
the environment, the commit was on the log resource only, and the agent runtime writes its
own ``nat.span.kind`` where Langfuse reads ``langfuse.observation.type``. So
every trace was "default", no release could be compared with the one before,
and an agent graph was a column of untyped spans.

Pure functions here; the processor that applies them lives beside the others in
``langfuse_trace_attributes``, and the direct-span helper
(``observability.direct_trace``) calls the same functions, so a span the agent runtime built
and a span Grid built cannot disagree about what they carry.

Nothing here is personal data or tenant data: the deployment's name, the
commit, and a span's type. That is why it is installed unconditionally, unlike
the identity attributes.
"""

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
    """The environment Langfuse files this process's traces under, or None.

    ``raw`` defaults to ``APP_ENV``. Lower-cased and coerced to Langfuse's
    alphabet; None when nothing usable is left.
    """
    value = (os.environ.get(ENVIRONMENT_ENV, "") if raw is None else raw).strip().lower()
    value = _ENVIRONMENT_INVALID.sub("-", value).strip("-")[:_ENVIRONMENT_MAX]
    if not value or value.startswith("langfuse"):
        return None
    return value


def langfuse_release(raw: str | None = None) -> str | None:
    """The commit this process runs, as Langfuse's release, or None when unknown."""
    value = (os.environ.get(RELEASE_ENV, "") if raw is None else raw).strip()
    if not value or value == "unknown":
        return None
    return value


def process_trace_attributes() -> dict[str, Any]:
    """Environment and release for every span of this process. Absent values are omitted."""
    attributes: dict[str, Any] = {}
    environment = langfuse_environment()
    if environment:
        attributes[ENVIRONMENT_ATTRIBUTE] = environment
    release = langfuse_release()
    if release:
        attributes[RELEASE_ATTRIBUTE] = release
    return attributes


def span_kind(attributes: dict[str, Any]) -> str | None:
    """The agent runtime's span kind, read by suffix because the prefix follows the exporter."""
    value = next((value for key, value in attributes.items() if key.endswith(".span.kind")), None)
    return value if isinstance(value, str) else None


def observation_type(*, name: str | None, kind: str | None) -> str | None:
    """The Langfuse observation type for one span, or None to leave it a plain span."""
    if name and name.startswith(_RETRIEVAL_SPAN_PREFIX):
        return "retriever"
    if name and name.startswith(_DECISION_SPAN_PREFIX):
        return "generation"
    return _TYPE_BY_KIND.get(kind or "")


def trace_name_for_root(name: str | None) -> str:
    """What a root span's trace is called in Langfuse.

    A research job submitted on its own is a root ``async_job:<config>`` span;
    every other root in this process is a chat turn's workflow.
    """
    if name and name.startswith(ASYNC_JOB_PREFIX):
        return RESEARCH_JOB_TRACE
    return CHAT_TURN_TRACE
