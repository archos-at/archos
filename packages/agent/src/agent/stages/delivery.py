from __future__ import annotations

import logging
from collections.abc import Awaitable
from collections.abc import Callable

from agent.common.wire_v2 import StageValue

logger = logging.getLogger(__name__)

StageFrameSink = Callable[[str, str, StageValue], Awaitable[bool]]

_sink: StageFrameSink | None = None


def register_stage_frame_sink(sink: StageFrameSink | None) -> None:
    global _sink
    _sink = sink


def get_stage_frame_sink() -> StageFrameSink | None:
    return _sink


async def deliver_stage_frame(conversation_id: str | None, turn_id: str | None, value: StageValue) -> bool:
    sink = _sink
    if sink is None or not conversation_id or not turn_id:
        return False
    try:
        return bool(await sink(conversation_id, turn_id, value))
    except Exception:
        logger.warning("Stage delivery failed for conversation %s", conversation_id, exc_info=True)
        return False
