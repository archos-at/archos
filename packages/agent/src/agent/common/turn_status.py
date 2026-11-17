from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from collections.abc import Iterator
from contextlib import asynccontextmanager
from contextlib import contextmanager
from contextvars import ContextVar
from contextvars import Token
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from langgraph.config import get_stream_writer
from langgraph.errors import GraphBubbleUp

from agent.common.wire_v2 import Channel
from agent.common.wire_v2 import EventBody
from agent.common.wire_v2 import Scalar
from agent.common.wire_v2 import Scope
from agent.common.wire_v2 import StatusStep
from agent.common.wire_v2 import Step
from agent.common.wire_v2 import StepFinishedBody
from agent.common.wire_v2 import StepStartedBody
from agent.common.wire_v2 import SubagentErrorBody
from agent.common.wire_v2 import SubagentFinishedBody
from agent.common.wire_v2 import SubagentStartedBody

logger = logging.getLogger(__name__)


def emit(body: EventBody) -> None:
    try:
        writer = get_stream_writer()
    except RuntimeError, KeyError:  # no graph run: outside any runnable, or in a runnable outside a graph
        return
    writer(body)


_step_scope: ContextVar[Scope] = ContextVar("step_scope", default="chat")


@contextmanager
def step_scope(scope: Scope) -> Iterator[None]:
    token = _step_scope.set(scope)
    try:
        yield
    finally:
        _step_scope.reset(token)


@dataclass
class SubagentFrame:
    run_id: str
    parent_run_id: str | None
    tool_call_id: str | None = None
    failed: bool = False


_subagent: ContextVar[SubagentFrame | None] = ContextVar("turn_subagent", default=None)


SUBAGENT_FAILED_MESSAGE = "The subagent failed; the turn goes on without its result."


def current_subagent() -> SubagentFrame | None:
    return _subagent.get()


def _clip(text: str | None, limit: int) -> str | None:
    flat = " ".join((text or "").split())
    if not flat:
        return None
    return flat if len(flat) <= limit else flat[: limit - 1].rstrip() + "…"


@asynccontextmanager
async def subagent_run(
    name: str, *, description: str | None = None, parent_tool_call_id: str | None = None
) -> AsyncIterator[SubagentFrame]:
    parent = _subagent.get()
    frame = SubagentFrame(
        run_id=f"sa_{uuid4().hex[:20]}",
        parent_run_id=parent.run_id if parent else None,
        tool_call_id=parent_tool_call_id[:128] if parent_tool_call_id else None,
    )
    emit(
        SubagentStartedBody(
            subagent_run_id=frame.run_id,
            name=name[:64],
            description=_clip(description, 160),
            parent_subagent_run_id=frame.parent_run_id,
            parent_tool_call_id=frame.tool_call_id,
        )
    )
    token = _subagent.set(frame)
    try:
        yield frame
    except GraphBubbleUp:
        raise
    except Exception as exc:
        logger.info("Subagent %s (%s) failed: %s", name, frame.run_id, type(exc).__name__)
        fail_subagent(frame, type(exc).__name__)
        raise
    else:
        if not frame.failed:
            emit(SubagentFinishedBody(subagent_run_id=frame.run_id))
    finally:
        _subagent.reset(token)


def fail_subagent(frame: SubagentFrame, code: str) -> None:
    if frame.failed:
        return
    frame.failed = True
    emit(SubagentErrorBody(subagent_run_id=frame.run_id, message=SUBAGENT_FAILED_MESSAGE, code=code[:64] or None))


_INHERIT: Any = object()


def emit_step(step: Step, *, started: bool = False, subagent_run_id: str | None = _INHERIT) -> None:
    scope = _step_scope.get()
    if scope != step.scope:
        step = step.model_copy(update={"scope": scope})
    if subagent_run_id is _INHERIT:
        frame = _subagent.get()
        subagent_run_id = frame.run_id if frame else None
    emit(
        StepStartedBody(step=step, subagent_run_id=subagent_run_id)
        if started
        else StepFinishedBody(step=step, subagent_run_id=subagent_run_id)
    )


_retrieval_round: ContextVar[int | None] = ContextVar("retrieval_round", default=None)


def current_retrieval_round() -> int | None:
    return _retrieval_round.get()


def stamp_retrieval_round(round_index: int) -> None:
    _retrieval_round.set(round_index)


@contextmanager
def retrieval_round_scope(round_index: int | None) -> Iterator[None]:
    token = _retrieval_round.set(round_index)
    try:
        yield
    finally:
        _retrieval_round.reset(token)


_lane_tool: ContextVar[str | None] = ContextVar("lane_tool", default=None)


def current_lane_tool() -> str | None:
    return _lane_tool.get()


@contextmanager
def lane_tool_scope(tool: str | None) -> Iterator[None]:
    token = _lane_tool.set((tool or "").strip() or None)
    try:
        yield
    finally:
        _lane_tool.reset(token)


_lane_captured_hits: ContextVar[list[dict[str, Any]] | None] = ContextVar("lane_captured_hits", default=None)


def begin_lane_capture() -> Token:
    return _lane_captured_hits.set([])


def end_lane_capture(token: Token) -> None:
    _lane_captured_hits.reset(token)


def record_lane_hit(
    name: str,
    *,
    title: str | None = None,
    detail: str | None = None,
    shelf: str | None = None,
) -> None:
    try:
        log = _lane_captured_hits.get()
        clean = (name or "").strip()
        if log is None or not clean:
            return
        entry: dict[str, Any] = {"round": current_retrieval_round(), "name": clean}
        tool = current_lane_tool()
        if tool:
            entry["tool"] = tool
        if title and title.strip():
            entry["title"] = title.strip()
        if detail and detail.strip():
            entry["detail"] = detail.strip()
        if shelf and shelf.strip():
            entry["shelf"] = shelf.strip()
        log.append(entry)
    except Exception:  # noqa: BLE001 — capture must never take a turn down
        logger.debug("Lane hit not captured", exc_info=True)


def get_lane_captures() -> list[dict[str, Any]]:
    return list(_lane_captured_hits.get() or [])


STATUS_STEP_PREFIX = "status:"


CHANNEL_LIVE: Channel = "live"


CHANNEL_TECHNICAL: Channel = "technical"


MAX_QUERY_CHARS = 32


MAX_REASON_CHARS = 160


def clip(text: str, limit: int) -> str:
    text = " ".join(str(text).split())
    if len(text) <= limit:
        return text
    return text[: max(1, limit - 1)].rstrip() + "…"


def status_step(
    slot: str,
    key: str | None = None,
    *,
    values: dict[str, Any] | None = None,
    channel: Channel = CHANNEL_LIVE,
    **detail: Scalar | list[str] | None,
) -> StatusStep:
    clean = {name: str(value).strip() for name, value in (values or {}).items() if value is not None}
    return StatusStep(
        id=f"{STATUS_STEP_PREFIX}{slot}",
        slot=slot,
        key=key,
        values={name: text for name, text in clean.items() if text},
        channel=channel,
        detail={name: value for name, value in detail.items() if value is not None},
    )


def emit_status(
    slot: str,
    key: str | None = None,
    *,
    values: dict[str, Any] | None = None,
    channel: Channel = CHANNEL_LIVE,
    **detail: Scalar | list[str] | None,
) -> None:
    emit_step(status_step(slot, key, values=values, channel=channel, **detail))


def emit_technical(slot: str, **detail: Scalar | list[str] | None) -> None:
    emit_status(slot, channel=CHANNEL_TECHNICAL, **detail)
