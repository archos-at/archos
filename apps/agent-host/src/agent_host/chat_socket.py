from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import re
import time
from collections.abc import AsyncIterator
from collections.abc import Awaitable
from collections.abc import Callable
from collections.abc import Mapping
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
from typing import TYPE_CHECKING
from typing import Any

from fastapi import WebSocket
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect

from agent.auth.errors import AuthError
from agent.common.action_rows import is_literal_search
from agent.common.content_screen import ScreeningRules
from agent.common.content_screen import findings_summary
from agent.common.content_screen import mask_text
from agent.common.human_prompt import human_response
from agent.common.human_prompt import interaction_request
from agent.common.licensed_text import LICENSED_TRACE_TAG
from agent.common.steering import SteerInbox
from agent.common.steering import SteerNote
from agent.common.steering import bind_steer_inbox
from agent.common.steering import unbind_steer_inbox
from agent.common.wire_v2 import ACCEPTED_CLIENT_FIELDS
from agent.common.wire_v2 import CLIENT_MESSAGE
from agent.common.wire_v2 import CLOSE_CLIENT_OUTDATED
from agent.common.wire_v2 import WIRE_VERSION
from agent.common.wire_v2 import Attach
from agent.common.wire_v2 import CancelTurn
from agent.common.wire_v2 import EventBody
from agent.common.wire_v2 import HeartbeatBody
from agent.common.wire_v2 import HeartbeatValue
from agent.common.wire_v2 import Hello
from agent.common.wire_v2 import HelloValue
from agent.common.wire_v2 import InteractionRequestBody
from agent.common.wire_v2 import InteractionResolvedBody
from agent.common.wire_v2 import InteractionResolvedValue
from agent.common.wire_v2 import InteractionResponse
from agent.common.wire_v2 import RejectedBody
from agent.common.wire_v2 import RejectedValue
from agent.common.wire_v2 import RunErrorBody
from agent.common.wire_v2 import RunFinishedBody
from agent.common.wire_v2 import RunStartedBody
from agent.common.wire_v2 import ShownAnswer
from agent.common.wire_v2 import StageBody
from agent.common.wire_v2 import StageValue
from agent.common.wire_v2 import Steer
from agent.common.wire_v2 import SteerReceivedBody
from agent.common.wire_v2 import SteerReceivedValue
from agent.common.wire_v2 import TextAnswer
from agent.common.wire_v2 import TurnResult
from agent.common.wire_v2 import UserMessage
from agent.common.wire_v2 import stamp
from agent.common.wire_v2 import to_frame
from agent.common.write_fence import TurnFenced
from agent.common.write_fence import WriteFence
from agent.common.write_fence import bind_write_fence
from agent.common.write_fence import check_write
from agent.common.write_fence import unbind_write_fence
from agent.conversation_context import ContextOnlyMessage
from agent.conversation_context import append_conversation_context
from agent.conversation_context import format_context_turn
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
from agent.observability.turn_outcome import turn_tagged
from agent.observability.turn_trace import pinned_trace
from agent.observability.turn_trace import trace_id_for_message
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_HEADER
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_SIG_HEADER
from agent.project_context import RequestContext
from agent.tools.documents.filing import SignedEnvelope
from agent.turn.admission import TurnRefusal
from agent.turn.admission import refused
from agent.turn.annotation_reply import ThreadReply
from agent.turn.annotation_reply import bind_thread_reply
from agent.turn.annotation_reply import post_fallback_reply
from agent.turn.annotation_reply import reset_thread_reply
from agent.turn.payload import thread_reply_requested
from agent.turn.payload import turn_surface
from agent.turn.response import answer_message_id
from agent.turn.streaming import TurnTextFold
from agent_host.after_terminal_writes import drain_after_terminal
from agent_host.after_terminal_writes import drain_cancel_grace
from agent_host.after_terminal_writes import in_background
from agent_host.auth.middleware import build_request_trace_tags
from agent_host.auth.middleware import detect_internal_caller
from agent_host.auth.middleware import resolve_request_user
from agent_host.auth.middleware import user_context
from agent_host.auth.request_trace import request_trace_tag_context
from agent_host.conversation_bus import CANCEL
from agent_host.conversation_bus import FRAME
from agent_host.conversation_bus import HITL_ANSWER
from agent_host.conversation_bus import STEER
from agent_host.conversation_bus import SUPERSEDE
from agent_host.conversation_bus import BusUnavailable
from agent_host.conversation_bus import ConversationBus
from agent_host.conversation_bus import Envelope
from agent_host.conversation_bus import get_bus
from agent_host.conversation_bus import is_multi_replica_bus
from agent_host.conversation_bus import running_renew_interval
from agent_host.conversation_bus import running_ttl
from agent_host.internal_api import ChatScreening
from agent_host.internal_api import chat_screening_for
from agent_host.internal_api import post_internal_conversation_message
from agent_host.internal_api import post_internal_turn_outcome
from agent_host.internal_api import post_internal_turn_steps
from agent_host.socket_identity import may_act_for
from agent_host.socket_identity import token_expired
from agent_host.socket_identity import trace_user_id
from agent_host.socket_identity import verified_display_name
from agent_host.socket_identity import verified_subject
from agent_host.startup_banner import deployed_sha
from agent_host.tool_calls import tool_called_by
from agent_host.turn_fence import TurnFence
from agent_host.turn_fence import validate_running_ttl
from agent_host.turn_record import TurnFrames
from agent_host.turn_record import turn_row_metadata
from agent_host.workflow_stream import stream_workflow
from nat.plugin_api import HumanResponse
from nat.plugin_api import InteractionPrompt

if TYPE_CHECKING:
    from nat.runtime.session import SessionManager

logger = logging.getLogger(__name__)

WS_POLICY_VIOLATION = 1008

TURN_HEARTBEAT_SECONDS = 20.0

HITL_RESPONSE_TIMEOUT_SECONDS = float(os.getenv("HITL_RESPONSE_TIMEOUT_SECONDS", "1800"))

STAGE_WIRE_TTL_S = 600.0

TURN_DEADLINE_SECONDS = float(os.getenv("CHAT_TURN_DEADLINE_SECONDS", "2700"))

LOCAL_REPLAY_FRAMES = 2000

SUPERSEDE_WAIT_SECONDS = float(os.getenv("CHAT_SUPERSEDE_WAIT_SECONDS", "13.5") or "13.5")

DRAIN_SECONDS = float(os.getenv("CHAT_DRAIN_SECONDS", "2700") or "2700")

SUPERSEDE_POLL_SECONDS = 0.2
SUPERSEDE_REPUBLISH_SECONDS = 2.0

