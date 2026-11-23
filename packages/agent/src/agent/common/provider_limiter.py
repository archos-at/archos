from __future__ import annotations

import asyncio
import contextvars
import functools
import logging
import os
import threading
import time
import uuid
from collections.abc import AsyncIterator
from collections.abc import Awaitable
from collections.abc import Callable
from collections.abc import Iterator
from contextlib import asynccontextmanager
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any
from typing import ParamSpec
from typing import TypeVar

from agent.common import cache
from agent.common import lease_slots
from agent.common.limiter_meters import _last_limits
from agent.common.limiter_meters import _meters
from agent.common.limiter_meters import _record
from agent.common.limiter_scripts import ACQUIRE_LUA
from agent.common.limiter_scripts import THROTTLE_LUA
from agent.common.rate_limit_errors import KEY_SCOPE
from agent.common.rate_limit_errors import MODEL_SCOPE
from agent.common.rate_limit_errors import _backoff_before_retry
from agent.common.rate_limit_errors import is_rate_limited
from agent.common.rate_limit_errors import rate_limit_scope

logger = logging.getLogger(__name__)

P = ParamSpec("P")
R = TypeVar("R")

CHAT = "chat"
INTERACTIVE = "interactive"
RESEARCH = "research"
BULK = "bulk"
CLASSES = (CHAT, INTERACTIVE, RESEARCH, BULK)
DEFAULT_CLASS = INTERACTIVE

POOL = "openrouter"

LEASE_SECONDS = 60.0
MAX_HOLD_SECONDS = 1800.0
TICKET_SECONDS = 5.0
POLL_SECONDS = 0.15
CUT_COOLDOWN_SECONDS = 2.0
STATE_TTL_SECONDS = 3600
_WAIT_WARNING_SECONDS = 30.0

_ENABLED_ENV = "PROVIDER_LIMITER"

_CEILING_ENV = "PROVIDER_LIMIT_CEILING"

_FLOOR_ENV = "PROVIDER_LIMIT_FLOOR"

_INTERVAL_ENV = "PROVIDER_LIMIT_INTERVAL_SECONDS"

_MODEL_CEILING_ENV = "PROVIDER_MODEL_LIMIT_CEILING"

_MODEL_FLOOR_ENV = "PROVIDER_MODEL_LIMIT_FLOOR"

_DEFAULT_CEILING = 128
_DEFAULT_FLOOR = 8
_DEFAULT_MODEL_CEILING = 32
_DEFAULT_MODEL_FLOOR = 2
_DEFAULT_INTERVAL_SECONDS = 5.0


class ProviderWaitTimeout(TimeoutError): ...


def enabled() -> bool:
    return os.environ.get(_ENABLED_ENV, "on").strip().lower() not in {"off", "false", "0", "no"}


def _env_number(name: str, default: float, minimum: float) -> float:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return max(minimum, float(raw))
    except ValueError:
        logger.warning("Ignoring %s=%r: not a number", name, raw)
        return default


def limit_ceiling() -> int:
    return int(_env_number(_CEILING_ENV, _DEFAULT_CEILING, 1))


def limit_floor() -> int:
    return min(int(_env_number(_FLOOR_ENV, _DEFAULT_FLOOR, 1)), limit_ceiling())


def model_limit_ceiling() -> int:
    return int(_env_number(_MODEL_CEILING_ENV, _DEFAULT_MODEL_CEILING, 1))


def model_limit_floor() -> int:
    return min(int(_env_number(_MODEL_FLOOR_ENV, _DEFAULT_MODEL_FLOOR, 1)), model_limit_ceiling())


def limit_interval_seconds() -> float:
    return _env_number(_INTERVAL_ENV, _DEFAULT_INTERVAL_SECONDS, 0.0)


_CLASS: contextvars.ContextVar[str] = contextvars.ContextVar("limiter_class", default=DEFAULT_CLASS)


def current_class() -> str:
    return _CLASS.get()


def checked_class(cls: str) -> str:
    if cls not in CLASSES:
        raise ValueError(f"unknown provider class {cls!r}; expected one of {', '.join(CLASSES)}")
    return cls


