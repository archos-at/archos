from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import time
from dataclasses import dataclass

from agent_host.chat_turn import RunningTurn
from agent_host.conversation_bus import SUPERSEDE
from agent_host.conversation_bus import BusUnavailable
from agent_host.conversation_bus import is_multi_replica_bus
from agent_host.conversation_bus import running_renew_interval
from agent_host.conversation_bus import running_ttl
from agent_host.turn_fence import TurnFence
from agent_host.turn_fence import validate_running_ttl

logger = logging.getLogger(__name__)

SUPERSEDE_WAIT_SECONDS = float(os.getenv("CHAT_SUPERSEDE_WAIT_SECONDS", "13.5") or "13.5")

SUPERSEDE_POLL_SECONDS = 0.2
SUPERSEDE_REPUBLISH_SECONDS = 2.0

PREVIOUS_TURN_REFUSAL = (
    "The assistant is still finishing the previous answer. Please send your message again in a moment."
)
FENCE_UNAVAILABLE_REFUSAL = (
    "The assistant cannot start a new answer right now. Please send your message again in a moment."
)


def chat_affinity_enabled() -> bool:
    return os.getenv("CHAT_AFFINITY", "1").strip().lower() not in ("0", "false", "no", "off", "")


if not chat_affinity_enabled():
    validate_running_ttl(running_ttl())


RENEW_RETRY_SECONDS = 1.0


def _renew_wait(guard: TurnFence | None, *, retrying: bool = False) -> float:
    interval = running_renew_interval()
    if retrying:
        interval = min(interval, RENEW_RETRY_SECONDS)
    return interval if guard is None else min(interval, guard.remaining())


@dataclass(frozen=True)
class Fence:
    held: bool = False
    refusal: str | None = None
    guard: TurnFence | None = None


class ConversationFencing:
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
        guard = turn.guard
        retrying = False
        while True:
            await asyncio.sleep(_renew_wait(guard, retrying=retrying))
            if guard is not None and guard.fenced():
                self._fence_turn(turn, "no renewal got through before its deadline")
                return
            renewed = await self._renew(turn)
            retrying = renewed is None  # sooner than an interval: a blip that ends before the deadline is ridden out
            if renewed is None or renewed:
                continue
            logger.warning(
                "Turn %s lost the running marker of conversation %s", turn.wire.turn_id, turn.wire.conversation_id
            )
            if guard is not None:
                self._fence_turn(turn, "its running marker is gone")
            return

    async def _renew(self, turn: RunningTurn) -> bool | None:
        sent_at = time.monotonic()  # before the command, as the deadline is measured from the send
        try:
            renewed = await self.bus().renew_running(turn.wire.conversation_id, turn.wire.turn_id)
        except BusUnavailable:
            return None
        if renewed and turn.guard is not None:
            turn.guard.renewed(sent_at)
        return renewed

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