PREVIOUS_TURN_REFUSAL = (
    "The assistant is still finishing the previous answer. Please send your message again in a moment."
)
FENCE_UNAVAILABLE_REFUSAL = (
    "The assistant cannot start a new answer right now. Please send your message again in a moment."
)
REFUSAL_RETRY_AFTER_SECONDS = 5

BUSY_REFUSAL = "The conversation is running another turn; ask again once it has finished."


def chat_affinity_enabled() -> bool:
    return os.getenv("CHAT_AFFINITY", "1").strip().lower() not in ("0", "false", "no", "off", "")


_ADDITIVE_FIELDS_ENV = "WIRE_V2_ADDITIVE_FIELDS"

STAGED_SERVER_FIELDS: tuple[tuple[str, str, str], ...] = (
    ("hello", "value", "accepts"),
    ("RUN_FINISHED", "result", "reasoning_effort"),
)


def additive_wire_fields_enabled() -> bool:
    return os.getenv(_ADDITIVE_FIELDS_ENV, "on").strip().lower() not in ("0", "false", "no", "off", "")


def for_open_tabs(frame: dict[str, Any]) -> dict[str, Any]:
    if additive_wire_fields_enabled():
        return frame
    kind = frame.get("name") if frame.get("type") == "CUSTOM" else frame.get("type")
    for staged_kind, member, key in STAGED_SERVER_FIELDS:
        inner = frame.get(member)
        if kind == staged_kind and isinstance(inner, dict):
            inner.pop(key, None)
    return frame


if not chat_affinity_enabled():
    validate_running_ttl(running_ttl())


_LOOP_RESTART_MIN_S = 0.5
_LOOP_RESTART_MAX_S = 30.0

BUS_READY_TIMEOUT_S = 1.0

_ORG_ID_HEADER = "x-grid-organization-id"
_NOT_ASKER_STOP = "Only the person who asked can stop this turn."

_auth_validators: list = []
_require_auth = False
_external_hostnames: set[str] | None = None


def configure_websocket_auth(
    *,
    validators: list | None = None,
    require_auth: bool = False,
    external_hostnames: set[str] | None = None,
) -> None:
    global _auth_validators, _require_auth, _external_hostnames
    _auth_validators = list(validators or [])
    _require_auth = require_auth
    _external_hostnames = external_hostnames


async def authenticate_websocket_connection(socket: WebSocket) -> tuple[dict[str, Any] | None, int | None]:
    headers = dict(socket.scope.get("headers", []))
    user, _, is_external, _ = await resolve_request_user(
        headers,
        validators=_auth_validators,
        require_auth=_require_auth,
        external_hostnames=_external_hostnames,
    )
    if user is not None:
        return user, None
    if not is_external:
        return detect_internal_caller(headers), None
    return None, WS_POLICY_VIOLATION


def _handshake_envelope(scope: Mapping[str, Any]) -> RequestContext | None:
    headers: dict[str, str] = {}
    for raw_name, raw_value in scope.get("headers", []) or []:
        with contextlib.suppress(AttributeError, UnicodeDecodeError):
            headers[raw_name.decode("latin-1").lower()] = raw_value.decode("latin-1")
    return RequestContext.from_envelope(
        headers.get(REQUEST_CONTEXT_ENVELOPE_HEADER),
        headers.get(REQUEST_CONTEXT_ENVELOPE_SIG_HEADER),
        os.environ.get("INTERNAL_API_TOKEN"),
    )


def handshake_conversation_binding(scope: Mapping[str, Any]) -> tuple[bool, str | None]:
    envelope = _handshake_envelope(scope)
    if envelope is None:
        return False, None
    return True, envelope.conversation_id


def _org_id_from_scope(scope: Mapping[str, Any]) -> str | None:
    for raw_name, raw_value in scope.get("headers", []) or []:
        name = raw_name.decode() if isinstance(raw_name, bytes) else str(raw_name)
        if name.lower() == _ORG_ID_HEADER:
            return raw_value.decode() if isinstance(raw_value, bytes) else str(raw_value)
    return None


async def persist_turn_result(
    *,
    conversation_id: str,
    organization_id: str | None,
    finished: RunFinishedBody,
    guard: WriteFence | None = None,
    turn_id: str | None = None,
    step_frames: Sequence[dict[str, Any]] = (),
) -> bool:
    metadata = turn_row_metadata(finished)
    if metadata is None:
        return False
    if turn_tagged(LICENSED_TRACE_TAG):  # read licensed text: the distiller takes no vote on it (E44, ADR-0164)
        metadata["licensed_text"] = True
    try:
        check_write(guard)
    except TurnFenced:
        logger.warning("Turn %s lost its conversation: its outcome is not persisted", finished.result.message_id)
        return False
    written = await post_internal_conversation_message(
        conversation_id=conversation_id,
        organization_id=organization_id,
        message_id=finished.result.message_id,
        role="assistant",
        text=finished.result.text,
        message_type="agent_response",
        metadata=metadata,
    )
    if written and turn_id and step_frames:  # the Herleitung, on the question; nothing waits on it (`turn_record`)
        in_background(post_internal_turn_steps(conversation_id, organization_id, turn_id, step_frames))
    return written


def _persist_in_background(
    wire: TurnWire, organization_id: str | None, finished: RunFinishedBody, guard: WriteFence | None = None
) -> asyncio.Task[Any]:
    return in_background(
        persist_turn_result(
            conversation_id=wire.conversation_id,
            organization_id=organization_id,
            finished=finished,
            guard=guard,
            turn_id=wire.turn_id,
            step_frames=wire.step_frames(),
        )
    )


OUTCOME_OF_TERMINAL = {"answered": "answered", "refused": "refused", "handed_off": "handed_off", "cancelled": "stopped"}

OUTCOME_REASON_CHARS = 500

_TURN_ID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _outcome_reason(text: str) -> str | None:
    flat = " ".join((text or "").split())
    if not flat:
        return None
    return flat if len(flat) <= OUTCOME_REASON_CHARS else flat[: OUTCOME_REASON_CHARS - 1].rstrip() + "…"


def turn_outcome_report(
    conversation_id: str, turn_id: str, terminal: RunFinishedBody | RunErrorBody
) -> dict[str, Any] | None:
    if not _TURN_ID.match(turn_id):
        return None
    if isinstance(terminal, RunErrorBody):
        outcome, reason = "failed", _outcome_reason(terminal.message) or "failed"
    else:
        outcome = OUTCOME_OF_TERMINAL[terminal.outcome]
        reason = _outcome_reason(terminal.result.text) if outcome == "refused" else None
    return {"conversation_id": conversation_id, "turn_id": turn_id, "outcome": outcome, "reason": reason}


