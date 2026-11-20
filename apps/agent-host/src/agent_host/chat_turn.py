from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import time
from collections.abc import AsyncIterator
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
from typing import Any

from agent.common.human_prompt import human_response
from agent.common.human_prompt import interaction_request
from agent.common.licensed_text import LICENSED_TRACE_TAG
from agent.common.steering import SteerInbox
from agent.common.steering import SteerNote
from agent.common.wire_v2 import EventBody
from agent.common.wire_v2 import InteractionRequestBody
from agent.common.wire_v2 import InteractionResolvedBody
from agent.common.wire_v2 import InteractionResolvedValue
from agent.common.wire_v2 import InteractionResponse
from agent.common.wire_v2 import RunErrorBody
from agent.common.wire_v2 import RunFinishedBody
from agent.common.wire_v2 import ShownAnswer
from agent.common.wire_v2 import Steer
from agent.common.wire_v2 import SteerReceivedBody
from agent.common.wire_v2 import SteerReceivedValue
from agent.common.wire_v2 import TurnResult
from agent.common.write_fence import TurnFenced
from agent.common.write_fence import WriteFence
from agent.common.write_fence import check_write
from agent.observability import answer_finished
from agent.observability.turn_outcome import turn_tagged
from agent.tools.documents.filing import SignedEnvelope
from agent.turn.annotation_reply import ThreadReply
from agent.turn.annotation_reply import post_fallback_reply
from agent.turn.response import answer_message_id
from agent.turn.streaming import TurnTextFold
from agent_host.after_terminal_writes import in_background
from agent_host.chat_wire import TurnWire
from agent_host.chat_wire import _now_ms
from agent_host.internal_api import post_internal_conversation_message
from agent_host.internal_api import post_internal_turn_outcome
from agent_host.internal_api import post_internal_turn_steps
from agent_host.socket_identity import may_act_for
from agent_host.turn_fence import TurnFence
from agent_host.turn_outcome_notice import turn_outcome_report
from agent_host.turn_record import turn_row_metadata
from nat.plugin_api import HumanResponse
from nat.plugin_api import InteractionPrompt

logger = logging.getLogger(__name__)

HITL_RESPONSE_TIMEOUT_SECONDS = float(os.getenv("HITL_RESPONSE_TIMEOUT_SECONDS", "1800"))

TURN_DEADLINE_SECONDS = float(os.getenv("CHAT_TURN_DEADLINE_SECONDS", "2700"))


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
    origin: answer_finished.TurnOrigin = answer_finished.TYPED_IN_CHAT
    started_at: float = field(default_factory=time.monotonic)
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
        answer_finished.report_turn_finished(self)
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
