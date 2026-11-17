from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import time
import uuid
from collections import OrderedDict
from collections.abc import AsyncIterator
from collections.abc import Awaitable
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from typing import Protocol
from typing import TypeVar

T = TypeVar("T")

logger = logging.getLogger(__name__)

FRAME = "frame"  # owner -> relays: a stamped chat wire v2 event (payload = the frame)
HITL_ANSWER = "hitl_answer"  # relay -> owner: an interaction_response, with who sent it
CANCEL = "cancel"  # relay -> owner: a cancel_turn, with who sent it
SUPERSEDE = "supersede"  # any replica -> owner: a newer question started, so stop the stale turn
STEER = "steer"  # relay -> owner: a steering note for the running turn, masked, with who sent it

_EVENTS = "conv:{id}:events"  # owner publishes, relays and spectators subscribe
_INPUT = "conv:{id}:input"  # relays publish, owner subscribes
_STREAM = "conv:{id}:stream"  # Redis stream: replayable copy of every frame, read by `attach`
_TURN = "conv:{id}:turn:{turn}"  # SET NX: the one replica that runs this turn id
_RUNNING = "conv:{id}:running"  # SET NX + TTL: the one turn of the conversation running now, and where

_STREAM_MAXLEN = int(os.environ.get("CONV_STREAM_MAXLEN", "2000") or "2000")
_STREAM_TTL_SECONDS = int(os.environ.get("CONV_STREAM_TTL_SECONDS", "3600") or "3600")

RUNNING_TTL_SECONDS = float(os.environ.get("CHAT_RUNNING_TTL_SECONDS", "12") or "12")

BUS_CALL_TIMEOUT_S = 1.0
BUS_RETRY_AFTER_S = 5.0


def running_ttl() -> float:
    return RUNNING_TTL_SECONDS


def running_renew_interval() -> float:
    return max(running_ttl() / 4, 0.01)


class BusUnavailable(ConnectionError): ...


@dataclass(frozen=True)
class Envelope:
    conv: str
    type: str
    payload: Any
    origin: str = ""

    def encode(self) -> str:
        return json.dumps({"conv": self.conv, "origin": self.origin, "type": self.type, "payload": self.payload})

    @staticmethod
    def decode(raw: str) -> Envelope:
        d = json.loads(raw)
        return Envelope(
            conv=d.get("conv", ""), type=d.get("type", ""), payload=d.get("payload"), origin=d.get("origin", "")
        )


@dataclass(frozen=True)
class RunningMarker:
    replica: str
    turn_id: str

    @staticmethod
    def decode(raw: str) -> RunningMarker | None:
        try:
            d = json.loads(raw)
            return RunningMarker(replica=str(d["replica"]), turn_id=str(d["turn_id"]))
        except ValueError, KeyError, TypeError:
            return None


class BusTransport(Protocol):
    async def publish(self, channel: str, data: str) -> None: ...
    def subscribe(self, channel: str, ready: asyncio.Event | None = None) -> AsyncIterator[str]: ...

    async def xadd(self, stream: str, data: str, maxlen: int, ttl: int) -> None: ...
    async def xrange(self, stream: str) -> list[str]: ...
    async def set_nx(self, key: str, value: str, ttl: int | float) -> bool: ...

    async def get(self, key: str) -> str | None: ...

    async def expire_if_value(self, key: str, value: str, ttl: int | float) -> bool: ...

    async def delete_if_value(self, key: str, value: str) -> bool: ...

    async def close(self) -> None: ...


_IN_MEMORY_STREAMS = 256


class InMemoryTransport:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._subs: dict[str, list[asyncio.Queue[str]]] = {}
        self._streams: OrderedDict[str, list[str]] = OrderedDict()
        self._keys: dict[str, tuple[str, float]] = {}
        self._clock = clock

    async def publish(self, channel: str, data: str) -> None:
        for q in list(self._subs.get(channel, ())):
            q.put_nowait(data)

    async def subscribe(self, channel: str, ready: asyncio.Event | None = None) -> AsyncIterator[str]:
        q: asyncio.Queue[str] = asyncio.Queue()
        self._subs.setdefault(channel, []).append(q)
        if ready is not None:
            ready.set()
        try:
            while True:
                yield await q.get()
        finally:
            subs = self._subs.get(channel)
            if subs and q in subs:
                subs.remove(q)

    async def xadd(self, stream: str, data: str, maxlen: int, ttl: int) -> None:
        buf = self._streams.setdefault(stream, [])
        self._streams.move_to_end(stream)
        buf.append(data)
        del buf[: max(0, len(buf) - maxlen)]
        while len(self._streams) > _IN_MEMORY_STREAMS:
            self._streams.popitem(last=False)

    async def xrange(self, stream: str) -> list[str]:
        return list(self._streams.get(stream, ()))

    def _live_keys(self) -> dict[str, tuple[str, float]]:
        now = self._clock()
        self._keys = {k: held for k, held in self._keys.items() if held[1] > now}
        return self._keys

    async def set_nx(self, key: str, value: str, ttl: int | float) -> bool:
        keys = self._live_keys()
        if key in keys:
            return False
        keys[key] = (value, self._clock() + ttl)
        return True

    async def get(self, key: str) -> str | None:
        held = self._live_keys().get(key)
        return held[0] if held else None

    async def expire_if_value(self, key: str, value: str, ttl: int | float) -> bool:
        keys = self._live_keys()
        held = keys.get(key)
        if held is None or held[0] != value:
            return False
        keys[key] = (value, self._clock() + ttl)
        return True

    async def delete_if_value(self, key: str, value: str) -> bool:
        keys = self._live_keys()
        held = keys.get(key)
        if held is None or held[0] != value:
            return False
        del keys[key]
        return True

    async def close(self) -> None:
        return None