async def _report_outcome(turn: RunningTurn, terminal: RunFinishedBody | RunErrorBody) -> None:
    report = turn_outcome_report(turn.wire.conversation_id, turn.wire.turn_id, terminal)
    if report is None:
        logger.info("Headless turn %s has an id no wake mints: its outcome is not reported", turn.wire.turn_id)
        return
    await post_internal_turn_outcome(**report)


async def _after_terminal(turn: RunningTurn) -> None:
    terminal = turn.wire.terminal
    if terminal is None:
        return
    try:
        if turn.persisting is not None:
            await asyncio.wait({turn.persisting})
        if isinstance(terminal, RunFinishedBody):
            await post_fallback_reply(
                turn.thread_reply, terminal, answer_message_id=turn.message_id, envelope=turn.envelope
            )
        if turn.headless:
            await _report_outcome(turn, terminal)
    except Exception:  # noqa: BLE001 - the answer is out; what follows it is best effort
        logger.warning("What follows the terminal of turn %s failed", turn.wire.turn_id, exc_info=True)


def _now_ms() -> int:
    return int(time.time() * 1000)


class TurnWire:
    def __init__(
        self,
        conversation_id: str,
        turn_id: str,
        publish: Callable[[str, dict], Awaitable[bool]],
        guard: WriteFence | None = None,
    ) -> None:
        self.conversation_id = conversation_id
        self.turn_id = turn_id
        self._guard = guard
        self.seq = 0
        self.finished = False
        self.terminal: RunFinishedBody | RunErrorBody | None = None
        self._publish = publish
        self._lock = asyncio.Lock()
        self._held_stages: list[StageBody] = []
        self._frames = TurnFrames(LOCAL_REPLAY_FRAMES)
        self.on_stamp: Callable[[EventBody, int], None] | None = None

    def replay(self) -> list[dict[str, Any]]:
        return list(self._frames)

    def step_frames(self) -> list[dict[str, Any]]:
        return list(self._frames.steps)

    async def send(self, body: EventBody) -> bool:
        if self._guard is not None and self._guard.fenced() and not isinstance(body, RunFinishedBody | RunErrorBody):
            logger.debug("Dropping %s of fenced turn %s", type(body).__name__, self.turn_id)
            return False
        async with self._lock:
            if isinstance(body, StageBody) and not self.finished:
                self._held_stages.append(body)
                return True
            if self.finished and not isinstance(body, StageBody):
                logger.debug("Dropping %s after the terminal of turn %s", type(body).__name__, self.turn_id)
                return False
            delivered = await self._stamp_and_publish(body)
            if isinstance(body, RunFinishedBody | RunErrorBody):
                self.finished = True
                self.terminal = body
                for stage in self._held_stages:
                    await self._stamp_and_publish(stage)
                self._held_stages.clear()
            return delivered

    async def _stamp_and_publish(self, body: EventBody) -> bool:
        self.seq += 1
        if self.on_stamp is not None:
            self.on_stamp(body, self.seq)
        event = stamp(body, conversation_id=self.conversation_id, turn_id=self.turn_id, seq=self.seq, ts=_now_ms())
        frame = for_open_tabs(to_frame(event))
        self._frames.append(frame)
        return await self._publish(self.conversation_id, frame)


class InteractionExpired(TimeoutError): ...


class TurnDeadlineExceeded(Exception): ...


class TurnDeadline:
    def __init__(self, seconds: float | None = None) -> None:
        self.seconds = TURN_DEADLINE_SECONDS if seconds is None else seconds
        self._timeout: asyncio.Timeout | None = None
        self._left: float | None = None

    @contextlib.asynccontextmanager
    async def running(self) -> AsyncIterator[None]:
        timeout = asyncio.timeout(self.seconds if self.seconds > 0 else None)
        try:
            async with timeout:
                self._timeout = timeout
                yield
        except TimeoutError as exc:
            if not timeout.expired():
                raise  # the workflow's own, e.g. InteractionExpired
            raise TurnDeadlineExceeded(f"no result within the turn's {self.seconds:.0f}s") from exc
        finally:
            self._timeout = None

    def pause(self) -> None:
        timeout = self._timeout
        if timeout is None or timeout.expired() or self._left is not None or timeout.when() is None:
            return
        self._left = max(0.0, timeout.when() - asyncio.get_running_loop().time())
        timeout.reschedule(None)

    def resume(self) -> None:
        timeout, left = self._timeout, self._left
        self._left = None
        if timeout is None or left is None or timeout.expired():
            return
        timeout.reschedule(asyncio.get_running_loop().time() + left)


@dataclass(frozen=True)
class Fence:
    held: bool = False
    refusal: str | None = None
    guard: TurnFence | None = None


@dataclass
class PendingInteraction:
    prompt: InteractionPrompt
    answer: asyncio.Future[HumanResponse]


