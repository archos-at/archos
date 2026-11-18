from __future__ import annotations

import asyncio
import contextlib
import logging
from dataclasses import dataclass
from dataclasses import field
from typing import TYPE_CHECKING
from typing import Any

from fastapi import WebSocket

from agent.auth.errors import AuthError
from agent.common.action_rows import is_literal_search
from agent.common.steering import bind_steer_inbox
from agent.common.steering import unbind_steer_inbox
from agent.common.wire_v2 import EventBody
from agent.common.wire_v2 import HeartbeatBody
from agent.common.wire_v2 import HeartbeatValue
from agent.common.wire_v2 import RunErrorBody
from agent.common.wire_v2 import RunFinishedBody
from agent.common.wire_v2 import UserMessage
from agent.common.write_fence import TurnFenced
from agent.common.write_fence import bind_write_fence
from agent.common.write_fence import unbind_write_fence
from agent.observability import answer_failure
from agent.observability.answer_scores import steer_scores
from agent.observability.langfuse_scores import emit_scores
from agent.observability.langfuse_scores import file_tool_scores
from agent.observability.langfuse_scores import turn_outcome_scores
from agent.observability.langfuse_trace_attributes import begin_trace_contributions
from agent.observability.langfuse_trace_attributes import end_trace_contributions
from agent.observability.langfuse_trace_attributes import record_posthog_session
from agent.observability.langfuse_trace_attributes import record_turn_surface
from agent.observability.langfuse_trace_attributes import record_turn_trigger
from agent.observability.turn_outcome import begin_turn_outcome
from agent.observability.turn_outcome import end_turn_outcome
from agent.observability.turn_outcome import record_turn_error
from agent.observability.turn_outcome import record_turn_finished
from agent.observability.turn_trace import pinned_trace
from agent.observability.turn_trace import trace_id_for_message
from agent.turn.annotation_reply import bind_thread_reply
from agent.turn.annotation_reply import reset_thread_reply
from agent.turn.payload import thread_reply_requested
from agent.turn.payload import turn_surface
from agent_host.auth.middleware import build_request_trace_tags
from agent_host.auth.middleware import user_context
from agent_host.auth.request_trace import request_trace_tag_context
from agent_host.chat_auth import external_hostnames
from agent_host.chat_registry import ChatRegistry
from agent_host.chat_turn import InteractionExpired
from agent_host.chat_turn import RunningTurn
from agent_host.chat_turn import TurnDeadlineExceeded
from agent_host.chat_wire import TurnWire
from agent_host.socket_identity import trace_user_id
from agent_host.tool_calls import tool_called_by
from agent_host.workflow_stream import stream_workflow

if TYPE_CHECKING:
    from nat.runtime.session import SessionManager

logger = logging.getLogger(__name__)

TURN_HEARTBEAT_SECONDS = 20.0


async def _beat(wire: TurnWire) -> None:
    body = HeartbeatBody(value=HeartbeatValue(every_ms=int(TURN_HEARTBEAT_SECONDS * 1000)))
    while True:
        await asyncio.sleep(TURN_HEARTBEAT_SECONDS)
        await wire.send(body)


@dataclass
class _ToolTally:
    called: dict[str, str] = field(default_factory=dict)
    literal_searches: set[str] = field(default_factory=set)

    def see(self, body: EventBody) -> None:
        if (tool := tool_called_by(body)) is not None:
            self.called[body.step.id] = tool
        elif is_literal_search(getattr(body, "step", None)):
            self.literal_searches.add(body.step.id)


def _score_finished(turn: RunningTurn, body: RunFinishedBody, tally: _ToolTally) -> None:
    record_turn_finished(body)
    if body.outcome == "answered":
        emit_scores(turn_outcome_scores(body.result), writer="chat")
    emit_scores(file_tool_scores(tally.called.values(), len(tally.literal_searches)), writer="chat")
    if turn.inbox.received:
        emit_scores(steer_scores(turn.inbox), writer="chat")


def _record_terminal(turn: RunningTurn, body: EventBody, tally: _ToolTally) -> None:
    if isinstance(body, RunFinishedBody):
        _score_finished(turn, body, tally)
    elif isinstance(body, RunErrorBody):
        record_turn_error(body.code, body.details or body.message)
        answer_failure.report_turn_failed(turn, answer_failure.reason_for_text(body.details or body.message), body.code)


async def _relay_workflow(turn: RunningTurn, request: UserMessage, session: Any) -> None:
    tally = _ToolTally()
    async with contextlib.aclosing(stream_workflow(request, session=session)) as bodies:
        async for body in bodies:
            tally.see(body)
            _record_terminal(turn, body, tally)
            await turn.publish(body)


