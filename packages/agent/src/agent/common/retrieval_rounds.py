from __future__ import annotations

from collections.abc import Iterable
from collections.abc import Sequence
from typing import Any

from langchain_core.messages import ToolMessage

from agent.common.message_utils import content_to_text
from agent.common.tool_calls import FETCH_FAILED_MARKER
from agent.common.tool_calls import fetch_signature


def repeat_fetches(calls: Sequence[Any], executed: Sequence[str]) -> list[Any]:
    seen = set(executed or ())
    repeats: list[Any] = []
    for call in calls:
        signature = fetch_signature(call)
        if signature is None:
            continue
        if signature in seen:
            repeats.append(call)
            continue
        seen.add(signature)
    return repeats


def signatures_of(calls: Sequence[Any]) -> frozenset[str]:
    return frozenset(signature for call in calls if (signature := fetch_signature(call)) is not None)


def failed_call_ids(messages: Iterable[Any]) -> set[str]:
    failed: set[str] = set()
    for message in messages:
        if not isinstance(message, ToolMessage):
            continue
        content = str(message.content or "")
        if getattr(message, "status", None) == "error" or content.lstrip().startswith(FETCH_FAILED_MARKER):
            failed.add(str(getattr(message, "tool_call_id", "") or ""))
    return failed


def ran_signatures(ran: Sequence[Any], failed_ids: set[str]) -> list[str]:
    return [
        signature
        for call in ran
        if str(call.get("id") or "") not in failed_ids and (signature := fetch_signature(call)) is not None
    ]


def assistant_checkpoint(response: Any) -> str | None:
    text = " ".join(content_to_text(getattr(response, "content", "") or "").split())
    if not text or text.startswith("```"):
        return None
    return text