@dataclass
class RunningTurn:
    wire: TurnWire
    asker_subject: str | None
    organization_id: str | None = None
    task: asyncio.Task[None] | None = None
    fold: TurnTextFold = field(default_factory=TurnTextFold)
    shown: ShownAnswer | None = None
    pending: PendingInteraction | None = None
    deadline: TurnDeadline = field(default_factory=TurnDeadline)
    holds_marker: bool = False
    guard: TurnFence | None = None
    reasoning_effort: str | None = None
    inbox: SteerInbox = field(default_factory=SteerInbox)
    headless: bool = False
    thread_reply: ThreadReply | None = None
    envelope: SignedEnvelope | None = None
    envelope_user_id: str | None = None
    persisting: asyncio.Task[Any] | None = None
    _followed: bool = field(default=False, init=False, repr=False)

    def __post_init__(self) -> None:
        self.wire.on_stamp = self.fold.add

    @property
    def message_id(self) -> str:
        return answer_message_id(self.wire.conversation_id, self.wire.turn_id)

    async def publish(self, body: EventBody) -> None:
        if isinstance(body, RunFinishedBody):
            await self.finish(body)
            return
        await self.wire.send(body)

    async def finish(self, finished: RunFinishedBody) -> None:
        if self.wire.finished:
            logger.warning("Turn %s already ended; a second terminal is dropped", self.wire.turn_id)
            return
        await self.wire.send(finished)
        self.persisting = _persist_in_background(self.wire, self.organization_id, finished, self.guard)

    def after_terminal(self) -> None:
        if self._followed or self.wire.terminal is None:
            return
        self._followed = True
        in_background(_after_terminal(self))

    async def ask(self, prompt: InteractionPrompt) -> HumanResponse:
        expires_at = _now_ms() + int(HITL_RESPONSE_TIMEOUT_SECONDS * 1000)
        self.pending = PendingInteraction(prompt=prompt, answer=asyncio.get_running_loop().create_future())
        await self.wire.send(InteractionRequestBody(value=interaction_request(prompt, expires_at=expires_at)))
        try:
            response = await self._wait_for_person(self.pending.answer)
        except TimeoutError:
            await self._resolved(prompt, "expired")
            raise InteractionExpired(f"interaction {prompt.id} expired unanswered") from None
        except asyncio.CancelledError:
            await self._resolved(prompt, "cancelled")
            raise
        finally:
            self.pending = None
        await self._resolved(prompt, "answered")
        return response

    async def _wait_for_person(self, answer: asyncio.Future[HumanResponse]) -> HumanResponse:
        self.deadline.pause()
        try:
            return await asyncio.wait_for(answer, timeout=HITL_RESPONSE_TIMEOUT_SECONDS)
        finally:
            self.deadline.resume()

    async def _resolved(self, prompt: InteractionPrompt, outcome: str) -> None:
        value = InteractionResolvedValue(interaction_id=prompt.id, outcome=outcome)
        await self.wire.send(InteractionResolvedBody(value=value))

    def answer(self, message: InteractionResponse, *, subject: str | None, internal: bool) -> str | None:
        pending = self.pending
        if pending is None or pending.prompt.id != message.interaction_id or pending.answer.done():
            return "no_pending_interaction"
        if not may_act_for(self.asker_subject, subject, internal=internal):
            return "not_asker"
        try:
            response = human_response(pending.prompt.content, message.answer)
        except ValueError:
            return "invalid_message"
        pending.answer.set_result(response)
        return None

    async def steer(self, message: Steer, *, subject: str | None, internal: bool, author: str | None) -> str | None:
        if not may_act_for(self.asker_subject, subject, internal=internal):
            return "not_asker"
        if self.wire.finished:
            return "turn_not_found"
        note = SteerNote(steer_id=message.steer_id, text=message.text, author=author, focus_region=message.focus_region)
        offered = self.inbox.offer(note)
        if offered == "limit":
            return "steer_limit"
        if offered == "received":
            await self.wire.send(SteerReceivedBody(value=SteerReceivedValue(steer_id=note.steer_id, text=note.text)))
        return None

    def cancel(self, *, subject: str | None, internal: bool, shown: ShownAnswer | None = None) -> str | None:
        if not may_act_for(self.asker_subject, subject, internal=internal):
            return "not_asker"
        if shown is not None:
            self.shown = shown
        if self.task is not None:
            self.task.cancel()
        return None

    async def finish_cancelled(self) -> None:
        kept = self.fold.stopped(self.shown)
        result = TurnResult(
            message_id=self.message_id,
            text=kept.text,
            sources=kept.sources,
            cards=kept.cards,
            answer_meta=kept.answer_meta,
            reasoning_effort=self.reasoning_effort,
        )
        await self.finish(RunFinishedBody(outcome="cancelled", result=result))


class _Outlet:
    def __init__(self, socket: WebSocket, *, holding: bool = False) -> None:
        self.socket = socket
        self.held: list[dict[str, Any]] | None = [] if holding else None

    async def deliver(self, frame: dict[str, Any]) -> bool:
        if self.held is not None:
            self.held.append(frame)
            return True
        return await _write(self.socket, frame)


async def _write(socket: WebSocket, frame: dict[str, Any]) -> bool:
    try:
        await socket.send_json(frame)
    except RuntimeError, OSError, WebSocketDisconnect:
        logger.debug("Socket write failed; the frame stays in the conversation stream", exc_info=True)
        return False
    return True


