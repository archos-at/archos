"""Dragonfly (Redis) pub/sub conversation event bus — the stateless-agent target.

A running turn holds loop-bound state in one process: its task, its pending HITL
future, its sequencer (``chat_socket.RunningTurn``). The socket that watches it
may sit on another replica, so the bus decouples two roles (ADR-0028):

* **owner** — the replica running the turn. It appends every stamped v2 frame
  to the conversation's stream and publishes it.
* **relay** — a replica holding a socket for the conversation. It subscribes
  and writes frames to its socket, and hands ``interaction_response`` and
  ``cancel_turn`` to the owner on the input channel, with who sent them, so the
  owner authorises them itself.

Ownership is per turn (``claim_turn``), and a conversation runs ONE turn at a
time across replicas: the owner holds ``conv:<id>:running`` for as long as its
turn runs (:meth:`ConversationBus.acquire_running`, ADR-0080). A newer question
asks the owner to stop with ``SUPERSEDE`` and starts only once the marker is
gone, so two turns never write one LangGraph thread from two replicas.

Spectators (ADR-0039) are one more subscriber of the events channel (the BFF's
``/live`` route), and ``attach`` reads a turn back from the stream by its own
``(turn_id, seq)``.

**Fail-open.** With no ``REDIS_URL`` (dev / single node / tests) the bus uses an
in-process transport: publish delivers to same-process subscribers only, and
the stream is a bounded in-process buffer, which is still enough for ``attach``
on the replica that ran the turn. Nothing here is the source of truth — the
persisted answer is; the stream is best-effort (Dragonfly is cache-only,
ADR-0020).

**Failing fast.** Every command a turn waits on (``publish_frame``,
``replay_turn``, ``publish_input``, ``claim_turn``) is bounded by
``BUS_CALL_TIMEOUT_S`` and raises :class:`BusUnavailable` on any failure. After
one failure the bus stays marked down for ``BUS_RETRY_AFTER_S`` and refuses
without I/O: ``publish_frame`` runs under the turn's sequencer lock for every
delta, and a black-holed Dragonfly used to cost each one the full client
timeout (a second per delta, measured). Callers fail open on
:class:`BusUnavailable`; the long-lived subscriptions are supervised by the
chat registry instead. The one exception is ``renew_running``: it is still
bounded, but always tries, because the turn's deadline is measured from its
last renewal and one slow command for another conversation must not cost
every running turn on this replica its window.

The transport is injectable so the whole protocol is unit-testable over the
in-memory transport with two ``ConversationBus`` instances standing in for two
replicas — no live cluster, no fakeredis dependency.
"""

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
    """The marker's TTL now (read per call, so a test or a restart's new value is the one used)."""
    return RUNNING_TTL_SECONDS


def running_renew_interval() -> float:
    """Renew the running marker four times per TTL, so a missed renewal or two still leaves the owner its window."""
    return max(running_ttl() / 4, 0.01)


class BusUnavailable(ConnectionError):
    """The bus could not be reached for a command, or failed one within the last ``BUS_RETRY_AFTER_S``."""


@dataclass(frozen=True)
class Envelope:
    """A bus message. The frame it carries names its own turn and ``seq``; the
    envelope only routes it (``origin`` lets a replica skip what it published)."""

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
    """The value of ``conv:<id>:running``: the replica and the turn that hold the conversation."""

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
    """Minimal transport the bus needs. Two impls: in-memory and Redis."""

    async def publish(self, channel: str, data: str) -> None: ...
    def subscribe(self, channel: str, ready: asyncio.Event | None = None) -> AsyncIterator[str]:
        """Yield what is published on ``channel``; set ``ready`` once no publish can be missed."""
        ...

    async def xadd(self, stream: str, data: str, maxlen: int, ttl: int) -> None: ...
    async def xrange(self, stream: str) -> list[str]: ...
    async def set_nx(self, key: str, value: str, ttl: int | float) -> bool:
        """Set ``key`` unless it exists, expiring after ``ttl`` seconds. Whether this call set it."""
        ...

    async def get(self, key: str) -> str | None:
        """The value of ``key``, or None when it is not set (or has expired)."""
        ...

    async def expire_if_value(self, key: str, value: str, ttl: int | float) -> bool:
        """Restart ``key``'s expiry, only while it still holds ``value``. Whether it did."""
        ...

    async def delete_if_value(self, key: str, value: str) -> bool:
        """Delete ``key``, only while it still holds ``value``. Whether it did."""
        ...

    async def close(self) -> None: ...