async def _drive(
    turn: RunningTurn,
    request: UserMessage,
    *,
    session_manager: SessionManager,
    socket: WebSocket,
    caller: dict[str, Any],
) -> None:
    headers = dict(socket.scope.get("headers", []))
    tags = build_request_trace_tags(headers, socket.scope, caller, external_hostnames=external_hostnames())
    outcome = begin_turn_outcome()
    contributions = begin_trace_contributions()
    record_posthog_session(request.posthog_session_id)
    record_turn_surface(turn_surface(request.focus_region, reply_in_thread=thread_reply_requested(request)))
    record_turn_trigger(request.trigger)
    steering = bind_steer_inbox(turn.inbox)
    thread = bind_thread_reply(turn.thread_reply)
    try:
        await _run_in_session(turn, request, session_manager=session_manager, socket=socket, caller=caller, tags=tags)
    except Exception as exc:
        record_turn_error(_error_for(exc).code, str(exc))
        raise
    finally:
        reset_thread_reply(thread)
        unbind_steer_inbox(steering)
        end_trace_contributions(contributions)
        end_turn_outcome(outcome)


async def _run_in_session(
    turn: RunningTurn,
    request: UserMessage,
    *,
    session_manager: SessionManager,
    socket: WebSocket,
    caller: dict[str, Any],
    tags: dict[str, str],
) -> None:
    with pinned_trace(trace_id_for_message(turn.message_id)), user_context(caller), request_trace_tag_context(tags):
        async with session_manager.session(
            user_id=trace_user_id(turn, caller),
            user_message_id=request.message_id,
            conversation_id=request.conversation_id,
            http_connection=socket,
            user_input_callback=turn.ask,
        ) as session:
            await _relay_workflow(turn, request, session)


DEADLINE_DETAILS = "turn_deadline_exceeded"


def _error_for(exc: Exception) -> RunErrorBody:
    if isinstance(exc, InteractionExpired):
        return RunErrorBody(code="interaction_expired", message="The question was not answered in time.")
    if isinstance(exc, AuthError):
        return RunErrorBody(code="auth_error", message=exc.error_code, details=str(exc))
    if isinstance(exc, TurnDeadlineExceeded):
        return RunErrorBody(
            code="workflow_error",
            message="The answer took too long and was stopped. Please ask again, perhaps more narrowly.",
            details=f"{DEADLINE_DETAILS}: {exc}",
        )
    if answer_failure.reason_for(exc) == answer_failure.PROVIDER_CREDITS:
        return RunErrorBody(code="workflow_error", message=answer_failure.CREDITS_MESSAGE, details=str(exc))
    return RunErrorBody(
        code="workflow_error",
        message="The assistant hit an unexpected error while handling your request. Please try again.",
        details=str(exc),
    )


async def run_turn(turn: RunningTurn, request: UserMessage, *, registry: ChatRegistry, **drive: Any) -> None:
    heartbeat = asyncio.create_task(_beat(turn.wire))
    keeper = asyncio.create_task(registry.keep_conversation(turn)) if turn.holds_marker else None
    bound = bind_write_fence(turn.guard)  # the graph's tasks inherit it; its checkpoint writes ask it first
    try:
        await _end_turn(turn, request, **drive)
    finally:
        unbind_write_fence(bound)
        await _stop_background(heartbeat, keeper)
        await _ensure_terminal(turn)
        turn.after_terminal()
        registry.finish_turn(turn)
        if turn.guard is not None:
            turn.guard.release()  # it ended on its own: the stage frames and the persist behind it are not fenced
        if turn.holds_marker:
            await registry.release_conversation(turn.wire.conversation_id, turn.wire.turn_id)


async def _stop_background(*tasks: asyncio.Task[None] | None) -> None:
    for background in tasks:
        if background is None:
            continue
        background.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await background


async def _end_turn(turn: RunningTurn, request: UserMessage, **drive: Any) -> None:
    try:
        async with turn.deadline.running():
            await _drive(turn, request, **drive)
    except asyncio.CancelledError:
        asyncio.current_task().uncancel()
        await turn.finish_cancelled()
    except TurnFenced:
        await turn.finish_cancelled()
    except Exception as exc:  # noqa: BLE001 — every failure ends the turn with a RUN_ERROR the client can act on
        logger.warning("Turn %s failed", turn.wire.turn_id, exc_info=True)
        answer_failure.report_turn_failed(turn, answer_failure.reason_for(exc), type(exc).__name__)
        await turn.wire.send(_error_for(exc))


async def _ensure_terminal(turn: RunningTurn) -> None:
    if turn.wire.finished:
        return
    answer_failure.report_turn_failed(turn, answer_failure.WORKFLOW_ERROR, "no_terminal")
    await turn.wire.send(RunErrorBody(code="workflow_error", message="The turn ended without a result."))
