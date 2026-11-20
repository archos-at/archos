from __future__ import annotations

import asyncio
import logging
import os
import time
from collections.abc import Awaitable
from collections.abc import Callable
from typing import Any

from agent.common.wire_v2 import EventBody
from agent.common.wire_v2 import RunErrorBody
from agent.common.wire_v2 import RunFinishedBody
from agent.common.wire_v2 import StageBody
from agent.common.wire_v2 import stamp
from agent.common.wire_v2 import to_frame
from agent.common.write_fence import WriteFence
from agent_host.turn_record import TurnFrames

logger = logging.getLogger(__name__)

LOCAL_REPLAY_FRAMES = 2000

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
                await self._release_held_stages()
            return delivered

    async def _release_held_stages(self) -> None:
        for stage in self._held_stages:
            await self._stamp_and_publish(stage)
        self._held_stages.clear()

    async def _stamp_and_publish(self, body: EventBody) -> bool:
        self.seq += 1
        if self.on_stamp is not None:
            self.on_stamp(body, self.seq)
        event = stamp(body, conversation_id=self.conversation_id, turn_id=self.turn_id, seq=self.seq, ts=_now_ms())
        frame = for_open_tabs(to_frame(event))
        self._frames.append(frame)
        return await self._publish(self.conversation_id, frame)
