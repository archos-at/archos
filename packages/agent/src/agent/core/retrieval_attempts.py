from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any

from langchain_core.messages import ToolMessage
from langchain_core.tools import BaseTool

from agent.citations.entries import EmptySourceRegistryError
from agent.common import citation_events
from agent.common import get_source_id_for_tool
from agent.common.tool_validation import validate_tool_availability

logger = logging.getLogger(__name__)


def _source_lookup_attempted(messages: Sequence[Any]) -> bool:
    return any(
        isinstance(msg, ToolMessage) and get_source_id_for_tool(getattr(msg, "name", "") or "") is not None
        for msg in messages
    )


RECORD_TOOLS = frozenset({"project_lookup"})


def _passage_lookup_attempted(messages: Sequence[Any]) -> bool:
    return any(
        isinstance(msg, ToolMessage)
        and (name := getattr(msg, "name", "") or "") not in RECORD_TOOLS
        and get_source_id_for_tool(name) is not None
        for msg in messages
    )


def _require_retrieval(lookup_attempted: bool, tools: Sequence[BaseTool], *, ruling: bool) -> bool:
    if not lookup_attempted:
        logger.debug("Piloti: answered without querying any data-source tool; no verification")
        return False
    _, available_count, unavailable = validate_tool_availability(
        list(tools), research_type="research", enable_logging=False
    )
    citation_events.record_empty_registry(
        agent="shallow", unavailable_tools=unavailable, available_count=available_count
    )
    if ruling:
        raise EmptySourceRegistryError("research", unavailable_tools=unavailable, available_count=available_count)
    logger.info("Piloti: a lookup found nothing; the answer ships labelled as model knowledge")
    return True
