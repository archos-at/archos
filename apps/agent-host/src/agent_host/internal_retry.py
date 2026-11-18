from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)

RETRY_DELAYS_SECONDS: tuple[float, ...] = (5.0, 20.0)

_RETRYABLE_STATUSES = frozenset({408, 425, 429, 500, 502, 503, 504})


async def _sleep(seconds: float) -> None:
    await asyncio.sleep(seconds)


def is_retryable_status(status_code: int, *, retry_not_found: bool) -> bool:
    if status_code == 404:
        return retry_not_found
    return status_code in _RETRYABLE_STATUSES


async def send_with_retry(
    send: Callable[[], Awaitable[Any]],
    *,
    label: str,
    retry_not_found: bool = False,
    delays: tuple[float, ...] | None = None,
) -> Any | None:
    schedule = RETRY_DELAYS_SECONDS if delays is None else delays
    attempts = len(schedule) + 1
    response: Any | None = None
    for attempt in range(1, attempts + 1):
        if attempt > 1:
            await _sleep(schedule[attempt - 2])
        try:
            response = await send()
        except Exception:  # noqa: BLE001 — a transport failure is what the retry is for
            response = None
            last = attempt == attempts
            logger.log(
                logging.WARNING if last else logging.INFO,
                "%s: attempt %d/%d failed",
                label,
                attempt,
                attempts,
                exc_info=last,
            )
            continue
        if not is_retryable_status(response.status_code, retry_not_found=retry_not_found):
            return response
        logger.info("%s: HTTP %s on attempt %d/%d", label, response.status_code, attempt, attempts)
    return response
