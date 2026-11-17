from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable
from typing import Any

from agent_host import workflow_stream

logger = logging.getLogger(__name__)

PERSIST_TASKS: set[asyncio.Task[Any]] = set()

DRAIN_AFTER_TERMINAL_SECONDS = 30.0

DRAIN_CANCEL_MARGIN_SECONDS = 5.0


def drain_cancel_grace() -> float:
    return workflow_stream.PRODUCER_TEARDOWN_SECONDS + DRAIN_CANCEL_MARGIN_SECONDS


def in_background(work: Awaitable[Any]) -> asyncio.Task[Any]:
    task = asyncio.ensure_future(work)
    PERSIST_TASKS.add(task)
    task.add_done_callback(PERSIST_TASKS.discard)
    return task


async def drain_after_terminal(timeout: float = DRAIN_AFTER_TERMINAL_SECONDS) -> None:
    writes = [task for task in PERSIST_TASKS if not task.done()]
    if not writes:
        return
    logger.info("Waiting for %d write(s) after the terminal, up to %.0fs", len(writes), timeout)
    _, late = await asyncio.wait(writes, timeout=timeout)
    if late:
        logger.warning("%d write(s) after the terminal did not land before the drain ended", len(late))