_IN_MEMORY_STREAMS = 256


class InMemoryTransport:
    """Process-local transport. This IS the fail-open / single-node path, and the
    test double for multi-replica (two ConversationBus instances share this one
    module-global broker, so a publish on one is delivered to the other).

    ``clock`` is what a key's TTL is measured on. A test that asserts a key
    outlives its TTL only because it is renewed passes a clock it advances
    itself, so a stalled event loop cannot expire the key between two renewals.
    """

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
    """redis.asyncio-backed transport for real multi-replica operation.

    ``client`` may be injected (a redis.asyncio-compatible client, e.g. fakeredis)
    so the transport is testable against real Redis semantics without a server.
    """

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
        """Run ``write`` on a transaction pipeline only while ``key`` still holds ``value``.

        WATCH/MULTI rather than a Lua script: it is one compare-and-write on
        one key, it needs no scripting engine (fakeredis has none without
        ``lupa``), and Dragonfly runs it. A write that loses the race to
        another replica is a ``WatchError``: the key changed, so it is not ours.
        """
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
    """High-level per-replica handle over a transport. One per process."""

    def __init__(self, transport: BusTransport, replica_id: str | None = None) -> None:
        self._t = transport
        self.replica_id = replica_id or f"{os.environ.get('HOSTNAME', 'local')}:{uuid.uuid4().hex[:8]}"
        self._down_until = 0.0

    async def _call(self, what: str, command: Callable[[], Awaitable[T]], *, gated: bool = True) -> T:
        """Run one bus command, bounded, or refuse it at once while the bus is marked down.

        ``gated=False`` skips the refusal: the command is tried whatever the
        window says, and only its own failure marks the bus down.
        """
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
        """Append a stamped v2 frame to the replay stream, then publish it to relays and spectators."""
        env = Envelope(conv=conv, type=FRAME, payload=frame, origin=self.replica_id).encode()

        async def append_and_publish() -> None:
            await self._t.xadd(_STREAM.format(id=conv), env, _STREAM_MAXLEN, _STREAM_TTL_SECONDS)
            await self._t.publish(_EVENTS.format(id=conv), env)

        await self._call("publish_frame", append_and_publish)

    async def subscribe_frames(self, conv: str, ready: asyncio.Event | None = None) -> AsyncIterator[Envelope]:
        """Relay side: yield outbound frames as they are published by the owner.
        Frames this replica itself published are filtered (owner==relay fast
        path writes the socket directly), preventing double delivery. ``ready``
        is set once the subscription is live, so a replay read after it cannot
        miss a frame published in between."""
        async for raw in self._t.subscribe(_EVENTS.format(id=conv), ready):
            env = Envelope.decode(raw)
            if env.origin == self.replica_id:
                continue
            yield env

    async def replay_turn(self, conv: str, turn_id: str) -> list[dict[str, Any]]:
        """`attach`: every frame of one turn the stream still holds, in ``seq`` order.

        The cursor is the frame's own ``(turn_id, seq)``, so the stream entry id
        never reaches a client and a turn is read back the same from any replica.
        """
        raws = await self._call("replay_turn", lambda: self._t.xrange(_STREAM.format(id=conv)))
        frames = [Envelope.decode(raw).payload for raw in raws]
        mine = [frame for frame in frames if isinstance(frame, dict) and frame.get("turn_id") == turn_id]
        return sorted(mine, key=lambda frame: frame["seq"])

    async def claim_turn(self, conv: str, turn_id: str) -> bool:
        """Claim ``turn_id`` for this replica, cluster-wide. False when a replica already runs (or ran) it.

        The claim lives as long as the replay stream, so a resent question
        whose turn already finished is refused too, and its sender attaches to
        the stream instead of paying for the answer twice.
        """
        key = _TURN.format(id=conv, turn=turn_id)
        return await self._call("claim_turn", lambda: self._t.set_nx(key, self.replica_id, _STREAM_TTL_SECONDS))

    async def release_turn(self, conv: str, turn_id: str) -> bool:
        """Give back a claim this replica made and did not run (an ``if_idle`` question refused as busy)."""
        key = _TURN.format(id=conv, turn=turn_id)
        return await self._call("release_turn", lambda: self._t.delete_if_value(key, self.replica_id))

    def _running_value(self, turn_id: str) -> str:
        return json.dumps({"replica": self.replica_id, "turn_id": turn_id}, sort_keys=True)

    async def acquire_running(self, conv: str, turn_id: str) -> bool:
        """Mark ``turn_id`` as the conversation's running turn, unless another holds it. Whether it was set."""
        key = _RUNNING.format(id=conv)
        return await self._call(
            "acquire_running", lambda: self._t.set_nx(key, self._running_value(turn_id), RUNNING_TTL_SECONDS)
        )

    async def running_holder(self, conv: str) -> RunningMarker | None:
        """Who holds the conversation's running marker now: None when nobody does, or its value is not ours to read."""
        raw = await self._call("running_holder", lambda: self._t.get(_RUNNING.format(id=conv)))
        return RunningMarker.decode(raw) if raw else None

    async def renew_running(self, conv: str, turn_id: str) -> bool:
        """Restart the marker's expiry, while it still names this replica and turn. False once it has been lost.

        Not gated by the fail-fast window: a renewal refused without I/O moves
        the turn's deadline no further, and with ``CHAT_AFFINITY`` off a
        turn whose deadline passes is cancelled. One failed ``publish_frame``
        for any conversation would otherwise cost every turn here its window.
        """
        key = _RUNNING.format(id=conv)
        return await self._call(
            "renew_running",
            lambda: self._t.expire_if_value(key, self._running_value(turn_id), RUNNING_TTL_SECONDS),
            gated=False,
        )

    async def release_running(self, conv: str, turn_id: str) -> bool:
        """Delete the marker the turn ended under, only while it still names this replica and turn."""
        key = _RUNNING.format(id=conv)
        return await self._call("release_running", lambda: self._t.delete_if_value(key, self._running_value(turn_id)))

    async def publish_input(self, conv: str, input_type: str, payload: dict[str, Any]) -> None:
        """Hand a client message to the owner: ``HITL_ANSWER``, ``CANCEL``, ``STEER`` or ``SUPERSEDE``."""
        env = Envelope(conv=conv, type=input_type, payload=payload, origin=self.replica_id)
        await self._call("publish_input", lambda: self._t.publish(_INPUT.format(id=conv), env.encode()))

    async def subscribe_input(self, conv: str) -> AsyncIterator[Envelope]:
        """Owner side: yield answers + control messages from relays."""
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
    """Return the process bus. Redis-backed when enabled + REDIS_URL is set,
    else the in-process fail-open transport (identical to pre-bus behavior)."""
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
    """True when the bus actually spans replicas (Redis-backed + enabled)."""
    return _force_multi_for_tests or (_bus_enabled() and bool(os.environ.get("REDIS_URL")))


def force_multi_replica_for_tests(transport: InMemoryTransport | None = None) -> ConversationBus:
    """Force multi-replica mode over an in-memory transport (tests only). Returns
    the process bus; peers sharing its transport stand in for other replicas."""
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