class RedisTransport:
    def __init__(self, url: str | None = None, *, client: Any = None) -> None:
        if client is not None:
            self._redis = client
            self._sub_redis = client
            self._owns_clients = False
        else:
            from redis.asyncio import Redis

            self._redis = Redis.from_url(url, decode_responses=True, socket_timeout=1.0, socket_connect_timeout=1.0)
            self._sub_redis = Redis.from_url(
                url,
                decode_responses=True,
                socket_timeout=None,
                socket_connect_timeout=1.0,
                health_check_interval=30,
            )
            self._owns_clients = True

    async def publish(self, channel: str, data: str) -> None:
        await self._redis.publish(channel, data)

    async def subscribe(self, channel: str, ready: asyncio.Event | None = None) -> AsyncIterator[str]:
        pubsub = self._sub_redis.pubsub()
        await pubsub.subscribe(channel)
        try:
            async for msg in pubsub.listen():
                if msg.get("type") == "subscribe" and ready is not None:
                    ready.set()
                if msg.get("type") == "message":
                    yield msg["data"]
        finally:
            with contextlib.suppress(Exception):
                await pubsub.unsubscribe(channel)
                await pubsub.aclose()

    async def xadd(self, stream: str, data: str, maxlen: int, ttl: int) -> None:
        async with self._redis.pipeline(transaction=False) as pipe:
            pipe.xadd(stream, {"d": data}, maxlen=maxlen, approximate=True)
            pipe.expire(stream, ttl)
            await pipe.execute()

    async def xrange(self, stream: str) -> list[str]:
        entries = await self._redis.xrange(stream)
        return [fields["d"] for _id, fields in entries if "d" in fields]

    async def set_nx(self, key: str, value: str, ttl: int | float) -> bool:
        return bool(await self._redis.set(key, value, nx=True, px=max(1, int(ttl * 1000))))

    async def get(self, key: str) -> str | None:
        return await self._redis.get(key)

    async def expire_if_value(self, key: str, value: str, ttl: int | float) -> bool:
        return await self._if_value(key, value, lambda pipe: pipe.pexpire(key, max(1, int(ttl * 1000))))

    async def delete_if_value(self, key: str, value: str) -> bool:
        return await self._if_value(key, value, lambda pipe: pipe.delete(key))

    async def _if_value(self, key: str, value: str, write: Callable[[Any], Any]) -> bool:
        from redis.exceptions import WatchError

        async with self._redis.pipeline(transaction=True) as pipe:
            try:
                await pipe.watch(key)
                if await pipe.get(key) != value:
                    return False
                pipe.multi()
                write(pipe)
                await pipe.execute()
            except WatchError:
                return False
        return True

    async def close(self) -> None:
        with contextlib.suppress(Exception):
            await self._redis.aclose()
        if self._owns_clients:
            with contextlib.suppress(Exception):
                await self._sub_redis.aclose()


