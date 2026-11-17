import contextvars
import logging
import os
import re
from collections.abc import Sequence
from typing import Any

from agent.observability.responses_cost import with_cost
from agent.observability.usage_details import normalize_langchain_usage as _normalize_langchain_usage
from agent.observability.usage_details import usage_observation_attributes

logger = logging.getLogger(__name__)

IDENTITY_ATTRIBUTES_ENV = "TRACE_IDENTITY_ATTRIBUTES"

SESSION_ID_ATTRIBUTE = "langfuse.session.id"
TAGS_ATTRIBUTE = "langfuse.trace.tags"
METADATA_PREFIX = "langfuse.trace.metadata."


_CONTRIBUTED: contextvars.ContextVar[dict[str, Any] | None] = contextvars.ContextVar(
    "langfuse_contributed", default=None
)


def snapshot_contributions() -> dict[str, Any] | None:
    current = _CONTRIBUTED.get()
    if current is None:
        return None
    try:
        return {
            "metadata": dict(current.get("metadata", {})),
            "tags": list(current.get("tags", [])),
        }
    except Exception:
        logger.debug("Failed to snapshot Langfuse trace contributions", exc_info=True)
        return None


def begin_trace_contributions() -> contextvars.Token:
    return _CONTRIBUTED.set({"metadata": {}, "tags": []})


def end_trace_contributions(token: contextvars.Token) -> None:
    _CONTRIBUTED.reset(token)


def record_trace_metadata(**pairs: Any) -> None:
    try:
        current = _CONTRIBUTED.get()
        metadata = dict(current.get("metadata", {})) if current else {}
        tags = list(current.get("tags", [])) if current else []
        metadata.update({key: value for key, value in pairs.items() if value is not None})
        _CONTRIBUTED.set({"metadata": metadata, "tags": tags})
    except Exception:
        logger.debug("Failed to record Langfuse trace metadata", exc_info=True)


POSTHOG_SESSION_METADATA_KEY = "$posthog_session_id"

_UUID_V7 = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")


