import base64
import json
import logging
from collections.abc import Iterable
from typing import Any

from langchain_core.messages import BaseMessage

from .data_source_registry import get_all_sources
from .data_source_registry import get_source
from .data_source_registry import get_source_id_for_tool

DEFAULT_DATA_SOURCES: list[str] = ["web_search"]

DISABLED_SOURCES_HEADER = "x-grid-disabled-sources"

logger = logging.getLogger(__name__)

FILESYSTEM_READ_TOOLS = frozenset({"ls", "glob", "grep", "read_file"})

ESTATE_SOURCE_TOOL = "knowledge_search"

_GROUP_SEPARATORS = ("__", ".")


def _basename(tool_name: str) -> str:
    base = tool_name or ""
    for separator in _GROUP_SEPARATORS:
        if separator in base:
            base = base.rsplit(separator, 1)[-1]
    return base


def source_id_for_call(tool_name: str, args: Any = None) -> str | None:
    from agent.common.estate_paths import reaches_drafts_only

    base = _basename(tool_name)
    if base in FILESYSTEM_READ_TOOLS:
        if reaches_drafts_only(base, args):
            return None
        return get_source_id_for_tool(ESTATE_SOURCE_TOOL)
    return get_source_id_for_tool(tool_name)


def parse_disabled_sources(raw: str | None) -> set[str]:
    if not raw:
        return set()
    try:
        padded = raw + "=" * (-len(raw) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
    except Exception:
        logger.warning("Ignoring malformed %s header", DISABLED_SOURCES_HEADER, exc_info=True)
        return set()
    if not isinstance(data, list):
        return set()
    return {str(item).strip().lower() for item in data if str(item).strip()}


def get_disabled_sources_from_context() -> set[str]:
    from agent.project_context import _read_header
    from agent.project_context import get_signed_request_context

    envelope = get_signed_request_context()
    if envelope is not None:
        return {item.strip().lower() for item in envelope.disabled_sources or [] if item.strip()}
    return parse_disabled_sources(_read_header(DISABLED_SOURCES_HEADER))


def unavailable_source_ids(
    data_sources: list[str] | None,
    disabled_sources: set[str] | None = None,
) -> frozenset[str]:
    if disabled_sources is None:
        disabled_sources = get_disabled_sources_from_context()
    unavailable = {str(source_id).strip().lower() for source_id in disabled_sources if str(source_id).strip()}
    if data_sources is None:
        return frozenset(unavailable)
    selected = {source_id.strip().lower() for source_id in data_sources if source_id.strip()}
    unavailable |= {meta.id.lower() for meta in get_all_sources() if meta.id.lower() not in selected}
    return frozenset(unavailable)


def disabled_source_notice(tool_name: str, disabled: Iterable[str], args: Any = None) -> str | None:
    unavailable = frozenset(disabled)
    if not unavailable:
        return None
    source_id = source_id_for_call(tool_name, args)
    if source_id is None or source_id.lower() not in unavailable:
        return None
    meta = get_source(source_id)
    label = meta.name if meta else source_id.replace("_", " ").title()
    from agent.common.law_gate import withheld_notice

    if (gated := withheld_notice(source_id, label)) is not None:
        return gated
    return (
        f"Not executed: {label} is switched off for this conversation. "
        f"Answer with what you already have, and state in the text that {label} was not consulted."
    )


def parse_data_sources(raw: Any) -> list[str] | None:
    if raw is None:
        return None
    if isinstance(raw, list):
        if len(raw) == 0:
            return []
        parsed = [str(value).strip() for value in raw]
        return [value for value in parsed if value] or []
    if isinstance(raw, str):
        if not raw.strip():
            return []
        parsed = [value.strip() for value in raw.split(",")]
        return [value for value in parsed if value] or []
    return None


def filter_tools_by_sources(
    tools: list[Any],
    data_sources: list[str] | None,
    disabled_sources: set[str] | None = None,
) -> list[Any]:
    if disabled_sources is None:
        disabled_sources = get_disabled_sources_from_context()

    if data_sources is None and not disabled_sources:
        return tools

    selected = (
        None if data_sources is None else {source_id.strip().lower() for source_id in data_sources if source_id.strip()}
    )
    filtered = []
    for tool in tools:
        name = getattr(tool, "name", "")
        source_id = get_source_id_for_tool(name)
        if source_id is None:
            filtered.append(tool)
            continue
        source_key = source_id.lower()
        if source_key in disabled_sources:
            continue
        if selected is None or source_key in selected:
            filtered.append(tool)
    return filtered


def all_mapped_tools_filtered_out(
    tools: list[Any],
    selected_tools: list[Any],
    data_sources: list[str] | None,
) -> bool:
    if data_sources is None:
        return False
    had_mapped = any(get_source_id_for_tool(getattr(t, "name", "")) is not None for t in tools)
    if not had_mapped:
        return False
    still_has_mapped = any(get_source_id_for_tool(getattr(t, "name", "")) is not None for t in selected_tools)
    return not still_has_mapped


def extract_messages_and_sources(payload: Any) -> tuple[list[BaseMessage], list[str] | None]:
    if isinstance(payload, dict):
        if "payload" in payload and isinstance(payload["payload"], dict):
            payload = payload["payload"]
        messages = payload.get("messages")
        if isinstance(messages, list):
            return messages, parse_data_sources(payload.get("data_sources"))
    if isinstance(payload, list):
        return payload, None
    raise ValueError("Invalid payload format: expected dict with 'messages' or list")


def format_data_source_tools(data_sources: list[str]) -> list[dict[str, str]]:
    tools_info: list[dict[str, str]] = []
    for source_id in data_sources:
        meta = get_source(source_id)
        if meta:
            tools_info.append({"name": meta.name, "description": meta.description})
        else:
            label = source_id.replace("_", " ").title()
            tools_info.append({"name": label, "description": f"Search {source_id.replace('_', ' ')}."})
    return tools_info
