from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

from agent.common import bff_http
from agent.common.bff_http import SignedEnvelope
from agent.tools.workspace.legacy_names import LEGACY_MODE_HEADER

logger = logging.getLogger(__name__)

MCP_PATH = "/api/mcp"

PROTOCOL_VERSION = "2025-11-25"

SEARCH_MODE = "search"

ANSWER_MESSAGE_HEADER = "X-Answer-Message-Id"

REQUEST_TIMEOUT_SECONDS = 30

ERROR_PREFIX = "Error: "


@dataclass(frozen=True)
class ToolResult:
    text: str
    structured: dict[str, Any] | None = None
    is_error: bool = False


class WorkspaceError(bff_http.BffError):
    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message, status=status)


def request_headers(envelope: SignedEnvelope, answer_message_id: str | None = None) -> dict[str, str]:
    headers = {
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
        LEGACY_MODE_HEADER: SEARCH_MODE,
        **envelope.headers(),
    }
    if answer_message_id:
        headers[ANSWER_MESSAGE_HEADER] = answer_message_id
    return headers


def _jsonrpc_from(raw: str, content_type: str) -> dict[str, Any]:
    if "text/event-stream" in content_type:
        events = [line[5:].strip() for line in raw.splitlines() if line.startswith("data:")]
        raw = next((event for event in reversed(events) if event), "")
    message = json.loads(raw)
    if not isinstance(message, dict):
        raise ValueError("not an object")
    return message


def _http_refusal(exc: bff_http.BffRefusedError) -> WorkspaceError:
    error = exc.body.get("error")
    detail = error.get("message") if isinstance(error, dict) else error
    base = f"the workspace server refused the call ({exc.status})"
    text = f"{base}: {detail}" if isinstance(detail, str) and detail.strip() else base
    return WorkspaceError(text, status=exc.status)


def _structured_content(message: dict[str, Any]) -> dict[str, Any] | None:
    result = message.get("result")
    if not isinstance(result, dict) or result.get("isError"):
        return None
    structured = result.get("structuredContent")
    return structured if isinstance(structured, dict) else None


def _is_error(message: dict[str, Any]) -> bool:
    result = message.get("result")
    return isinstance(result, dict) and bool(result.get("isError"))


def _result_text(message: dict[str, Any]) -> str:
    error = message.get("error")
    if isinstance(error, dict):
        raise WorkspaceError(str(error.get("message") or "the workspace server answered with an error"))
    result = message.get("result")
    if not isinstance(result, dict):
        raise WorkspaceError("the workspace server answered with something that is not a result")
    parts = [str(item.get("text", "")) for item in result.get("content") or [] if isinstance(item, dict)]
    text = "\n".join(part for part in parts if part).strip()
    if not text and result.get("structuredContent") is not None:
        text = json.dumps(result["structuredContent"], ensure_ascii=False, separators=(",", ":"))
    return f"{ERROR_PREFIX}{text}" if result.get("isError") else text


def call_tool(
    name: str, arguments: dict[str, Any], envelope: SignedEnvelope, *, answer_message_id: str | None = None
) -> str:
    return call_tool_result(name, arguments, envelope, answer_message_id=answer_message_id).text


def call_tool_result(
    name: str, arguments: dict[str, Any], envelope: SignedEnvelope, *, answer_message_id: str | None = None
) -> ToolResult:
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments}}
    try:
        response = bff_http.send(
            "POST",
            MCP_PATH,
            timeout=REQUEST_TIMEOUT_SECONDS,
            body=body,
            query={"mode": SEARCH_MODE},
            headers=request_headers(envelope, answer_message_id),
        )
        message = _jsonrpc_from(response.body.decode("utf-8"), response.content_type)
        return ToolResult(
            text=_result_text(message), structured=_structured_content(message), is_error=_is_error(message)
        )
    except bff_http.BffNotConfiguredError as exc:
        raise WorkspaceError(str(exc)) from exc
    except bff_http.BffRefusedError as exc:
        logger.warning("Workspace MCP refused the call (status=%s)", exc.status)
        raise _http_refusal(exc) from exc
    except WorkspaceError:
        raise
    except Exception as exc:  # noqa: BLE001 - transport or parse; the tool words it for the model
        logger.warning("Workspace MCP could not be reached or read", exc_info=True)
        raise WorkspaceError("the workspace server could not be reached") from exc
