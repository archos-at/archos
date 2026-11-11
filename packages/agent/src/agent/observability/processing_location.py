"""Where each chat generation was processed, on its Langfuse generation (ADR-0167).

The chat-request contract (``common/llm_factory``) asks ``common/residency`` where each call goes and stamps the
answer on the reply's ``response_metadata["processing_route"]``. The agent runtime's span exporter keeps that
object in the generation span's ``nat.metadata`` JSON (``chat_responses[].message.response_metadata``), the same
carrier the usage processor reads OpenRouter's cost from. This processor lifts it onto the generation as
``processing_location``, ``subprocessor`` and ``processing_location_compliant`` observation metadata.

A direct generation (``direct_trace.observed_generation``) is stamped by the seam itself, through the route sink;
this processor covers the generations the agent runtime builds.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from agent.observability.langfuse_trace_attributes import RESPONSE_METADATA_KEY
from agent.observability.langfuse_trace_attributes import is_generation_span

logger = logging.getLogger(__name__)

ROUTE_KEY = "processing_route"
OBSERVATION_METADATA_PREFIX = "langfuse.observation.metadata."
_FIELDS = ("processing_location", "subprocessor", "processing_location_compliant")


def _find_route(node: Any, depth: int = 0) -> dict[str, Any] | None:
    if depth > 8:
        return None
    if isinstance(node, dict):
        route = node.get(ROUTE_KEY)
        if isinstance(route, dict) and all(field in route for field in _FIELDS):
            return route
        children = node.values()
    elif isinstance(node, list):
        children = node
    else:
        return None
    for child in children:
        found = _find_route(child, depth + 1)
        if found is not None:
            return found
    return None


def route_attributes(attributes: dict[str, Any]) -> dict[str, Any]:
    """The observation metadata a generation span's own response side says about its route. Pure.

    Only ``chat_responses`` is read: the input side replays earlier replies, whose route is theirs.
    """
    if not is_generation_span(attributes):
        return {}
    for key, value in attributes.items():
        route = _route_in(value) if key.endswith(".metadata") else None
        if route is not None:
            return {f"{OBSERVATION_METADATA_PREFIX}{field}": route[field] for field in _FIELDS}
    return {}


def _route_in(metadata_json: Any) -> dict[str, Any] | None:
    """The route on the response side of one serialized ``nat.metadata`` value, or None."""
    if not isinstance(metadata_json, str) or ROUTE_KEY not in metadata_json:
        return None
    try:
        payload = json.loads(metadata_json)
    except ValueError:
        return None
    return _find_route(payload.get(RESPONSE_METADATA_KEY)) if isinstance(payload, dict) else None


def _stamp(span: Any) -> None:
    for key, value in route_attributes(span.attributes or {}).items():
        span.set_attribute(key, value)


try:
    from nat.data_models.span import Span
    from nat.observability.processor.processor import Processor

    class ProcessingLocationProcessor(Processor[Span, Span]):
        """Stamp each chat generation's processing location onto its span. Never raises."""

        async def process(self, item: Span) -> Span:
            try:
                _stamp(item)
            except Exception:
                logger.debug("Failed to stamp a generation's processing location", exc_info=True)
            return item

except Exception:  # pragma: no cover - exercised only without the agent-runtime extras
    ProcessingLocationProcessor = None  # type: ignore[assignment,misc]
