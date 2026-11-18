from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import threading
import time
import uuid
from collections.abc import AsyncIterator
from collections.abc import Callable
from collections.abc import Iterator
from contextlib import asynccontextmanager
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from dataclasses import field

from agent.common import cache
from agent.common.lease_slots import ACQUIRE_LUA
from agent.common.lease_slots import RELEASE_LUA
from agent.common.lease_slots import RENEW_LUA

logger = logging.getLogger(__name__)

MAX_ACTIVE_TURNS = int(os.environ.get("MAX_ACTIVE_TURNS", "24"))

MAX_ACTIVE_TURNS_PER_ORG = int(os.environ.get("MAX_ACTIVE_TURNS_PER_ORG", "6"))

TURN_LEASE_SECONDS = int(os.environ.get("TURN_LEASE_SECONDS", "120"))


def _renew_interval() -> float:
    return max(TURN_LEASE_SECONDS / 3, 0.01)


_GLOBAL_KEY = "turns:active:_global"


def _org_key(organization_id: str) -> str:
    return f"turns:active:{organization_id}"


class TurnAdmissionError(RuntimeError):
    def __init__(self, message: str, retry_after_seconds: int = 15):
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


_ACQUIRE_LUA = ACQUIRE_LUA
_RELEASE_LUA = RELEASE_LUA
_RENEW_LUA = RENEW_LUA

_local_slots: dict[str, dict[str, float]] = {}
_local_lock = threading.Lock()


def reset_local_slots() -> None:
    with _local_lock:
        _local_slots.clear()


def _local_acquire(key: str, limit: int, member: str, now: float) -> bool:
    with _local_lock:
        held = _local_slots.setdefault(key, {})
        for stale in [m for m, at in held.items() if at <= now - TURN_LEASE_SECONDS]:
            held.pop(stale, None)
        if len(held) >= limit:
            return False
        held[member] = now
        return True


def _local_renew(key: str, member: str, now: float) -> bool:
    with _local_lock:
        held = _local_slots.get(key)
        if held is None or member not in held:
            return False
        held[member] = now
        return True


def _local_release(key: str, member: str) -> None:
    with _local_lock:
        held = _local_slots.get(key)
        if held is not None:
            held.pop(member, None)


def _acquire(key: str, limit: int, member: str) -> bool:
    now = time.time()
    try:
        result = cache.eval_script(_ACQUIRE_LUA, [key], [now, TURN_LEASE_SECONDS, limit, member])
    except Exception:
        logger.warning("Turn admission check failed on %s; admitting", key, exc_info=True)
        return True
    if result is None:
        return _local_acquire(key, limit, member, now)
    return int(result) == 1


def _release(key: str, member: str) -> None:
    cache.eval_script(_RELEASE_LUA, [key], [member])
    _local_release(key, member)


def _renew_all(held: list[str], member: str, released: Callable[[], bool] = lambda: False) -> None:
    now = time.time()
    for key in held:
        try:
            renewed = cache.eval_script(_RENEW_LUA, [key], [now, TURN_LEASE_SECONDS, member])
        except Exception:  # pragma: no cover - renewal must never break the turn
            logger.warning("Failed to renew turn slot on %s", key, exc_info=True)
            continue
        local = _local_renew(key, member, now)
        if renewed is not None and int(renewed) == 0 and not local and not released():
            logger.warning("Turn slot on %s was reclaimed while the turn still ran", key)


@dataclass
class TurnSlots:
    held: dict[str, list[str]] = field(default_factory=dict)
    closed: bool = False


_TURN_SLOTS: ContextVar[TurnSlots | None] = ContextVar("turn_slots", default=None)


def bind_turn_slots(slots: TurnSlots) -> None:
    _TURN_SLOTS.set(slots)


def _release_stranded(stranded: list[tuple[str, list[str]]]) -> None:
    for member, keys in stranded:
        _release_all(keys, member)


async def return_turn_slots(slots: TurnSlots) -> int:
    slots.closed = True
    stranded = list(slots.held.items())
    slots.held.clear()
    if stranded:
        await asyncio.to_thread(_release_stranded, stranded)
    return len(stranded)


