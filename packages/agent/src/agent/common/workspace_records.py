from __future__ import annotations

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any
from typing import Literal

WORKSPACE_GROUP = "workspace"
WORKSPACE_CALL = "call"
_QUALIFIED_CALL_NAMES = (f"{WORKSPACE_GROUP}__{WORKSPACE_CALL}", f"{WORKSPACE_GROUP}.{WORKSPACE_CALL}")

LISTING_TOOL = "list_files"
LISTING_MAX_CHARS = 12_000
_LISTING_REFUSALS = re.compile(r"^(?:`\w+` must be|Invalid |Unknown )", re.IGNORECASE)

DRAWING_TOOL = "dxf_measure"
_DRAWING_ANSWER_START = "File: "

PROPOSED_PREFIX = "Proposed"
_JSON_STARTS = ("{", "[")

_AGENT_AUTHORED: dict[str, frozenset[str]] = {
    "role": frozenset({"assistant"}),
    "authoredby": frozenset({"agent", "piloti"}),
    "authorkind": frozenset({"agent", "piloti"}),
}
_AGENT_AUTHORED_TEXT_RE = re.compile(
    r'"(?:role|authoredBy|authorKind)"\s*:\s*"(?:assistant|agent|piloti)"', re.IGNORECASE
)

RecordOutcome = Literal["read", "proposed"]


@dataclass(frozen=True)
class WorkspaceRecord:
    operation: str
    outcome: RecordOutcome
    text: str

    def to_wire(self) -> dict[str, Any]:
        return {"operation": self.operation, "outcome": self.outcome}


def is_workspace_call(tool_name: str) -> bool:
    name = (tool_name or "").strip()
    return any(name == qualified or name.endswith(f"__{qualified}") for qualified in _QUALIFIED_CALL_NAMES)


def is_listing_call(tool_name: str) -> bool:
    name = (tool_name or "").strip()
    return name == LISTING_TOOL or name.endswith(f"__{LISTING_TOOL}")


ESTATE_LISTING_TOOLS = ("ls", "glob")


def is_estate_listing(tool_name: str, call: dict[str, Any] | None) -> bool:
    from agent.common.estate_paths import call_mount
    from agent.common.tool_calls import tool_basename

    base = tool_basename(tool_name or "")
    if base not in ESTATE_LISTING_TOOLS or call is None:
        return False
    return call_mount(base, call.get("args")) not in (None, "drafts", "skills")


def listing_record(text: str, tool: str = LISTING_TOOL) -> WorkspaceRecord | None:
    stripped = text.strip()
    if not stripped or _LISTING_REFUSALS.match(stripped):
        return None
    return WorkspaceRecord(tool, "read", stripped[:LISTING_MAX_CHARS])


def drawing_record(tool_name: str, text: str) -> WorkspaceRecord | None:
    from agent.common.tool_calls import tool_basename

    stripped = text.strip()
    if tool_basename(tool_name or "") != DRAWING_TOOL or not stripped.startswith(_DRAWING_ANSWER_START):
        return None
    return WorkspaceRecord(DRAWING_TOOL, "read", stripped[:LISTING_MAX_CHARS])


def _agent_authored(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    for key, item in value.items():
        marks = _AGENT_AUTHORED.get(str(key).casefold())
        if marks and isinstance(item, str) and item.strip().casefold() in marks:
            return True
    return False


def _without_agent_authorship(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _without_agent_authorship(item) for key, item in value.items() if not _agent_authored(item)}
    if isinstance(value, list):
        return [_without_agent_authorship(item) for item in value if not _agent_authored(item)]
    return value


def _read_record(operation: str, text: str) -> WorkspaceRecord | None:
    try:
        parsed = json.loads(text)
    except ValueError:
        return None if _AGENT_AUTHORED_TEXT_RE.search(text) else WorkspaceRecord(operation, "read", text)
    kept = None if _agent_authored(parsed) else _without_agent_authorship(parsed)
    if kept in (None, {}, []):
        return None
    return WorkspaceRecord(operation, "read", json.dumps(kept, ensure_ascii=False))


def _calls_by_id(messages: Sequence[Any]) -> dict[str, dict[str, Any]]:
    calls: dict[str, dict[str, Any]] = {}
    for message in messages:
        for call in getattr(message, "tool_calls", None) or []:
            if isinstance(call, dict) and call.get("id"):
                calls[str(call["id"])] = call
    return calls


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(str(part.get("text", "")) if isinstance(part, dict) else str(part) for part in content)
    return str(content or "")


def record_from_result(operation: str, arguments: dict[str, Any], text: str) -> WorkspaceRecord | None:
    stripped = text.strip()
    if stripped.startswith(PROPOSED_PREFIX):
        call_input = arguments.get("input") if isinstance(arguments.get("input"), dict) else {}
        return WorkspaceRecord(operation, "proposed", json.dumps(call_input, ensure_ascii=False))
    if not stripped.startswith(_JSON_STARTS):
        return None
    return _read_record(operation, stripped)


_PROPOSAL_ID_RE = re.compile(
    r"\bProposal ([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\b"
)


def filed_proposal_ids(messages: Sequence[Any]) -> frozenset[str]:
    ids: set[str] = set()
    for message in messages:
        if not is_workspace_call(getattr(message, "name", "") or ""):
            continue
        text = _content_text(getattr(message, "content", "")).strip()
        if text.startswith(PROPOSED_PREFIX):
            ids.update(match.lower() for match in _PROPOSAL_ID_RE.findall(text))
    return frozenset(ids)


def records_from_messages(messages: Sequence[Any]) -> list[WorkspaceRecord]:
    calls = _calls_by_id(messages)
    records: list[WorkspaceRecord] = []
    for message in messages:
        name = getattr(message, "name", "") or ""
        listed = calls.get(str(getattr(message, "tool_call_id", "") or ""))
        if is_listing_call(name) or is_estate_listing(name, listed):
            if getattr(message, "status", None) == "error":
                continue
            listing = listing_record(_content_text(getattr(message, "content", "")), name.rsplit("__", 1)[-1])
            if listing is not None:
                records.append(listing)
            continue
        if getattr(message, "status", None) != "error":
            drawing = drawing_record(name, _content_text(getattr(message, "content", "")))
            if drawing is not None:
                records.append(drawing)
                continue
        if not is_workspace_call(name):
            continue
        call = calls.get(str(getattr(message, "tool_call_id", "") or ""))
        if call is None:
            continue
        arguments = call.get("args") if isinstance(call.get("args"), dict) else {}
        operation = str(arguments.get("name") or "").strip() or "unknown"
        record = record_from_result(operation, arguments, _content_text(getattr(message, "content", "")))
        if record is not None:
            records.append(record)
    return records