def posthog_session_id_or_none(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    candidate = value.strip().lower()
    return candidate if _UUID_V7.fullmatch(candidate) else None


def record_posthog_session(value: Any) -> bool:
    session_id = posthog_session_id_or_none(value)
    if session_id is None or not identity_attributes_enabled():
        return False
    record_trace_metadata(**{POSTHOG_SESSION_METADATA_KEY: session_id})
    return True


LESSONS_ARM_METADATA_KEY = "lessons_arm"
LESSON_IDS_METADATA_KEY = "lesson_ids"


def record_lessons(arm: str, lesson_ids: Sequence[str]) -> None:
    record_trace_metadata(
        **{
            LESSONS_ARM_METADATA_KEY: arm,
            LESSON_IDS_METADATA_KEY: ",".join(lesson_ids) or None,
        }
    )


TURN_SURFACE_METADATA_KEY = "turn_surface"
REVIEW_CANVAS_TAG = "surface:review-canvas"


def record_turn_surface(surface: str) -> None:
    record_trace_metadata(**{TURN_SURFACE_METADATA_KEY: surface})
    if surface != "chat":
        add_trace_tag(REVIEW_CANVAS_TAG)


TURN_TRIGGER_METADATA_KEY = "turn_trigger"
TRIGGER_EVENT_METADATA_KEY = "trigger_event_id"


def record_turn_trigger(trigger: Any) -> None:
    if trigger is None:
        return
    record_trace_metadata(**{TURN_TRIGGER_METADATA_KEY: trigger.kind, TRIGGER_EVENT_METADATA_KEY: trigger.event_id})
    add_trace_tag(f"trigger:{trigger.kind}")


def add_trace_tag(tag: str) -> None:
    try:
        current = _CONTRIBUTED.get()
        metadata = dict(current.get("metadata", {})) if current else {}
        tags = list(current.get("tags", [])) if current else []
        if tag not in tags:
            tags.append(tag)
        _CONTRIBUTED.set({"metadata": metadata, "tags": tags})
    except Exception:
        logger.debug("Failed to add a Langfuse trace tag", exc_info=True)


def reset_contributions() -> None:
    _CONTRIBUTED.set(None)


OBSERVATION_PROMPT_NAME = "langfuse.observation.prompt.name"
OBSERVATION_PROMPT_VERSION = "langfuse.observation.prompt.version"

_PROMPT_LINK: dict[str, Any] = {}

_TURN_PROMPT_LINK: contextvars.ContextVar[dict[str, Any] | None] = contextvars.ContextVar(
    "turn_prompt_link", default=None
)


def begin_turn_prompt_link() -> contextvars.Token[dict[str, Any] | None]:
    return _TURN_PROMPT_LINK.set({})


def end_turn_prompt_link(token: contextvars.Token[dict[str, Any] | None]) -> None:
    _TURN_PROMPT_LINK.reset(token)


def _link_targets() -> list[dict[str, Any]]:
    box = _TURN_PROMPT_LINK.get()
    return [_PROMPT_LINK] if box is None else [_PROMPT_LINK, box]


def record_prompt_link(*, name: str, version: str, is_fallback: bool = False) -> None:
    try:
        if not name or not version:
            return
        for target in _link_targets():
            target["name"] = str(name)
            target["version"] = version
            target["is_fallback"] = bool(is_fallback)
    except Exception:
        logger.debug("Failed to record the Langfuse prompt link", exc_info=True)


def _current_link() -> dict[str, Any]:
    link = _TURN_PROMPT_LINK.get()
    return _PROMPT_LINK if link is None else link


def prompt_observation_attributes(*, name: str | None, version: str | None) -> dict[str, Any]:
    if not name or not version or not isinstance(version, int | str):
        return {}
    try:
        numeric = int(version)
    except ValueError:
        return {}
    return {OBSERVATION_PROMPT_NAME: str(name), OBSERVATION_PROMPT_VERSION: numeric}


def current_prompt_attributes() -> dict[str, Any]:
    link = _current_link()
    if link.get("is_fallback"):
        return {}
    return prompt_observation_attributes(name=link.get("name"), version=link.get("version"))


def current_fallback_identity() -> tuple[str, Any] | None:
    link = _current_link()
    if not link.get("is_fallback"):
        return None
    return str(link.get("name")), link.get("version")


def reset_prompt_link() -> None:
    for target in _link_targets():
        target.clear()


def identity_attributes_enabled() -> bool:
    return os.environ.get(IDENTITY_ATTRIBUTES_ENV, "").strip().lower() == "true"


def _as_count(value: Any) -> int:
    try:
        return max(0, int(value))
    except TypeError, ValueError:
        return 0


def _is_provider_usage(node: dict[str, Any]) -> bool:
    return isinstance(node.get("prompt_tokens"), int | float) and isinstance(node.get("completion_tokens"), int | float)


def _is_langchain_usage(node: dict[str, Any]) -> bool:
    return isinstance(node.get("input_tokens"), int | float) and isinstance(node.get("output_tokens"), int | float)


def _find_usage(node: Any, matches: Any, depth: int = 0) -> dict[str, Any] | None:
    if depth > 6 or node is None:
        return None
    children: Any = None
    if isinstance(node, dict):
        if matches(node):
            return node
        children = node.values()
    elif isinstance(node, list):
        children = node
    if children is None:
        return None
    for value in children:
        found = _find_usage(value, matches, depth + 1)
        if found is not None:
            return found
    return None


RESPONSE_METADATA_KEY = "chat_responses"


def _find_provider_usage(node: Any, depth: int = 0) -> dict[str, Any] | None:
    if not isinstance(node, dict):
        return None
    responses = node.get(RESPONSE_METADATA_KEY)
    if responses is None:
        return None
    provider = _find_usage(responses, _is_provider_usage, depth)
    if provider is not None:
        return provider
    normalized = _find_usage(responses, _is_langchain_usage, depth)
    return with_cost(_normalize_langchain_usage(normalized), responses, depth) if normalized is not None else None


def extract_provider_usage(metadata_json: Any) -> dict[str, int | float] | None:
    if not isinstance(metadata_json, str) or not metadata_json:
        return None
    try:
        import json

        payload = json.loads(metadata_json)
    except Exception:
        return None
    try:
        usage = _find_provider_usage(payload)
        if usage is None:
            return None
        prompt_details = usage.get("prompt_tokens_details") or {}
        completion_details = usage.get("completion_tokens_details") or {}
        raw_cost = usage.get("cost")
        return {
            "prompt_tokens": _as_count(usage.get("prompt_tokens")),
            "completion_tokens": _as_count(usage.get("completion_tokens")),
            "total_tokens": _as_count(usage.get("total_tokens")),
            "cached_tokens": _as_count(prompt_details.get("cached_tokens")),
            "cache_write_tokens": _as_count(prompt_details.get("cache_write_tokens")),
            "reasoning_tokens": _as_count(completion_details.get("reasoning_tokens")),
            "cost_usd": float(raw_cost) if isinstance(raw_cost, int | float) else None,  # type: ignore[dict-item]
        }
    except Exception:
        logger.debug("Failed to extract provider usage from span metadata", exc_info=True)
        return None


def extract_span_token_counts(attributes: dict[str, Any]) -> dict[str, int] | None:
    prompt = _as_count(attributes.get("llm.token_count.prompt"))
    completion = _as_count(attributes.get("llm.token_count.completion"))
    total = _as_count(attributes.get("llm.token_count.total"))
    if prompt <= 0 and completion <= 0 and total <= 0:
        return None
    return {"prompt_tokens": prompt, "completion_tokens": completion, "total_tokens": total}


def is_generation_span(attributes: dict[str, Any]) -> bool:
    event_type = next((value for key, value in attributes.items() if key.endswith(".event_type")), None)
    return isinstance(event_type, str) and event_type.startswith("LLM")


def langfuse_attributes_for(
    *,
    organization_id: str | None,
    project_id: str | None,
    conversation_id: str | None,
    contributed: dict[str, Any] | None = None,
) -> dict[str, Any]:
    attributes: dict[str, Any] = {}

    if conversation_id:
        attributes[SESSION_ID_ATTRIBUTE] = conversation_id
    if organization_id:
        attributes[f"{METADATA_PREFIX}organization_id"] = organization_id
    if project_id:
        attributes[f"{METADATA_PREFIX}project_id"] = project_id

    tags = [f"org:{organization_id}"] if organization_id else []

    for key, value in (contributed or {}).get("metadata", {}).items():
        attributes[f"{METADATA_PREFIX}{key}"] = value
    tags.extend(tag for tag in (contributed or {}).get("tags", []) if tag not in tags)

    if tags:
        attributes[TAGS_ATTRIBUTE] = tags

    return attributes


def current_langfuse_attributes() -> dict[str, Any]:
    try:
        from agent.project_context import RequestContext
        from agent.project_context import get_conversation_id_from_context

        context = RequestContext.from_context()
        return langfuse_attributes_for(
            organization_id=context.organization_id,
            project_id=context.project_id,
            conversation_id=get_conversation_id_from_context(),
            contributed=snapshot_contributions(),
        )
    except Exception:
        logger.debug("Failed to derive Langfuse trace attributes from context", exc_info=True)
        return {}


def current_contribution_attributes() -> dict[str, Any]:
    try:
        return langfuse_attributes_for(
            organization_id=None,
            project_id=None,
            conversation_id=None,
            contributed=snapshot_contributions(),
        )
    except Exception:
        logger.debug("Failed to derive Langfuse contribution attributes", exc_info=True)
        return {}


def merge_span_attributes(attributes: dict[str, Any], additions: dict[str, Any]) -> None:
    for key, value in additions.items():
        existing = attributes.get(key)
        if key == TAGS_ATTRIBUTE and isinstance(existing, list | tuple) and isinstance(value, list | tuple):
            attributes[key] = list(dict.fromkeys([*existing, *value]))
        else:
            attributes[key] = value


def context_attributes_for(
    *, name: str | None, attributes: dict[str, Any], is_root: bool, outcome: dict[str, Any] | None
) -> dict[str, Any]:
    from agent.observability.trace_context import OBSERVATION_TYPE_ATTRIBUTE
    from agent.observability.trace_context import TRACE_NAME_ATTRIBUTE
    from agent.observability.trace_context import observation_type
    from agent.observability.trace_context import process_trace_attributes
    from agent.observability.trace_context import span_kind
    from agent.observability.trace_context import trace_name_for_root

    additions = process_trace_attributes()
    kind = observation_type(name=name, kind=span_kind(attributes))
    if kind:
        additions[OBSERVATION_TYPE_ATTRIBUTE] = kind
    if is_root:
        additions[TRACE_NAME_ATTRIBUTE] = trace_name_for_root(name)
        merge_span_attributes(additions, outcome or {})
    return additions


try:
    from nat.data_models.span import Span
    from nat.data_models.span import SpanStatus
    from nat.data_models.span import SpanStatusCode
    from nat.observability.processor.processor import Processor

    class LangfuseTraceAttributeProcessor(Processor[Span, Span]):
        def __init__(self, *, identity: bool = True) -> None:
            super().__init__()
            self._identity = identity

        async def process(self, item: Span) -> Span:
            additions = current_langfuse_attributes() if self._identity else current_contribution_attributes()
            try:
                merge_span_attributes(item.attributes, additions)
            except Exception:
                logger.debug("Failed to stamp Langfuse trace attributes onto a span", exc_info=True)
            return item

    class TraceContextProcessor(Processor[Span, Span]):
        async def process(self, item: Span) -> Span:
            try:
                from agent.observability.trace_context import OBSERVATION_LEVEL_ATTRIBUTE
                from agent.observability.turn_outcome import current_turn_outcome

                is_root = item.parent is None
                additions = context_attributes_for(
                    name=item.name,
                    attributes=item.attributes or {},
                    is_root=is_root,
                    outcome=current_turn_outcome() if is_root else None,
                )
                merge_span_attributes(item.attributes, additions)
                if additions.get(OBSERVATION_LEVEL_ATTRIBUTE) == "ERROR":
                    message = additions.get("langfuse.observation.status_message")
                    item.status = SpanStatus(code=SpanStatusCode.ERROR, message=message)
            except Exception:
                logger.debug("Failed to stamp the trace context onto a span", exc_info=True)
            return item

    class UserIdentityStripProcessor(Processor[Span, Span]):
        async def process(self, item: Span) -> Span:
            for key in [key for key in item.attributes if key == "user.id" or key.endswith(".user.id")]:
                del item.attributes[key]
            return item

    class UsageAttributeProcessor(Processor[Span, Span]):
        async def process(self, item: Span) -> Span:
            try:
                attributes = item.attributes or {}
                from agent.observability.decision_trace import decision_usage
                from agent.observability.decision_trace import is_decision_span

                if is_decision_span(item.name):
                    decided = decision_usage(attributes)
                    if decided is not None:
                        for key, value in usage_observation_attributes(
                            prompt_tokens=decided["prompt_tokens"],
                            completion_tokens=decided["completion_tokens"],
                            total_tokens=decided["total_tokens"],
                            cost_usd=decided["cost_usd"],
                            model=decided["model"],
                        ).items():
                            item.set_attribute(key, value)
                    return item
                if not is_generation_span(attributes):
                    return item
                counts: dict[str, Any] | None = None
                for key, value in attributes.items():
                    if not key.endswith(".metadata") or not isinstance(value, str):
                        continue
                    counts = extract_provider_usage(value)
                    if counts is not None:
                        break
                if counts is None:
                    counts = extract_span_token_counts(attributes)
                if counts is None:
                    return item
                model = item.name or None
                for key, value in usage_observation_attributes(
                    prompt_tokens=int(counts.get("prompt_tokens") or 0),
                    completion_tokens=int(counts.get("completion_tokens") or 0),
                    total_tokens=int(counts.get("total_tokens") or 0),
                    cached_tokens=int(counts.get("cached_tokens") or 0),
                    cache_write_tokens=int(counts.get("cache_write_tokens") or 0),
                    reasoning_tokens=int(counts.get("reasoning_tokens") or 0),
                    cost_usd=counts.get("cost_usd"),
                    model=model,
                ).items():
                    item.set_attribute(key, value)
            except Exception:
                logger.debug("Failed to stamp usage attributes onto a span", exc_info=True)
            return item

    class PromptLinkProcessor(Processor[Span, Span]):
        async def process(self, item: Span) -> Span:
            try:
                if not is_generation_span(item.attributes or {}):
                    return item
                for key, value in current_prompt_attributes().items():
                    item.set_attribute(key, value)
            except Exception:
                logger.debug("Failed to stamp the prompt link onto a span", exc_info=True)
            return item

    class InlineImageRedactionProcessor(Processor[Span, Span]):
        async def process(self, item: Span) -> Span:
            try:
                from agent.common.image_redaction import redact_inline_images

                for key, value in list((item.attributes or {}).items()):
                    if isinstance(value, str) and "data:image" in value:
                        item.attributes[key] = redact_inline_images(value)
                    elif isinstance(value, list | tuple) and any(
                        isinstance(entry, str) and "data:image" in entry for entry in value
                    ):
                        item.attributes[key] = type(value)(redact_inline_images(list(value)))
            except Exception:
                logger.debug("Failed to redact inline images from a span", exc_info=True)
            return item

except Exception:  # pragma: no cover - exercised only without the agent-runtime extras
    LangfuseTraceAttributeProcessor = None  # type: ignore[assignment,misc]
    TraceContextProcessor = None  # type: ignore[assignment,misc]
    UsageAttributeProcessor = None  # type: ignore[assignment,misc]
    PromptLinkProcessor = None  # type: ignore[assignment,misc]
    UserIdentityStripProcessor = None  # type: ignore[assignment,misc]
    InlineImageRedactionProcessor = None  # type: ignore[assignment,misc]