class ChatRegistry:
    def __init__(self, bus: ConversationBus | None = None) -> None:
        self._bus = bus
        self._outlets: dict[str, _Outlet] = {}
        self._turns: dict[str, RunningTurn] = {}
        self._finished: dict[tuple[str, str], tuple[TurnWire, float]] = {}
        self._relays: dict[str, asyncio.Task[None]] = {}
        self._relay_ready: dict[str, asyncio.Event] = {}
        self._inputs: dict[str, asyncio.Task[None]] = {}

    def bus(self) -> ConversationBus:
        return self._bus or get_bus()

    def set_socket(self, conversation_id: str, socket: WebSocket, *, holding: bool = False) -> _Outlet:
        current = self._outlets.get(conversation_id)
        if current is not None and current.socket is socket and not holding:
            return current
        outlet = _Outlet(socket, holding=holding)
        self._outlets[conversation_id] = outlet
        if is_multi_replica_bus():
            ready = self._relay_ready[conversation_id] = asyncio.Event()
            relay = _supervise("relay", conversation_id, lambda: self._relay(conversation_id, ready))
            _restart(self._relays, conversation_id, relay)
        return outlet

    def clear_socket(self, conversation_id: str | None, socket: WebSocket) -> None:
        outlet = self._outlets.get(conversation_id or "")
        if outlet is None or outlet.socket is not socket:
            return
        del self._outlets[conversation_id]
        self._relay_ready.pop(conversation_id, None)
        _stop(self._relays, conversation_id)

    async def publish(self, conversation_id: str, frame: dict[str, Any]) -> bool:
        try:
            await self.bus().publish_frame(conversation_id, frame)
        except BusUnavailable:
            logger.debug("Bus publish skipped for conversation %s", conversation_id, exc_info=True)
        outlet = self._outlets.get(conversation_id)
        return await outlet.deliver(frame) if outlet is not None else False

    async def attach(self, conversation_id: str, socket: WebSocket, turn_id: str, after_seq: int) -> bool:
        outlet = self.set_socket(conversation_id, socket, holding=True)
        wire = self.wire(conversation_id, turn_id)
        frames = wire.replay() if wire is not None else await self._replay_from_bus(conversation_id, turn_id)
        last = after_seq
        for frame in (frame for frame in frames if frame["seq"] > after_seq):
            await _write(socket, frame)
            last = frame["seq"]
        await _flush(outlet, turn_id, last)
        return bool(frames) or wire is not None

    async def _replay_from_bus(self, conversation_id: str, turn_id: str) -> list[dict[str, Any]]:
        ready = self._relay_ready.get(conversation_id)
        if ready is not None:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(ready.wait(), timeout=BUS_READY_TIMEOUT_S)
        try:
            return await self.bus().replay_turn(conversation_id, turn_id)
        except BusUnavailable:
            logger.warning("Could not replay turn %s of conversation %s from the bus", turn_id, conversation_id)
            return []

    async def _relay(self, conversation_id: str, ready: asyncio.Event) -> None:
        try:
            async for envelope in self.bus().subscribe_frames(conversation_id, ready):
                await self._deliver_relayed(conversation_id, envelope)
        finally:
            ready.clear()  # until the restarted loop subscribes again

    async def _deliver_relayed(self, conversation_id: str, envelope: Envelope) -> None:
        outlet = self._outlets.get(conversation_id)
        if envelope.type == FRAME and outlet is not None:
            await outlet.deliver(envelope.payload)

    def running(self, conversation_id: str, turn_id: str | None = None) -> RunningTurn | None:
        turn = self._turns.get(conversation_id)
        if turn is None or (turn_id is not None and turn.wire.turn_id != turn_id):
            return None
        return turn

    async def claim_turn(self, conversation_id: str, turn_id: str) -> bool:
        if self.running(conversation_id, turn_id) is not None:
            return False
        try:
            return await self.bus().claim_turn(conversation_id, turn_id)
        except BusUnavailable:
            logger.warning("Turn %s runs unclaimed: the bus is down", turn_id)
            return True

    def _running_elsewhere_than(self, conversation_id: str, turn_id: str) -> bool:
        turn = self._turns.get(conversation_id)
        return (
            turn is not None
            and turn.wire.turn_id != turn_id
            and not turn.wire.finished
            and (turn.task is None or not turn.task.done())
        )

    async def busy(self, conversation_id: str, turn_id: str) -> bool:
        if self._running_elsewhere_than(conversation_id, turn_id):
            return True
        if not is_multi_replica_bus():
            return False
        try:
            holder = await self.bus().running_holder(conversation_id)
        except BusUnavailable:
            return not chat_affinity_enabled()
        return holder is not None and holder.turn_id != turn_id

    async def hold_if_idle(self, conversation_id: str, turn_id: str) -> Fence | None:
        if self._running_elsewhere_than(conversation_id, turn_id):
            return None
        if not is_multi_replica_bus():
            return Fence()
        try:
            asked_at = time.monotonic()
            if await self.bus().acquire_running(conversation_id, turn_id):
                return Fence(held=True, guard=self._guard_for(conversation_id, turn_id, asked_at))
            holder = await self.bus().running_holder(conversation_id)
        except BusUnavailable:
            fence = self._fence_without_bus(conversation_id)
            return None if fence.refusal is not None else fence
        return Fence() if holder is not None and holder.turn_id == turn_id else None

    async def release_claim(self, conversation_id: str, turn_id: str) -> None:
        with contextlib.suppress(BusUnavailable):
            await self.bus().release_turn(conversation_id, turn_id)

    async def supersede_elsewhere(self, conversation_id: str, newer_turn_id: str) -> None:
        if not is_multi_replica_bus():
            return
        with contextlib.suppress(BusUnavailable):
            await self.bus().publish_input(conversation_id, SUPERSEDE, {"turn_id": newer_turn_id})

    async def hold_conversation(self, conversation_id: str, turn_id: str) -> Fence:
        if not is_multi_replica_bus():
            return Fence()
        self._supersede_local(conversation_id, turn_id)
        try:
            return await self._wait_for_marker(conversation_id, turn_id)
        except BusUnavailable:
            return self._fence_without_bus(conversation_id)

    async def _wait_for_marker(self, conversation_id: str, turn_id: str) -> Fence:
        bus = self.bus()
        loop = asyncio.get_running_loop()
        deadline = loop.time() + SUPERSEDE_WAIT_SECONDS
        next_ask = 0.0
        while True:
            if loop.time() >= next_ask:
                await self.supersede_elsewhere(conversation_id, turn_id)
                next_ask = loop.time() + SUPERSEDE_REPUBLISH_SECONDS
            asked_at = time.monotonic()  # before the command: the marker cannot expire earlier than this + TTL
            if await bus.acquire_running(conversation_id, turn_id):
                return Fence(held=True, guard=self._guard_for(conversation_id, turn_id, asked_at))
            holder = await bus.running_holder(conversation_id)
            if holder is not None and holder.turn_id == turn_id:
                return Fence()  # a resend of the turn that holds it: the claim decides what it is
            if holder is not None and loop.time() >= deadline:
                logger.warning("Conversation %s still runs turn %s; refusing %s", conversation_id, holder, turn_id)
                return Fence(refusal=PREVIOUS_TURN_REFUSAL)
            if holder is not None:
                await asyncio.sleep(SUPERSEDE_POLL_SECONDS)

    @staticmethod
    def _guard_for(conversation_id: str, turn_id: str, acquired_at: float) -> TurnFence | None:
        if chat_affinity_enabled():
            return None
        return TurnFence(
            acquired_at=acquired_at, ttl=running_ttl(), label=f"{turn_id} of conversation {conversation_id}"
        )

    def _fence_without_bus(self, conversation_id: str) -> Fence:
        if chat_affinity_enabled():
            logger.warning("Conversation %s runs unfenced: the bus is down", conversation_id)
            return Fence()
        return Fence(refusal=FENCE_UNAVAILABLE_REFUSAL)

    async def keep_conversation(self, turn: RunningTurn) -> None:
        conversation_id, turn_id = turn.wire.conversation_id, turn.wire.turn_id
        guard = turn.guard
        retrying = False
        while True:
            await asyncio.sleep(_renew_wait(guard, retrying=retrying))
            if guard is not None and guard.fenced():
                self._fence_turn(turn, "no renewal got through before its deadline")
                return
            sent_at = time.monotonic()  # before the command, as the deadline is measured from the send
            try:
                renewed = await self.bus().renew_running(conversation_id, turn_id)
            except BusUnavailable:
                retrying = True  # sooner than an interval: a blip that ends before the deadline is ridden out
                continue
            retrying = False
            if renewed:
                if guard is not None:
                    guard.renewed(sent_at)
                continue
            logger.warning("Turn %s lost the running marker of conversation %s", turn_id, conversation_id)
            if guard is not None:
                self._fence_turn(turn, "its running marker is gone")
            return

    @staticmethod
    def _fence_turn(turn: RunningTurn, reason: str) -> None:
        if turn.guard is not None:
            turn.guard.trip(reason)
        if turn.task is not None and not turn.task.done():
            turn.task.cancel()

    async def release_conversation(self, conversation_id: str, turn_id: str) -> None:
        try:
            await self.bus().release_running(conversation_id, turn_id)
        except BusUnavailable:
            logger.debug("Could not release the running marker of conversation %s", conversation_id)

    async def drain(self, timeout: float) -> int:
        running = [turn.task for turn in list(self._turns.values()) if turn.task is not None and not turn.task.done()]
        pending: set[asyncio.Task[None]] = set()
        if running:
            logger.info("Draining %d chat turn(s), up to %.0fs", len(running), timeout)
            _, pending = await asyncio.wait(running, timeout=timeout)
        for task in pending:
            task.cancel()
        if pending:
            logger.warning("Cancelling %d chat turn(s) still running after the drain", len(pending))
            await asyncio.wait(pending, timeout=drain_cancel_grace())
        await drain_after_terminal()
        return len(pending)

    def _supersede_local(self, conversation_id: str, newer_turn_id: str) -> None:
        stale = self._turns.get(conversation_id)
        if stale is None or stale.wire.turn_id == newer_turn_id or stale.task is None or stale.task.done():
            return
        logger.info("Superseding turn %s in conversation %s", stale.wire.turn_id, conversation_id)
        stale.task.cancel()

    def start_turn(self, turn: RunningTurn) -> None:
        conversation_id = turn.wire.conversation_id
        self._supersede_local(conversation_id, turn.wire.turn_id)
        self._turns[conversation_id] = turn
        if is_multi_replica_bus():
            owner_input = _supervise("owner input", conversation_id, lambda: self._owner_input(conversation_id))
            _restart(self._inputs, conversation_id, owner_input)

    def finish_turn(self, turn: RunningTurn) -> None:
        conversation_id = turn.wire.conversation_id
        if self._turns.get(conversation_id) is turn:
            del self._turns[conversation_id]
            _stop(self._inputs, conversation_id)
        now = time.monotonic()
        self._finished = {key: entry for key, entry in self._finished.items() if entry[1] > now}
        self._finished[(conversation_id, turn.wire.turn_id)] = (turn.wire, now + STAGE_WIRE_TTL_S)

    def wire(self, conversation_id: str, turn_id: str) -> TurnWire | None:
        turn = self.running(conversation_id, turn_id)
        if turn is not None:
            return turn.wire
        wire, expires = self._finished.get((conversation_id, turn_id), (None, 0.0))
        return wire if expires > time.monotonic() else None

    async def send_stage(self, conversation_id: str, turn_id: str, value: StageValue) -> bool:
        wire = self.wire(conversation_id, turn_id)
        if wire is None:
            return False
        return await wire.send(StageBody(value=value))

    async def _owner_input(self, conversation_id: str) -> None:
        async for envelope in self.bus().subscribe_input(conversation_id):
            if envelope.type == STEER:
                await self.relayed_steer(envelope.payload)
            else:
                self._take_input(conversation_id, envelope)

    def _take_input(self, conversation_id: str, envelope: Envelope) -> None:
        if envelope.type in {HITL_ANSWER, CANCEL}:
            self.relayed(envelope.payload)
        elif envelope.type == SUPERSEDE and envelope.origin != self.bus().replica_id:
            self._supersede_local(conversation_id, str((envelope.payload or {}).get("turn_id")))

    async def relayed_steer(self, payload: dict[str, Any]) -> None:
        try:
            message = CLIENT_MESSAGE.validate_python(payload["message"])
        except ValidationError, KeyError:
            logger.warning("Dropping a malformed relayed steer", exc_info=True)
            return
        turn = self.running(message.conversation_id, getattr(message, "turn_id", None))
        if turn is None or not isinstance(message, Steer):
            return
        author = payload.get("author") if isinstance(payload.get("author"), str) else None
        refusal = await turn.steer(
            message, subject=payload.get("subject"), internal=bool(payload.get("internal")), author=author
        )
        if refusal is not None:
            logger.warning("Refused a relayed steer for turn %s: %s", message.turn_id, refusal)

    def relayed(self, payload: dict[str, Any]) -> None:
        try:
            message = CLIENT_MESSAGE.validate_python(payload["message"])
        except ValidationError, KeyError:
            logger.warning("Dropping a malformed relayed message", exc_info=True)
            return
        subject, internal = payload.get("subject"), bool(payload.get("internal"))
        turn = self.running(message.conversation_id, message.turn_id)
        if turn is None or not isinstance(message, InteractionResponse | CancelTurn):
            return
        refusal = (
            turn.cancel(subject=subject, internal=internal, shown=_relayed_shown(payload))
            if isinstance(message, CancelTurn)
            else turn.answer(message, subject=subject, internal=internal)
        )
        if refusal is not None:
            logger.warning("Refused a relayed %s for turn %s: %s", message.type, message.turn_id, refusal)


