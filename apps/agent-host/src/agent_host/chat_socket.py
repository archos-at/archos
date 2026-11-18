from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable
from collections.abc import Callable
from typing import TYPE_CHECKING
from typing import Any

from fastapi import WebSocket
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect

from agent.common.content_screen import ScreeningRules
from agent.common.content_screen import findings_summary
from agent.common.content_screen import mask_text
from agent.common.wire_v2 import ACCEPTED_CLIENT_FIELDS
from agent.common.wire_v2 import CLIENT_MESSAGE
from agent.common.wire_v2 import CLOSE_CLIENT_OUTDATED
from agent.common.wire_v2 import WIRE_VERSION
from agent.common.wire_v2 import Attach
from agent.common.wire_v2 import CancelTurn
from agent.common.wire_v2 import Hello
from agent.common.wire_v2 import HelloValue
from agent.common.wire_v2 import InteractionResponse
from agent.common.wire_v2 import RejectedBody
from agent.common.wire_v2 import RejectedValue
from agent.common.wire_v2 import RunStartedBody
from agent.common.wire_v2 import Steer
from agent.common.wire_v2 import TextAnswer
from agent.common.wire_v2 import UserMessage
from agent.common.wire_v2 import stamp
from agent.common.wire_v2 import to_frame
from agent.conversation_context import ContextOnlyMessage
from agent.conversation_context import append_conversation_context
from agent.conversation_context import format_context_turn
from agent.observability import answer_finished
from agent.tools.documents.filing import SignedEnvelope
from agent.turn.admission import TurnRefusal
from agent.turn.admission import refused
from agent.turn.annotation_reply import ThreadReply
from agent_host.auth.middleware import user_context
from agent_host.chat_auth import WS_POLICY_VIOLATION
from agent_host.chat_auth import _handshake_envelope
from agent_host.chat_auth import _org_id_from_scope
from agent_host.chat_auth import authenticate_websocket_connection
from agent_host.chat_fencing import Fence
from agent_host.chat_loops import _log_unexpected_end
from agent_host.chat_registry import ChatRegistry
from agent_host.chat_registry import _registry
from agent_host.chat_run import run_turn
from agent_host.chat_turn import RunningTurn
from agent_host.chat_wire import TurnWire
from agent_host.chat_wire import _now_ms
from agent_host.chat_wire import for_open_tabs
from agent_host.conversation_bus import CANCEL
from agent_host.conversation_bus import HITL_ANSWER
from agent_host.conversation_bus import STEER
from agent_host.conversation_bus import BusUnavailable
from agent_host.conversation_bus import is_multi_replica_bus
from agent_host.internal_api import ChatScreening
from agent_host.internal_api import chat_screening_for
from agent_host.socket_identity import token_expired
from agent_host.socket_identity import verified_display_name
from agent_host.socket_identity import verified_subject
from agent_host.startup_banner import deployed_sha

if TYPE_CHECKING:
    from nat.runtime.session import SessionManager

logger = logging.getLogger(__name__)

REFUSAL_RETRY_AFTER_SECONDS = 5

BUSY_REFUSAL = "The conversation is running another turn; ask again once it has finished."

_NOT_ASKER_STOP = "Only the person who asked can stop this turn."


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
        headless = bool(self.caller.get("headless"))
        turn = RunningTurn(
            wire=wire,
            asker_subject=self.subject,
            organization_id=_org_id_from_scope(self.socket.scope),
            holds_marker=fence.held,
            guard=fence.guard,
            reasoning_effort=message.reasoning_effort,
            headless=headless,
            thread_reply=ThreadReply.requested_by(message),
            envelope=self.signed,
            envelope_user_id=self.signed_user_id,
            origin=answer_finished.origin_of(message.trigger, self.socket.scope["headers"], headless=headless),
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