async def _keep_renewing(held: list[str], member: str, owner: TurnSlots | None = None) -> None:
    while True:
        await asyncio.sleep(_renew_interval())
        if owner is not None and owner.closed:
            return
        try:
            await asyncio.to_thread(_renew_all, held, member, lambda: owner is not None and owner.closed)
        except Exception:  # pragma: no cover - _renew_all already contains its errors
            logger.warning("Turn slot renewal failed", exc_info=True)


def _pools(organization_id: str | None) -> list[tuple[str, int, str]]:
    pools: list[tuple[str, int, str]] = []
    if MAX_ACTIVE_TURNS > 0:
        pools.append(
            (
                _GLOBAL_KEY,
                MAX_ACTIVE_TURNS,
                "The assistant is busy right now. Please send your message again in a moment.",
            )
        )
    if MAX_ACTIVE_TURNS_PER_ORG > 0 and organization_id:
        pools.append(
            (
                _org_key(organization_id),
                MAX_ACTIVE_TURNS_PER_ORG,
                "Your organization already has several answers in progress. Please wait for one to finish.",
            )
        )
    return pools


_COUNT_LUA = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local lease = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - lease)
return redis.call('ZCARD', key)
"""


def _local_count(key: str, now: float) -> int:
    with _local_lock:
        held = _local_slots.get(key, {})
        return sum(1 for at in held.values() if at > now - TURN_LEASE_SECONDS)


def active_turns() -> int | None:
    now = time.time()
    if not os.environ.get("REDIS_URL"):
        return _local_count(_GLOBAL_KEY, now)
    try:
        count = cache.eval_script(_COUNT_LUA, [_GLOBAL_KEY], [now, TURN_LEASE_SECONDS])
    except Exception:  # pragma: no cover - eval_script contains its own errors
        logger.warning("Active-turn count failed", exc_info=True)
        return None
    return None if count is None else int(count)


def _release_all(held: list[str], member: str) -> None:
    for key in held:
        try:
            _release(key, member)
        except Exception:  # pragma: no cover - release must never mask the turn's own error
            logger.warning("Failed to release turn slot on %s", key, exc_info=True)


def _acquire_all(organization_id: str | None, member: str) -> tuple[list[str], str | None]:
    held: list[str] = []
    for key, limit, message in _pools(organization_id):
        if not _acquire(key, limit, member):
            _release_all(held, member)
            return [], message
        held.append(key)
    return held, None


def _release_abandoned(acquisition: asyncio.Task, member: str) -> None:
    if acquisition.cancelled():
        return
    if acquisition.exception() is not None:
        return
    held, _refusal = acquisition.result()
    if not held:
        return
    logger.info("Releasing %d turn slot(s) from a cancelled admission", len(held))
    try:
        asyncio.get_running_loop().run_in_executor(None, _release_all, held, member)
    except RuntimeError:  # pragma: no cover - loop already closed during shutdown
        _release_all(held, member)


@contextmanager
def admit_turn(organization_id: str | None) -> Iterator[None]:
    member = uuid.uuid4().hex
    held, refusal = _acquire_all(organization_id, member)
    if refusal is not None:
        raise TurnAdmissionError(refusal)
    try:
        yield
    finally:
        _release_all(held, member)


@asynccontextmanager
async def admit_turn_async(organization_id: str | None) -> AsyncIterator[None]:
    member = uuid.uuid4().hex
    acquisition = asyncio.create_task(asyncio.to_thread(_acquire_all, organization_id, member))
    try:
        held, refusal = await asyncio.shield(acquisition)
    except asyncio.CancelledError:
        acquisition.add_done_callback(lambda task: _release_abandoned(task, member))
        raise
    if refusal is not None:
        raise TurnAdmissionError(refusal)
    owner = _TURN_SLOTS.get()
    if owner is not None and held:
        if owner.closed:
            await asyncio.to_thread(_release_all, held, member)
            raise TurnAdmissionError("This answer has already ended.")
        owner.held[member] = held
    renewing = asyncio.create_task(_keep_renewing(held, member, owner)) if held else None
    try:
        yield
    finally:
        if renewing is not None:
            renewing.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await renewing
        if owner is not None:
            owner.held.pop(member, None)
        await asyncio.to_thread(_release_all, held, member)