def _relayed_shown(payload: dict[str, Any]) -> ShownAnswer | None:
    try:
        return ShownAnswer.model_validate(payload["shown"]) if payload.get("shown") is not None else None
    except ValidationError:
        logger.warning("Dropping a malformed shown position from a relayed Stop", exc_info=True)
        return None


RENEW_RETRY_SECONDS = 1.0


def _renew_wait(guard: TurnFence | None, *, retrying: bool = False) -> float:
    interval = running_renew_interval()
    if retrying:
        interval = min(interval, RENEW_RETRY_SECONDS)
    return interval if guard is None else min(interval, guard.remaining())


async def _flush(outlet: _Outlet, turn_id: str, last: int) -> None:
    while outlet.held:
        frame = outlet.held.pop(0)
        if frame.get("turn_id") != turn_id or frame["seq"] > last:
            await _write(outlet.socket, frame)
    outlet.held = None


def _log_unexpected_end(task: asyncio.Task[Any]) -> None:
    if task.cancelled() or task.exception() is None:
        return
    logger.error("Task %s ended with an unexpected error", task.get_name(), exc_info=task.exception())


async def _supervise(what: str, conversation_id: str, loop: Callable[[], Awaitable[None]]) -> None:
    delay = _LOOP_RESTART_MIN_S
    while True:
        started = time.monotonic()
        await _run_loop_once(what, conversation_id, loop)
        if time.monotonic() - started > _LOOP_RESTART_MAX_S:
            delay = _LOOP_RESTART_MIN_S  # it ran healthy for a while: a new outage starts the backoff over
        await asyncio.sleep(delay)
        delay = min(delay * 2, _LOOP_RESTART_MAX_S)


async def _run_loop_once(what: str, conversation_id: str, loop: Callable[[], Awaitable[None]]) -> None:
    try:
        await loop()
    except Exception:
        logger.warning("The %s loop of conversation %s failed; restarting it", what, conversation_id, exc_info=True)
        return
    logger.warning("The %s loop of conversation %s ended; restarting it", what, conversation_id)


def _restart(tasks: dict[str, asyncio.Task[None]], key: str, loop: Awaitable[None]) -> None:
    _stop(tasks, key)
    task = tasks[key] = asyncio.ensure_future(loop)
    task.add_done_callback(_log_unexpected_end)


def _stop(tasks: dict[str, asyncio.Task[None]], key: str) -> None:
    task = tasks.pop(key, None)
    if task is not None and not task.done():
        task.cancel()


_registry = ChatRegistry()


async def drain_chat_turns(timeout: float | None = None) -> int:
    return await _registry.drain(DRAIN_SECONDS if timeout is None else timeout)


async def send_stage(conversation_id: str, turn_id: str, value: StageValue) -> bool:
    return await _registry.send_stage(conversation_id, turn_id, value)


