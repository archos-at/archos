"""The writes a chat turn makes after its terminal, and the drain that lets them land.

A turn's terminal goes out first; its answer row and, for a headless caller,
the outcome notice (``POST /api/internal/turns/outcome``) are posted behind it,
off the frame's path (``chat_socket._after_terminal``). They are tasks of their
own, held here so the loop keeps them and a draining replica can wait for them:
without that wait the process exits under them, and an ask or a wake whose turn
ended in the drain reads ``working`` until the BFF's own bound ends it.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable
from typing import Any

from agent_host import workflow_stream

logger = logging.getLogger(__name__)

#: Background writes after a terminal still in flight: the answer row and what
#: follows it. The loop holds only weak references.
PERSIST_TASKS: set[asyncio.Task[Any]] = set()

#: How long a drain waits, after its turns ended, for those writes: the outcome
#: notice's retries (``internal_retry``). Inside the pod's slack
#: (``BACKEND_DRAIN_SLACK_SECONDS``, 60) together with the cancel grace (15 s).
DRAIN_AFTER_TERMINAL_SECONDS = 30.0

#: How much longer than the workflow's teardown bound a drain waits for the turns it cancelled.
DRAIN_CANCEL_MARGIN_SECONDS = 5.0


def drain_cancel_grace() -> float:
    """How long a drain waits for the turns it cancelled to reach their terminal (``ChatRegistry.drain``).

    Longer than the workflow's teardown bound (``workflow_stream.PRODUCER_TEARDOWN_SECONDS``),
    because a cancelled turn sends its terminal, and starts the writes behind it, only once that
    teardown has ended or run out its bound. It was a flat 10 s, the bound itself, so a turn whose
    teardown ran out reached its terminal just after the drain stopped waiting: its writes were not
    started yet, :func:`drain_after_terminal` found none, the process exited, and the ask it served
    read ``working`` until a read ended it after 47 minutes (dev, 2026-11-12).
    """
    return workflow_stream.PRODUCER_TEARDOWN_SECONDS + DRAIN_CANCEL_MARGIN_SECONDS


def in_background(work: Awaitable[Any]) -> asyncio.Task[Any]:
    """Run ``work`` as a task the loop keeps until it ends, and a drain waits for."""
    task = asyncio.ensure_future(work)
    PERSIST_TASKS.add(task)
    task.add_done_callback(PERSIST_TASKS.discard)
    return task


async def drain_after_terminal(timeout: float = DRAIN_AFTER_TERMINAL_SECONDS) -> None:
    """Let the writes after the terminals land before the process exits, for up to ``timeout`` seconds."""
    writes = [task for task in PERSIST_TASKS if not task.done()]
    if not writes:
        return
    logger.info("Waiting for %d write(s) after the terminal, up to %.0fs", len(writes), timeout)
    _, late = await asyncio.wait(writes, timeout=timeout)
    if late:
        logger.warning("%d write(s) after the terminal did not land before the drain ended", len(late))