def class_for_priority(priority: object) -> str:
    return BULK if priority == "bulk" else INTERACTIVE


@contextmanager
def provider_class(cls: str) -> Iterator[str]:
    token = _CLASS.set(checked_class(cls))
    try:
        yield cls
    finally:
        try:
            _CLASS.reset(token)
        except ValueError:
            _CLASS.set(DEFAULT_CLASS)


@contextmanager
def priority_scope(priority: object) -> Iterator[str]:
    if priority is None:
        yield current_class()
        return
    with provider_class(class_for_priority(priority)) as cls:
        yield cls


def with_provider_class(cls: str) -> Callable[[Callable[P, Awaitable[R]]], Callable[P, Awaitable[R]]]:
    checked_class(cls)

    def decorate(fn: Callable[P, Awaitable[R]]) -> Callable[P, Awaitable[R]]:
        @functools.wraps(fn)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            with provider_class(cls):
                return await fn(*args, **kwargs)

        return wrapper

    return decorate


def _now() -> float:
    return time.time()


def _keys(pool: str, model: str | None = None) -> dict[str, Any]:
    base = f"grid:provider:{{{pool}}}"
    return {
        "leases": f"{base}:leases",
        "polls": f"{base}:polls",
        "blocked": f"{base}:blocked",
        "blocked_on": f"{base}:blocked_on",
        "tickets": [f"{base}:tickets:{cls}" for cls in CLASSES],
        "state": f"{base}:limit",
        "model_leases": f"{base}:model:{model or '-'}:leases",
        "model_state": f"{base}:model:{model or '-'}:limit",
    }


def _held_keys(keys: dict[str, Any], model: str | None) -> list[str]:
    return [keys["leases"], keys["model_leases"]] if model else [keys["leases"]]


def _remember_limits(attempt: _Attempt, model: str | None) -> None:
    _last_limits[(KEY_SCOPE, None)] = attempt.limit
    if model is not None:
        _last_limits[(MODEL_SCOPE, model)] = attempt.model_limit
    _meters()


_held: dict[str, tuple[list[str], float]] = {}
_held_lock = threading.Lock()
_renewer: threading.Thread | None = None


def _renew_held() -> None:
    now = time.monotonic()
    with _held_lock:
        stale = [m for m, (_, taken) in _held.items() if now - taken > MAX_HOLD_SECONDS]
        for member in stale:
            del _held[member]
        held = list(_held.items())
    for member in stale:
        logger.warning("Provider slot %s held past %.0fs; no longer renewed", member, MAX_HOLD_SECONDS)
    for member, (pools, _) in held:
        for pool in pools:
            cache.eval_script(lease_slots.RENEW_LUA, [pool], [_now(), LEASE_SECONDS, member])


def _renew_forever() -> None:
    while True:
        time.sleep(LEASE_SECONDS / 3)
        try:
            _renew_held()
        except Exception:  # noqa: BLE001 - the thread outlives one bad round
            logger.debug("Provider slot renewal failed", exc_info=True)


def _ensure_renewer() -> None:
    global _renewer
    if _renewer is not None and _renewer.is_alive():
        return
    with _held_lock:
        if _renewer is not None and _renewer.is_alive():
            return
        _renewer = threading.Thread(target=_renew_forever, daemon=True, name="provider-limiter-renew")
        _renewer.start()


@dataclass
class Lease:
    member: str
    cls: str
    held: bool = False
    waited_seconds: float = 0.0
    model: str | None = None
    pool: str = POOL
    _released: bool = False

    def release(self) -> None:
        if not self.held or self._released:
            return
        self._released = True
        with _held_lock:
            _held.pop(self.member, None)
        _record(0, "add", -1, {})
        try:
            pools = _held_keys(_keys(self.pool, self.model), self.model)
            cache.eval_script(lease_slots.WITHDRAW_LUA, pools, [self.member])
        except Exception:  # noqa: BLE001 - the lease ages out
            logger.debug("Could not release provider slot %s", self.member, exc_info=True)

    async def arelease(self) -> None:
        if not self.held or self._released:
            return
        await asyncio.shield(asyncio.to_thread(self.release))