async def _beat(wire: TurnWire) -> None:
    body = HeartbeatBody(value=HeartbeatValue(every_ms=int(TURN_HEARTBEAT_SECONDS * 1000)))
    while True:
        await asyncio.sleep(TURN_HEARTBEAT_SECONDS)
        await wire.send(body)


async def _relay_workflow(turn: RunningTurn, request: UserMessage, session: Any) -> None:
    tools_called: dict[str, str] = {}
    literal_searches: set[str] = set()
    async with contextlib.aclosing(stream_workflow(request, session=session)) as bodies:
        async for body in bodies:
            if (tool := tool_called_by(body)) is not None:
                tools_called[body.step.id] = tool
            elif is_literal_search(getattr(body, "step", None)):
                literal_searches.add(body.step.id)
            if isinstance(body, RunFinishedBody):
                record_turn_finished(body)
                if body.outcome == "answered":
                    emit_scores(turn_outcome_scores(body.result), writer="chat")
                emit_scores(file_tool_scores(tools_called.values(), len(literal_searches)), writer="chat")
                if turn.inbox.received:
                    emit_scores(steer_scores(turn.inbox), writer="chat")
            elif isinstance(body, RunErrorBody):
                record_turn_error(body.code, body.details or body.message)
                answer_failure.report_turn_failed(
                    turn, answer_failure.reason_for_text(body.details or body.message), body.code
                )
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
    tags = build_request_trace_tags(headers, socket.scope, caller, external_hostnames=_external_hostnames)
    outcome = begin_turn_outcome()
    contributions = begin_trace_contributions()
    record_posthog_session(request.posthog_session_id)
    record_turn_surface(turn_surface(request.focus_region, reply_in_thread=thread_reply_requested(request)))
    record_turn_trigger(request.trigger)
    steering = bind_steer_inbox(turn.inbox)
    thread = bind_thread_reply(turn.thread_reply)
    try:
        with pinned_trace(trace_id_for_message(turn.message_id)), user_context(caller), request_trace_tag_context(tags):
            async with session_manager.session(
                user_id=trace_user_id(turn, caller),
                user_message_id=request.message_id,
                conversation_id=request.conversation_id,
                http_connection=socket,
                user_input_callback=turn.ask,
            ) as session:
                await _relay_workflow(turn, request, session)
    except Exception as exc:
        record_turn_error(_error_for(exc).code, str(exc))
        raise
    finally:
        reset_thread_reply(thread)
        unbind_steer_inbox(steering)
        end_trace_contributions(contributions)
        end_turn_outcome(outcome)


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
        for background in (heartbeat, keeper):
            if background is not None:
                background.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await background
        await _ensure_terminal(turn)
        turn.after_terminal()
        registry.finish_turn(turn)
        if turn.guard is not None:
            turn.guard.release()  # it ended on its own: the stage frames and the persist behind it are not fenced
        if turn.holds_marker:
            await registry.release_conversation(turn.wire.conversation_id, turn.wire.turn_id)


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


def _relayable(message: InteractionResponse | CancelTurn | Steer) -> dict[str, Any]:
    return message.model_dump(mode="json", exclude={"shown"} if isinstance(message, CancelTurn) else None)


def _client_type(raw: object) -> str | None:
    kind = raw.get("type") if isinstance(raw, dict) else None
    return kind if kind in {"user_message", "interaction_response", "cancel_turn", "attach", "steer"} else None


