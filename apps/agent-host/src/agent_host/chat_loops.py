from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)

_LOOP_RESTART_MIN_S = 0.5
_LOOP_RESTART_MAX_S = 30.0


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
