from __future__ import annotations

import asyncio
import errno
import logging
import os
import random
import socket
import time
from collections.abc import Awaitable
from collections.abc import Callable
from collections.abc import Iterator

logger = logging.getLogger(__name__)

BUDGET_ENV = "BOOT_RETRY_BUDGET_SECONDS"
DEFAULT_BUDGET_SECONDS = 180.0
FIRST_DELAY_SECONDS = 1.0
MAX_DELAY_SECONDS = 15.0

_UNREACHABLE_ERRNOS = frozenset(
    {
        errno.ECONNREFUSED,
        errno.ECONNRESET,
        errno.ECONNABORTED,
        errno.EHOSTUNREACH,
        errno.ENETUNREACH,
        errno.ETIMEDOUT,
        errno.EPIPE,
    }
)
_UNREACHABLE_SQLSTATE_PREFIXES = ("08", "57P01", "57P02", "57P03")
_UNREACHABLE_PG_MESSAGES = (
    "connection refused",
    "could not connect",
    "could not translate host name",
    "name or service not known",
    "temporary failure in name resolution",
    "no route to host",
    "network is unreachable",
    "timeout expired",
    "timed out",
    "the database system is starting up",
    "the database system is shutting down",
    "the database system is in recovery mode",
    "server closed the connection unexpectedly",
    "terminating connection due to administrator command",
    "connection reset",
)
_UNREACHABLE_GRPC_CODES = frozenset({"UNAVAILABLE", "DEADLINE_EXCEEDED"})

_sleep = time.sleep
_async_sleep = asyncio.sleep
_monotonic = time.monotonic


def budget_seconds() -> float:
    try:
        value = float(os.environ.get(BUDGET_ENV, ""))
    except ValueError:
        return DEFAULT_BUDGET_SECONDS
    return value if value >= 0 else DEFAULT_BUDGET_SECONDS


def _chain(error: BaseException) -> Iterator[BaseException]:
    seen: set[int] = set()
    pending: list[BaseException | None] = [error]
    while pending:
        current = pending.pop()
        if current is None or id(current) in seen:
            continue
        seen.add(id(current))
        yield current
        orig = getattr(current, "orig", None)
        pending += [orig if isinstance(orig, BaseException) else None, current.__cause__, current.__context__]


def _grpc_unreachable(error: BaseException) -> bool:
    try:
        import grpc
    except ImportError:
        return False
    if not isinstance(error, grpc.RpcError):
        return False
    code = getattr(error, "code", None)
    if not callable(code):
        return False
    try:
        status = code()
    except Exception:  # noqa: BLE001 - a status-less RpcError is no evidence of an outage
        return False
    return getattr(status, "name", None) in _UNREACHABLE_GRPC_CODES


def _postgres_unreachable(error: BaseException) -> bool:
    name = type(error).__name__
    if name == "PoolTimeout":
        return True
    sqlstate = getattr(error, "sqlstate", None) or getattr(error, "pgcode", None)
    if isinstance(sqlstate, str) and sqlstate.startswith(_UNREACHABLE_SQLSTATE_PREFIXES):
        return True
    if name != "OperationalError":
        return False
    message = str(error).lower()
    return any(marker in message for marker in _UNREACHABLE_PG_MESSAGES)


def is_connection_error(error: BaseException) -> bool:
    for current in _chain(error):
        if isinstance(current, (socket.gaierror, TimeoutError, ConnectionError)):
            return True
        if isinstance(current, OSError) and current.errno in _UNREACHABLE_ERRNOS:
            return True
        if _grpc_unreachable(current) or _postgres_unreachable(current):
            return True
    return False


def _delay(attempt: int) -> float:
    ceiling = min(MAX_DELAY_SECONDS, FIRST_DELAY_SECONDS * 2 ** (attempt - 1))
    return random.uniform(ceiling / 2, ceiling)  # noqa: S311 - jitter, not a secret


class _Attempts:
    def __init__(self, what: str, budget: float | None) -> None:
        self.what = what
        self.deadline = _monotonic() + (budget_seconds() if budget is None else budget)
        self.count = 0

    def delay_after(self, error: Exception) -> float:
        self.count += 1
        if not is_connection_error(error):
            raise error
        delay = _delay(self.count)
        if _monotonic() + delay > self.deadline:
            logger.error(
                "%s: still unreachable after %d attempts, giving up: %s: %s",
                self.what,
                self.count,
                type(error).__name__,
                error,
            )
            raise error
        logger.warning(
            "%s: unreachable on attempt %d, retrying in %.1fs: %s: %s",
            self.what,
            self.count,
            delay,
            type(error).__name__,
            error,
        )
        return delay


def retry_connection[T](call: Callable[[], T], *, what: str, budget: float | None = None) -> T:
    attempts = _Attempts(what, budget)
    while True:
        try:
            return call()
        except Exception as error:
            _sleep(attempts.delay_after(error))


async def retry_connection_async[T](call: Callable[[], Awaitable[T]], *, what: str, budget: float | None = None) -> T:
    attempts = _Attempts(what, budget)
    while True:
        try:
            return await call()
        except Exception as error:
            await _async_sleep(attempts.delay_after(error))