class ConversationBus:
    def __init__(self, transport: BusTransport, replica_id: str | None = None) -> None:
        self._t = transport
        self.replica_id = replica_id or f"{os.environ.get('HOSTNAME', 'local')}:{uuid.uuid4().hex[:8]}"
        self._down_until = 0.0

    async def _call(self, what: str, command: Callable[[], Awaitable[T]], *, gated: bool = True) -> T:
        if gated and time.monotonic() < self._down_until:
            raise BusUnavailable(f"{what}: the bus failed within the last {BUS_RETRY_AFTER_S:.0f}s")
        try:
            async with asyncio.timeout(BUS_CALL_TIMEOUT_S):
                return await command()
        except Exception as exc:
            self._mark_down(what, exc)
            raise BusUnavailable(f"{what}: {exc!r}") from exc

    def _mark_down(self, what: str, exc: Exception) -> None:
        logger.warning("Conversation bus %s failed (%r); refusing bus commands for %.0fs", what, exc, BUS_RETRY_AFTER_S)
        self._down_until = time.monotonic() + BUS_RETRY_AFTER_S

    async def publish_frame(self, conv: str, frame: dict[str, Any]) -> None:
        env = Envelope(conv=conv, type=FRAME, payload=frame, origin=self.replica_id).encode()

        async def append_and_publish() -> None:
            await self._t.xadd(_STREAM.format(id=conv), env, _STREAM_MAXLEN, _STREAM_TTL_SECONDS)
            await self._t.publish(_EVENTS.format(id=conv), env)

        await self._call("publish_frame", append_and_publish)

    async def subscribe_frames(self, conv: str, ready: asyncio.Event | None = None) -> AsyncIterator[Envelope]:
        async for raw in self._t.subscribe(_EVENTS.format(id=conv), ready):
            env = Envelope.decode(raw)
            if env.origin == self.replica_id:
                continue
            yield env

    async def replay_turn(self, conv: str, turn_id: str) -> list[dict[str, Any]]:
        raws = await self._call("replay_turn", lambda: self._t.xrange(_STREAM.format(id=conv)))
        frames = [Envelope.decode(raw).payload for raw in raws]
        mine = [frame for frame in frames if isinstance(frame, dict) and frame.get("turn_id") == turn_id]
        return sorted(mine, key=lambda frame: frame["seq"])

    async def claim_turn(self, conv: str, turn_id: str) -> bool:
        key = _TURN.format(id=conv, turn=turn_id)
        return await self._call("claim_turn", lambda: self._t.set_nx(key, self.replica_id, _STREAM_TTL_SECONDS))

    async def release_turn(self, conv: str, turn_id: str) -> bool:
        key = _TURN.format(id=conv, turn=turn_id)
        return await self._call("release_turn", lambda: self._t.delete_if_value(key, self.replica_id))

    def _running_value(self, turn_id: str) -> str:
        return json.dumps({"replica": self.replica_id, "turn_id": turn_id}, sort_keys=True)

    async def acquire_running(self, conv: str, turn_id: str) -> bool:
        key = _RUNNING.format(id=conv)
        return await self._call(
            "acquire_running", lambda: self._t.set_nx(key, self._running_value(turn_id), RUNNING_TTL_SECONDS)
        )

    async def running_holder(self, conv: str) -> RunningMarker | None:
        raw = await self._call("running_holder", lambda: self._t.get(_RUNNING.format(id=conv)))
        return RunningMarker.decode(raw) if raw else None

    async def renew_running(self, conv: str, turn_id: str) -> bool:
        key = _RUNNING.format(id=conv)
        return await self._call(
            "renew_running",
            lambda: self._t.expire_if_value(key, self._running_value(turn_id), RUNNING_TTL_SECONDS),
            gated=False,
        )

    async def release_running(self, conv: str, turn_id: str) -> bool:
        key = _RUNNING.format(id=conv)
        return await self._call("release_running", lambda: self._t.delete_if_value(key, self._running_value(turn_id)))

    async def publish_input(self, conv: str, input_type: str, payload: dict[str, Any]) -> None:
        env = Envelope(conv=conv, type=input_type, payload=payload, origin=self.replica_id)
        await self._call("publish_input", lambda: self._t.publish(_INPUT.format(id=conv), env.encode()))

    async def subscribe_input(self, conv: str) -> AsyncIterator[Envelope]:
        async for raw in self._t.subscribe(_INPUT.format(id=conv)):
            yield Envelope.decode(raw)

    async def close(self) -> None:
        await self._t.close()


_bus: ConversationBus | None = None
_in_memory_singleton: InMemoryTransport | None = None
_force_multi_for_tests = False


def _bus_enabled() -> bool:
    val = os.environ.get("CONVERSATION_BUS", "1").strip().lower()
    return val not in ("0", "false", "no", "off", "")


def get_bus() -> ConversationBus:
    global _bus, _in_memory_singleton
    if _bus is not None:
        return _bus
    url = os.environ.get("REDIS_URL")
    if _bus_enabled() and url:
        try:
            _bus = ConversationBus(RedisTransport(url))
            logger.info("Conversation bus: Redis transport (multi-replica stateless mode)")
            return _bus
        except Exception:
            logger.warning("Conversation bus: Redis init failed; using in-process fallback", exc_info=True)
    if _in_memory_singleton is None:
        _in_memory_singleton = InMemoryTransport()
    _bus = ConversationBus(_in_memory_singleton)
    return _bus


def is_multi_replica_bus() -> bool:
    return _force_multi_for_tests or (_bus_enabled() and bool(os.environ.get("REDIS_URL")))


def force_multi_replica_for_tests(transport: InMemoryTransport | None = None) -> ConversationBus:
    global _bus, _in_memory_singleton, _force_multi_for_tests
    _in_memory_singleton = transport or InMemoryTransport()
    _bus = ConversationBus(_in_memory_singleton, replica_id="test-owner")
    _force_multi_for_tests = True
    return _bus


def reset_bus_for_tests() -> None:
    global _bus, _in_memory_singleton, _force_multi_for_tests
    _bus = None
    _in_memory_singleton = None
    _force_multi_for_tests = False
