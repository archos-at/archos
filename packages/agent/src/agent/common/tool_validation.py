import logging
import os
import re
from typing import Any

from agent.common.canned_replies import NO_SOURCES_MESSAGE
from agent.common.canned_replies import SCOPED_NO_SOURCES_MESSAGE
from agent.common.canned_replies import TOOLS_UNAVAILABLE_MESSAGE

logger = logging.getLogger(__name__)

_STUB_MARKER = re.compile(r"\(unavailable\b", re.IGNORECASE)


def _extract_unavailable_reason(description: str) -> str:
    match = re.search(r"\(unavailable\s*[-:]\s*(.+?)\)", description, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    match = re.search(r"(missing\s+\S+)", description, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return "missing or invalid API key"


def validate_tool_availability(
    tools: list[Any],
    research_type: str = "research",
    enable_logging: bool = True,
) -> tuple[bool, int, list[str]]:
    available_tools_count = 0
    unavailable_tools = []

    if enable_logging:
        logger.info("Checking %d tools for %s", len(tools), research_type)

    for tool in tools:
        tool_name = getattr(tool, "name", "").lower()
        tool_desc_original = getattr(tool, "description", "") or ""

        is_unavailable = bool(_STUB_MARKER.search(tool_desc_original))

        if is_unavailable:
            reason = _extract_unavailable_reason(tool_desc_original)
            if enable_logging:
                logger.info("Tool %s is unavailable: %s", tool_name, reason)
            unavailable_tools.append(f"{tool_name} ({reason})")
        else:
            available_tools_count += 1
            if enable_logging:
                logger.info("Found available tool: %s", tool_name)

    if enable_logging:
        logger.info(
            "Tool availability check: %d available tools out of %d",
            available_tools_count,
            len(tools),
        )

    return available_tools_count > 0, available_tools_count, unavailable_tools


def format_tool_unavailability_error(
    research_type: str,
    unavailable_tools: list[str],
) -> str:
    unavailable_info = ""
    if unavailable_tools:
        unavailable_info = f"\nUnavailable tools: {', '.join(unavailable_tools)}.\n"

    error_msg = (
        f"Cannot start {research_type}: No tools are available."
        f" At least one tool must be configured and available.{unavailable_info}\n"
    )
    return error_msg


def format_user_facing_tool_error(
    research_type: str,
    unavailable_tools: list[str],
    available_count: int = 0,
) -> str:
    if available_count == 0:
        detailed = format_tool_unavailability_error(research_type, unavailable_tools)
    else:
        tool_list = ", ".join(unavailable_tools)
        detailed = f"Research did not return any results. Unavailable tools: {tool_list}.\n"

    logger.warning(detailed.strip())

    dev_env = os.environ.get("DEV_ENV", "")
    if dev_env == "cli":
        return detailed

    return TOOLS_UNAVAILABLE_MESSAGE


def format_no_sources_message(
    research_type: str,
    unavailable_tools: list[str],
    available_count: int = 0,
    *,
    scoped: bool = False,
) -> str:
    if unavailable_tools:
        return format_user_facing_tool_error(research_type, unavailable_tools, available_count)
    return SCOPED_NO_SOURCES_MESSAGE if scoped else NO_SOURCES_MESSAGE