def _unheld(cls: str) -> Lease:
    return Lease(member="", cls=cls)


@dataclass(frozen=True)
class _Attempt:
    taken: bool
    limit: int
    in_flight: int
    model_limit: int = 0
    model_in_flight: int = 0


def _attempt(member: str, cls: str, model: str | None = None, pool: str = POOL) -> _Attempt | None:
    keys = _keys(pool, model)
    result = cache.eval_script(
        ACQUIRE_LUA,
        [
            keys["leases"],
            keys["polls"],
            keys["blocked"],
            keys["blocked_on"],
            *keys["tickets"],
            keys["model_leases"],
            keys["state"],
            keys["model_state"],
        ],
        [
            _now(),
            LEASE_SECONDS,
            TICKET_SECONDS,
            member,
            CLASSES.index(cls) + 1,
            limit_interval_seconds(),
            STATE_TTL_SECONDS,
            limit_floor(),
            limit_ceiling(),
            1 if model else 0,
            model_limit_floor(),
            model_limit_ceiling(),
            model or "",
        ],
    )
    try:
        taken, limit, in_flight, model_limit, model_in_flight = (int(float(v)) for v in result)
    except TypeError, ValueError:
        return None
    return _Attempt(taken == 1, limit, in_flight, model_limit, model_in_flight)


def _abandon(member: str, model: str | None = None, pool: str = POOL) -> None:
    keys = _keys(pool, model)
    cache.eval_script(
        lease_slots.WITHDRAW_LUA,
        [keys["polls"], keys["blocked"], keys["blocked_on"], *keys["tickets"], *_held_keys(keys, model)],
        [member],
    )


def _granted(member: str, cls: str, model: str | None, attempt: _Attempt, started: float) -> Lease:
    waited = time.monotonic() - started
    with _held_lock:
        _held[member] = (_held_keys(_keys(POOL, model), model), time.monotonic())
    _ensure_renewer()
    _remember_limits(attempt, model)
    _record(0, "add", 1, {})
    _record(1, "record", waited, {"class": cls})
    return Lease(member=member, cls=cls, held=True, waited_seconds=waited, model=model)


def _check_wait(member: str, cls: str, started: float, max_wait_seconds: float | None, warned: list[float]) -> None:
    waited = time.monotonic() - started
    if max_wait_seconds is not None and waited >= max_wait_seconds:
        raise ProviderWaitTimeout(f"waited {waited:.1f}s for a {cls} provider slot")
    if waited - warned[0] >= _WAIT_WARNING_SECONDS:
        warned[0] = waited
        logger.warning("Still waiting for a %s provider slot after %.0fs", cls, waited)


def acquire(*, cls: str | None = None, model: str | None = None, max_wait_seconds: float | None = None) -> Lease:
    cls = checked_class(cls) if cls else current_class()
    if not enabled():
        return _unheld(cls)
    member = uuid.uuid4().hex
    started = time.monotonic()
    warned = [0.0]
    try:
        return _poll_for_slot(member, cls, model, started, max_wait_seconds, warned)
    except BaseException:
        _abandon(member, model)
        raise


def _poll_for_slot(
    member: str, cls: str, model: str | None, started: float, max_wait_seconds: float | None, warned: list[float]
) -> Lease:
    while True:
        attempt = _attempt(member, cls, model)
        if attempt is None:
            return _unheld(cls)
        if attempt.taken:
            return _granted(member, cls, model, attempt, started)
        _check_wait(member, cls, started, max_wait_seconds, warned)
        time.sleep(POLL_SECONDS)


async def aacquire(*, cls: str | None = None, model: str | None = None, max_wait_seconds: float | None = None) -> Lease:
    cls = checked_class(cls) if cls else current_class()
    if not enabled():
        return _unheld(cls)
    member = uuid.uuid4().hex
    started = time.monotonic()
    warned = [0.0]
    attempt_future: list[asyncio.Future[_Attempt | None] | None] = [None]
    try:
        return await _apoll_for_slot(member, cls, model, started, max_wait_seconds, warned, attempt_future)
    except BaseException:
        _abandon_after(attempt_future[0], member, model)
        raise


