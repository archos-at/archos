from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import time
from typing import Any

from fastapi import WebSocket
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect

from agent.common.wire_v2 import CLIENT_MESSAGE
from agent.common.wire_v2 import CancelTurn
from agent.common.wire_v2 import InteractionResponse
from agent.common.wire_v2 import ShownAnswer
from agent.common.wire_v2 import StageBody
from agent.common.wire_v2 import StageValue
from agent.common.wire_v2 import Steer
from agent_host.after_terminal_writes import drain_after_terminal
from agent_host.after_terminal_writes import drain_cancel_grace
from agent_host.chat_fencing import ConversationFencing
from agent_host.chat_fencing import chat_affinity_enabled
from agent_host.chat_loops import _restart
from agent_host.chat_loops import _stop
from agent_host.chat_loops import _supervise
from agent_host.chat_turn import RunningTurn
from agent_host.chat_wire import TurnWire
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

logger = logging.getLogger(__name__)

STAGE_WIRE_TTL_S = 600.0

DRAIN_SECONDS = float(os.getenv("CHAT_DRAIN_SECONDS", "2700") or "2700")

BUS_READY_TIMEOUT_S = 1.0


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


class ChatRegistry(ConversationFencing):
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

    async def release_claim(self, conversation_id: str, turn_id: str) -> None:
        with contextlib.suppress(BusUnavailable):
            await self.bus().release_turn(conversation_id, turn_id)

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


async def _flush(outlet: _Outlet, turn_id: str, last: int) -> None:
    while outlet.held:
        frame = outlet.held.pop(0)
        if frame.get("turn_id") != turn_id or frame["seq"] > last:
            await _write(outlet.socket, frame)
    outlet.held = None


_registry = ChatRegistry()


async def drain_chat_turns(timeout: float | None = None) -> int:
    return await _registry.drain(DRAIN_SECONDS if timeout is None else timeout)


async def send_stage(conversation_id: str, turn_id: str, value: StageValue) -> bool:
    return await _registry.send_stage(conversation_id, turn_id, value)
