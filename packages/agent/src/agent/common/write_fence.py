from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator
from contextvars import ContextVar
from contextvars import Token
from typing import Protocol

__all__ = [
    "TurnFenced",
    "WriteFence",
    "bind_write_fence",
    "check_write",
    "current_write_fence",
    "guarded_write",
    "unbind_write_fence",
]


class TurnFenced(RuntimeError): ...


class WriteFence(Protocol):
    write_timeout: float

    def fenced(self) -> bool: ...

    def remaining(self) -> float: ...


_CURRENT: ContextVar[WriteFence | None] = ContextVar("write_fence", default=None)


def bind_write_fence(fence: WriteFence | None) -> Token[WriteFence | None]:
    return _CURRENT.set(fence)


def unbind_write_fence(token: Token[WriteFence | None]) -> None:
    _CURRENT.reset(token)


def current_write_fence() -> WriteFence | None:
    return _CURRENT.get()


def check_write(fence: WriteFence | None) -> None:
    if fence is not None and fence.fenced():
        raise TurnFenced("the turn lost its conversation and may not write")


@contextlib.asynccontextmanager
async def guarded_write(fence: WriteFence | None = None) -> AsyncIterator[None]:
    fence = current_write_fence() if fence is None else fence
    if fence is None:
        yield
        return
    check_write(fence)
    loop = asyncio.get_running_loop()
    scope = asyncio.timeout(_runway(fence))
    keeper: asyncio.Task[None] | None = None
    try:
        async with scope:
            keeper = asyncio.create_task(_follow_the_deadline(scope, fence, loop))
            yield
    except TimeoutError as exc:
        if scope.expired() and fence.fenced():
            raise TurnFenced("a write outlived the turn's hold on its conversation and was cut off") from exc
        raise
    finally:
        if keeper is not None:
            keeper.cancel()


def _runway(fence: WriteFence) -> float:
    return fence.remaining() + fence.write_timeout


async def _follow_the_deadline(scope: asyncio.Timeout, fence: WriteFence, loop: asyncio.AbstractEventLoop) -> None:
    while True:
        remaining = fence.remaining()
        if remaining <= 0.0 or fence.fenced():
            return  # the bound stands: write_timeout past the deadline that held
        await asyncio.sleep(remaining)
        if scope.expired():
            return  # the loop was starved past the old bound: the write is already being cut off
        if fence.remaining() > 0.0 and not fence.fenced():  # a renewal moved the deadline while we slept
            scope.reschedule(loop.time() + _runway(fence))