async def _apoll_for_slot(
    member: str,
    cls: str,
    model: str | None,
    started: float,
    max_wait_seconds: float | None,
    warned: list[float],
    attempt_future: list[asyncio.Future[_Attempt | None] | None],
) -> Lease:
    while True:
        attempt_future[0] = asyncio.ensure_future(asyncio.to_thread(_attempt, member, cls, model))
        attempt = await asyncio.shield(attempt_future[0])
        if attempt is None:
            return _unheld(cls)
        if attempt.taken:
            return _granted(member, cls, model, attempt, started)
        _check_wait(member, cls, started, max_wait_seconds, warned)
        await asyncio.sleep(POLL_SECONDS)


def _abandon_after(attempt: asyncio.Future | None, member: str, model: str | None) -> None:

    def withdraw(_future: object = None) -> None:
        try:
            asyncio.get_running_loop().run_in_executor(None, _abandon, member, model)
        except RuntimeError:  # the loop is closing: the ticket and lease age out
            logger.debug("Could not withdraw provider waiter %s", member)

    if attempt is None or attempt.done():
        withdraw()
        return
    attempt.add_done_callback(withdraw)


def throttle(model: str | None = None, scope: str = MODEL_SCOPE) -> None:
    _record(2, "add", 1, {"model": model or "unknown", "scope": scope})
    if not enabled():
        return
    if scope == MODEL_SCOPE and not model:
        return
    keys = _keys(POOL, model)
    if scope == KEY_SCOPE:
        state, floor_limit, ceiling, remembered = keys["state"], limit_floor(), limit_ceiling(), (KEY_SCOPE, None)
    else:
        state = keys["model_state"]
        floor_limit, ceiling, remembered = model_limit_floor(), model_limit_ceiling(), (MODEL_SCOPE, model)
    try:
        limit = cache.eval_script(
            THROTTLE_LUA, [state], [_now(), floor_limit, ceiling, CUT_COOLDOWN_SECONDS, STATE_TTL_SECONDS]
        )
        if limit is not None:
            _last_limits[remembered] = int(float(limit))
            _meters()
            logger.info("Provider answered 429 (%s, %s scope); that limit is now %s", model or "unknown", scope, limit)
    except Exception:  # noqa: BLE001 - recording a 429 must not fail the call that met it
        logger.debug("Could not record a provider 429", exc_info=True)


async def athrottle(model: str | None = None, scope: str = MODEL_SCOPE) -> None:
    await asyncio.shield(asyncio.to_thread(throttle, model, scope))


@contextmanager
def slot(*, cls: str | None = None, model: str | None = None, max_wait_seconds: float | None = None) -> Iterator[Lease]:
    lease = acquire(cls=cls, model=model, max_wait_seconds=max_wait_seconds)
    try:
        yield lease
    except BaseException as exc:
        _back_off_after(exc, model, lease)
        raise
    finally:
        lease.release()


def _back_off_after(exc: BaseException, model: str | None, lease: Lease) -> None:
    if is_rate_limited(exc):
        throttle(model, rate_limit_scope(exc))
        lease.release()
        wait = _backoff_before_retry(exc)
        if wait:
            time.sleep(wait)


@asynccontextmanager
async def aslot(
    *, cls: str | None = None, model: str | None = None, max_wait_seconds: float | None = None
) -> AsyncIterator[Lease]:
    lease = await aacquire(cls=cls, model=model, max_wait_seconds=max_wait_seconds)
    try:
        yield lease
    except BaseException as exc:
        await _aback_off_after(exc, model, lease)
        raise
    finally:
        await lease.arelease()


async def _aback_off_after(exc: BaseException, model: str | None, lease: Lease) -> None:
    if is_rate_limited(exc):
        await athrottle(model, rate_limit_scope(exc))
        await lease.arelease()
        wait = _backoff_before_retry(exc)
        if wait:
            await asyncio.sleep(wait)
