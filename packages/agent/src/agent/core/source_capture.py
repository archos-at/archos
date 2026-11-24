from __future__ import annotations

import logging
from collections.abc import Iterable
from collections.abc import Sequence
from typing import Any

from langchain_core.messages import ToolMessage

from agent.citations.entries import is_look_place
from agent.citations.entries import is_look_tool
from agent.citations.extraction import extract_sources_from_tool_result
from agent.citations.registry import SourceRegistry
from agent.citations.session import get_session_registry
from agent.citations.session import record_turn_capture
from agent.citations.session import set_session_registry
from agent.common.data_sources import source_id_for_call
from agent.common.grounding_block import strip_trace_lanes
from agent.common.turn_notices import emit_family_coverage

logger = logging.getLogger(__name__)


def _opened_documents(sources: Iterable[Any]) -> set[str]:
    names: set[str] = set()
    for source in sources or ():
        key = str(getattr(source, "citation_key", "") or "")
        name = key.split(",", 1)[0].strip()
        if "(" in name:
            name = name.split("(", 1)[0].strip()
        if name:
            names.add(name)
    return names


def _emit_family_coverage(families: Sequence[Any], opened: set[str]) -> None:
    for family in families:
        hit = [member for member in family.members if member in opened]
        if hit:
            emit_family_coverage(family=family.key, listed=len(family.members), opened=len(hit))


def _report_family_coverage(turn_sources: Sequence[Any]) -> None:
    try:
        from agent.common.norm_registry import oib_family_member
        from agent.knowledge.inventory import get_norm_families

        families = get_norm_families()
        if not families:
            return
        opened = {member for name in _opened_documents(turn_sources) if (member := oib_family_member(name))}
        _emit_family_coverage(families, opened)
    except Exception:  # noqa: BLE001 — a coverage count must never take a turn down
        logger.debug("Family-coverage record not emitted", exc_info=True)


def _without_trace_lanes(message: Any) -> Any:
    if not isinstance(message, ToolMessage) or not isinstance(message.content, str):
        return message
    stripped = strip_trace_lanes(message.content)
    if stripped == message.content:
        return message
    return message.model_copy(update={"content": stripped})


def _capture_sources(
    tool_name: str,
    content: str,
    source_tool_names: frozenset[str],
    registry: SourceRegistry,
    artifact: Any = None,
) -> None:
    if tool_name not in source_tool_names:
        return
    source_id = source_id_for_call(tool_name)
    if source_id is None and not is_look_tool(tool_name):
        logger.debug("[CitationRegistry] Skipping non-data-source tool result from %s", tool_name)
        return
    sources = extract_sources_from_tool_result(tool_name, content, source_id=source_id, artifact=artifact)
    for source in sources:
        registry.add(source)
    record_turn_capture([source for source in sources if not is_look_place(source)])
    if sources:
        logger.info(
            "[CitationRegistry] Captured %d source(s) from %s: %s",
            len(sources),
            tool_name,
            [s.url or s.citation_key for s in sources],
        )


def _bind_registry() -> tuple[SourceRegistry, Any]:
    registry = get_session_registry()
    if registry is not None:
        return registry.for_turn(), None
    registry = SourceRegistry()
    return registry, set_session_registry(registry)