class ChatSocket:
    def __init__(self, socket: WebSocket, session_manager: SessionManager, registry: ChatRegistry) -> None:
        self.socket = socket
        self.session_manager = session_manager
        self.registry = registry
        self.caller: dict[str, Any] = {}
        envelope = _handshake_envelope(socket.scope)
        self.envelope_present = envelope is not None
        self.bound = envelope.conversation_id if envelope is not None else None
        self.signed_org_id = envelope.organization_id if envelope is not None else None
        self.signed_user_id = envelope.user_id if envelope is not None else None
        self.signed = (
            SignedEnvelope(header=envelope.envelope_header, signature=envelope.envelope_signature)
            if envelope is not None and envelope.envelope_header and envelope.envelope_signature
            else None
        )
        self.screening: ChatScreening | None = None

    @property
    def subject(self) -> str | None:
        return verified_subject(self.caller)

    @property
    def internal(self) -> bool:
        return self.caller.get("type") == "internal"

    async def serve(self) -> None:
        await self.socket.accept()
        if self.socket.query_params.get("v") != str(WIRE_VERSION):
            await self.socket.close(code=CLOSE_CLIENT_OUTDATED)
            return
        user, close_code = await authenticate_websocket_connection(self.socket)
        if user is None:
            await self.socket.close(code=close_code or WS_POLICY_VIOLATION)
            return
        self.caller = user
        try:
            hello = HelloValue(build=deployed_sha(), accepts=list(ACCEPTED_CLIENT_FIELDS))
            await self.socket.send_json(for_open_tabs(to_frame(Hello(ts=_now_ms(), value=hello))))
            await self._serve_messages()
        except WebSocketDisconnect:
            logger.debug("Chat socket closed for conversation %s", self.bound)
        finally:
            self.registry.clear_socket(self.bound, self.socket)

    async def _serve_messages(self) -> None:
        while True:
            try:
                raw = await self.socket.receive_json()
            except ValueError:
                await self._reject(None, "unknown", "invalid_message", "Not a JSON message.")
                continue
            await self._receive(raw)

    async def _receive(self, raw: object) -> None:
        kind = _client_type(raw)
        if kind is None:
            await self._reject(raw, "unknown", "invalid_message", "Unknown message type.")
            return
        try:
            message = CLIENT_MESSAGE.validate_python(raw)
        except ValidationError:
            await self._reject(raw, kind, "invalid_message")
            return
        if token_expired(self.caller):
            await self._reject(raw, kind, "auth_expired")
            return
        if not self._admit(message.conversation_id):
            await self._reject(raw, kind, "conversation_mismatch")
            return
        handlers = {
            UserMessage: self.on_user_message,
            InteractionResponse: self.on_interaction_response,
            CancelTurn: self.on_cancel,
            Attach: self.on_attach,
            Steer: self.on_steer,
        }
        await handlers[type(message)](message)

    def _admit(self, conversation_id: str) -> bool:
        if self.bound is None and not self.envelope_present:
            self.bound = conversation_id
        return conversation_id == self.bound

    async def _reject(self, raw: object, of: str, code: str, message: str | None = None) -> None:
        fields = raw if isinstance(raw, dict) else {}
        body = RejectedBody(value=RejectedValue(of=of, code=code, message=message))
        event = stamp(
            body,
            conversation_id=str(fields.get("conversation_id") or self.bound or "unknown"),
            turn_id=str(fields.get("turn_id") or fields.get("message_id") or "unknown"),
            seq=0,
            ts=_now_ms(),
        )
        logger.info("Rejected %s on conversation %s: %s", of, self.bound, code)
        with contextlib.suppress(Exception):
            await self.socket.send_json(to_frame(event))

    async def on_user_message(self, message: UserMessage) -> None:
        update = {"text": await self._masked(message.text, message)}
        if message.focus_file_name:
            update["focus_file_name"] = await self._masked(message.focus_file_name, message)
        if any(getattr(message, field) != value for field, value in update.items()):
            message = message.model_copy(update=update)
        if message.context_only:
            await self._ingest(message)
            return
        conversation_id = message.conversation_id
        if message.if_idle and await self.registry.busy(conversation_id, message.message_id):
            await self._reject(message.model_dump(), "user_message", "busy", BUSY_REFUSAL)
            return
        if not await self.registry.claim_turn(conversation_id, message.message_id):
            await self._reject(message.model_dump(), "user_message", "duplicate_turn")
            return
        fence = await self._hold(message)
        if fence is None:
            await self.registry.release_claim(conversation_id, message.message_id)
            await self._reject(message.model_dump(), "user_message", "busy", BUSY_REFUSAL)
            return
        self.registry.set_socket(conversation_id, self.socket)
        wire = TurnWire(conversation_id, message.message_id, self.registry.publish, fence.guard)
        turn = RunningTurn(
            wire=wire,
            asker_subject=self.subject,
            organization_id=_org_id_from_scope(self.socket.scope),
            holds_marker=fence.held,
            guard=fence.guard,
            reasoning_effort=message.reasoning_effort,
            headless=bool(self.caller.get("headless")),
            thread_reply=ThreadReply.requested_by(message),
            envelope=self.signed,
            envelope_user_id=self.signed_user_id,
        )
        await wire.send(RunStartedBody(message_id=turn.message_id))
        if fence.refusal is not None:
            await self._refuse(turn, fence.refusal)
            return
        turn.task = asyncio.create_task(
            run_turn(
                turn,
                message,
                registry=self.registry,
                session_manager=self.session_manager,
                socket=self.socket,
                caller=self.caller,
            ),
            name=f"chat turn {message.message_id} of {conversation_id}",
        )
        turn.task.add_done_callback(_log_unexpected_end)
        self.registry.start_turn(turn)

    async def _hold(self, message: UserMessage) -> Fence | None:
        if message.if_idle:
            return await self.registry.hold_if_idle(message.conversation_id, message.message_id)
        return await self.registry.hold_conversation(message.conversation_id, message.message_id)

    async def _refuse(self, turn: RunningTurn, text: str) -> None:
        refusal = TurnRefusal(text, retry_after_seconds=REFUSAL_RETRY_AFTER_SECONDS)
        await turn.finish(refused(refusal, message_id=turn.message_id))
        turn.after_terminal()
        self.registry.finish_turn(turn)

    async def _screening_rules(self) -> ScreeningRules | None:
        if self.screening is not None:
            return self.screening.rules
        screening = await chat_screening_for(self.signed_org_id)
        if screening.from_office:
            self.screening = screening
        return screening.rules

    async def _masked(self, text: str, message: UserMessage | InteractionResponse | Steer) -> str:
        masked = mask_text(text, await self._screening_rules())
        if masked.masked:
            logger.info(
                "Masked %s in a %s of conversation %s",
                findings_summary(masked.findings),
                message.type,
                message.conversation_id,
            )
        return masked.text

    async def on_interaction_response(self, message: InteractionResponse) -> None:
        if isinstance(message.answer, TextAnswer):
            text = await self._masked(message.answer.text, message)
            if text != message.answer.text:
                message = message.model_copy(update={"answer": TextAnswer(text=text)})
        self.registry.set_socket(message.conversation_id, self.socket)
        turn = self.registry.running(message.conversation_id, message.turn_id)
        if turn is None:
            await self._to_owner(HITL_ANSWER, message)
            return
        refusal = turn.answer(message, subject=self.subject, internal=self.internal)
        if refusal is not None:
            await self._reject(message.model_dump(), "interaction_response", refusal)

    async def on_cancel(self, message: CancelTurn) -> None:
        turn = self.registry.running(message.conversation_id, message.turn_id)
        if turn is None:
            await self._to_owner(CANCEL, message)
            return
        refusal = turn.cancel(subject=self.subject, internal=self.internal, shown=message.shown)
        if refusal is not None:
            await self._reject(
                message.model_dump(), "cancel_turn", refusal, "Only the person who asked can stop this turn."
            )

    async def on_steer(self, message: Steer) -> None:
        text = await self._masked(message.text, message)
        if text != message.text:
            message = message.model_copy(update={"text": text})
        turn = self.registry.running(message.conversation_id, message.turn_id)
        if turn is None:
            await self._to_owner(STEER, message)
            return
        refusal = await turn.steer(
            message, subject=self.subject, internal=self.internal, author=verified_display_name(self.caller)
        )
        if refusal is not None:
            await self._reject(message.model_dump(), "steer", refusal)
            return
        self.registry.set_socket(message.conversation_id, self.socket)

    async def on_attach(self, message: Attach) -> None:
        known = await self.registry.attach(message.conversation_id, self.socket, message.turn_id, message.after_seq)
        if not known:
            await self._reject(message.model_dump(), "attach", "turn_not_found")

    async def _to_owner(self, input_type: str, message: InteractionResponse | CancelTurn | Steer) -> None:
        of = message.type
        if not is_multi_replica_bus():
            await self._reject(message.model_dump(), of, "turn_not_found")
            return
        payload = {"message": _relayable(message), "subject": self.subject, "internal": self.internal}
        if isinstance(message, Steer):
            payload["author"] = verified_display_name(self.caller)
        if isinstance(message, CancelTurn) and message.shown is not None:
            payload["shown"] = message.shown.model_dump(mode="json")
        try:
            await self.registry.bus().publish_input(message.conversation_id, input_type, payload)
        except BusUnavailable:
            unreachable = "The replica running this turn cannot be reached right now."
            await self._reject(message.model_dump(), of, "turn_not_found", unreachable)

    async def _ingest(self, message: UserMessage) -> None:
        line = ContextOnlyMessage(text=message.text, author=message.author_name)
        text = format_context_turn(line, author=verified_display_name(self.caller))
        with user_context(self.caller):
            stored = await append_conversation_context(message.conversation_id, text)
        if not stored:
            logger.warning("Ingest-only message not stored for conversation %s", message.conversation_id)


def chat_socket_endpoint(
    session_manager: SessionManager, registry: ChatRegistry = _registry
) -> Callable[[WebSocket], Awaitable[None]]:

    async def _chat_socket(websocket: WebSocket) -> None:
        await ChatSocket(websocket, session_manager, registry).serve()

    return _chat_socket
