from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)

ORIGINAL_DOWNLOAD_FAILED = (
    "original_download_failed: the uploaded file could not be read from storage for indexing "
    "(the link expired, the object is gone, or storage was unreachable)"
)


def is_deferred(entry: Any) -> bool:
    return callable(entry)


def resolve_original(entry: str | Callable[[], str], downloaded: list[str]) -> str | None:
    if not is_deferred(entry):
        return entry
    path = run_deferred_download(entry, "original")
    if path:
        downloaded.append(path)
    return path


DOWNLOAD_RETRY_FIRST_WAIT_SECONDS = 3.0
DOWNLOAD_RETRY_BUDGET_SECONDS = 50.0

_RETRYABLE_ERRORS = frozenset({"NetworkError", "RemoteProtocolError", "ConnectTimeout", "ConnectionError"})
_RETRYABLE_STATUSES = frozenset({502, 503, 504})

_sleep = time.sleep
_monotonic = time.monotonic


def _status_of(error: BaseException) -> int | None:
    status = getattr(getattr(error, "response", None), "status_code", None)
    return status if isinstance(status, int) else None


def is_retryable_download_error(error: BaseException) -> bool:
    status = _status_of(error)
    if status is not None:
        return status in _RETRYABLE_STATUSES
    return bool({cls.__name__ for cls in type(error).__mro__} & _RETRYABLE_ERRORS)


def run_deferred_download(source: Callable[[], str], what: str) -> str | None:
    started = _monotonic()
    wait = DOWNLOAD_RETRY_FIRST_WAIT_SECONDS
    attempt = 1
    while True:
        try:
            return source()
        except Exception as error:  # noqa: BLE001 — the caller decides what a missing file costs
            status = _status_of(error)
            detail = f" (HTTP {status})" if status is not None else ""
            in_budget = _monotonic() + wait - started <= DOWNLOAD_RETRY_BUDGET_SECONDS
            if not (in_budget and is_retryable_download_error(error)):
                logger.warning("Download of the %s failed: %s%s", what, type(error).__name__, detail)
                return None
            logger.info(
                "Download of the %s failed (%s%s, attempt %d); trying again in %.0f s",
                what,
                type(error).__name__,
                detail,
                attempt,
                wait,
            )
        _sleep(wait)
        wait *= 2
        attempt += 1
