from __future__ import annotations

import logging
import time
from contextvars import ContextVar
from contextvars import Token
from typing import Any
from typing import Literal
from uuid import UUID
from uuid import uuid4

from langchain_core.callbacks import AsyncCallbackHandler

from agent.common import turn_status
from agent.common.tool_calls import FILESYSTEM_READ_TOOLS
from agent.common.tool_calls import tool_basename
from agent.common.turn_status import clip
from agent.common.turn_status import current_retrieval_round
from agent.common.turn_status import current_subagent
from agent.common.wire_v2 import ActionCounts
from agent.common.wire_v2 import ActionStep
from agent.common.wire_v2 import ActionVerb
from agent.common.wire_v2 import ToolStep

logger = logging.getLogger(__name__)

ACTION_STEP_PREFIX = "action:"


_action_call: ContextVar[str | None] = ContextVar("action_call", default=None)


def current_action_call() -> str | None:
    return _action_call.get()


class ActionRow:
    def __init__(self, verb: ActionVerb, **fields: Any) -> None:
        self.call_id = uuid4().hex[:16]
        self._id = f"{ACTION_STEP_PREFIX}{self.call_id}"
        self._started = time.monotonic()
        self._fields: dict[str, Any] = {
            "verb": verb,
            "call_id": self.call_id,
            "round": current_retrieval_round(),
            **_clip_action(fields),
        }
        self._token: Token[str | None] | None = _action_call.set(self.call_id)
        self._done = False
        self._emit(started=True)

    def finish(
        self,
        status: Literal["ok", "empty", "error"] = "ok",
        *,
        counts: dict[str, int | None] | None = None,
        **fields: Any,
    ) -> None:
        if self._done:
            return
        self._done = True
        self._release_call()
        if "mount" in fields:
            self._fields.pop("mount", None)
            self._fields.pop("target", None)
        self._fields.update(_clip_action(fields))
        self._fields["status"] = status
        self._fields["elapsed_ms"] = max(0, round((time.monotonic() - self._started) * 1000))
        kept = {k: v for k, v in (counts or {}).items() if v is not None}
        if kept:
            self._fields["counts"] = kept
        self._emit(started=False)

    def _release_call(self) -> None:
        token, self._token = self._token, None
        if token is None:
            return
        try:
            _action_call.reset(token)
        except ValueError:
            pass

    def _emit(self, *, started: bool) -> None:
        try:
            fields = dict(self._fields)
            counts = fields.pop("counts", None)
            step = ActionStep(id=self._id, counts=ActionCounts(**counts) if counts else None, **fields)
        except ValueError:
            logger.warning("An action row did not validate (%s)", self._fields.get("verb"), exc_info=True)
            return
        turn_status.emit_step(step, started=started)


_ACTION_CLIPS = {"query": 160, "target": 300, "pages": 40, "shelf": 40}


def _clip_action(fields: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in fields.items():
        if value is None or value == "":
            continue
        limit = _ACTION_CLIPS.get(key)
        out[key] = clip(str(value), limit) if limit else value
    return out


LITERAL_SEARCH_SLOT = "literal-search"


def emit_literal_search(mode: str) -> None:
    turn_status.emit_technical(f"{LITERAL_SEARCH_SLOT}:{uuid4().hex[:12]}", match=mode)


def is_literal_search(step: Any) -> bool:
    slot = getattr(step, "slot", None)
    return (
        getattr(step, "kind", None) == "status" and isinstance(slot, str) and slot.startswith(f"{LITERAL_SEARCH_SLOT}:")
    )


class ToolStepCallback(AsyncCallbackHandler):
    def __init__(self) -> None:
        self._running: dict[UUID, tuple[str, str | None, str | None]] = {}

    async def on_tool_start(self, serialized: dict[str, Any], input_str: str, *, run_id: UUID, **kwargs: Any) -> None:
        tool = tool_basename(str(serialized.get("name") or kwargs.get("name") or "")) or "tool"
        mount = _tool_mount(tool, kwargs.get("inputs"))
        subagent = _tool_subagent(kwargs.get("tool_call_id"))
        self._running[run_id] = (tool, mount, subagent)
        turn_status.emit_step(
            ToolStep(id=f"tool:{run_id}", tool=tool, mount=mount), started=True, subagent_run_id=subagent
        )

    async def on_tool_end(self, output: Any, *, run_id: UUID, **kwargs: Any) -> None:
        self._finish(run_id, "ok")

    async def on_tool_error(self, error: BaseException, *, run_id: UUID, **kwargs: Any) -> None:
        self._finish(run_id, "error")

    def _finish(self, run_id: UUID, status: Literal["ok", "error"]) -> None:
        running = self._running.pop(run_id, None)
        if running is not None:
            tool, mount, subagent = running
            turn_status.emit_step(
                ToolStep(id=f"tool:{run_id}", tool=tool, status=status, mount=mount), subagent_run_id=subagent
            )


def _tool_subagent(tool_call_id: Any) -> str | None:
    frame = current_subagent()
    if frame is None:
        return None
    if frame.tool_call_id is not None and isinstance(tool_call_id, str) and tool_call_id[:128] == frame.tool_call_id:
        return frame.parent_run_id
    return frame.run_id


def _tool_mount(tool: str, inputs: Any) -> str | None:
    from agent.common.estate_paths import WRITE_TOOLS
    from agent.common.estate_paths import call_mount

    if tool not in FILESYSTEM_READ_TOOLS and tool not in WRITE_TOOLS:
        return None
    return call_mount(tool, inputs if isinstance(inputs, dict) else None)
