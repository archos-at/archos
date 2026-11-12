"""A workflow stream that stops early tears down in the task that built it (#334, #337, #338, #759).

The fixture is the agent runtime's shape, not a mock of our own code: a runner whose
``result_stream`` nests generators with plain ``async for``, each setting a
ContextVar before its ``yield`` and resetting it in its ``finally``, and a step
subject that publishes while the run tears down, as the runtime's FUNCTION_END and
WORKFLOW_END steps do. The agent runtime's own ``generate_streaming_response`` is run through
the same fixture as the oracle: it has to produce the production errors, or the
fixture proves nothing about the fix. Our stream subscribes to no steps (the
chat wire carries only what the turn yields), so the step subject matters to
the oracle alone.
"""

from __future__ import annotations

import asyncio
import contextlib
import contextvars
import gc
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

from agent_host import workflow_stream
from nat.front_ends.fastapi import intermediate_steps_subscriber
from nat.front_ends.fastapi.response_helpers import generate_streaming_response

_LEVEL = contextvars.ContextVar("level", default=None)


class _Chunk:
    """A streamed item: the turn's own body, whatever it is."""

    def __init__(self, n: int) -> None:
        self.n = n


class _Steps:
    """The agent runtime's step subject, reduced to subscribe / publish / complete."""

    def __init__(self) -> None:
        self.observers: list[SimpleNamespace] = []

    def subscribe(self, on_next, on_error=None, on_complete=None):
        observer = SimpleNamespace(on_next=on_next, on_complete=on_complete)
        self.observers.append(observer)
        return SimpleNamespace(unsubscribe=lambda: self.observers.remove(observer))

    def publish(self, step) -> None:
        for observer in list(self.observers):
            observer.on_next(step)

    def complete(self) -> None:
        for observer in list(self.observers):
            if observer.on_complete:
                observer.on_complete()


class _Workflow:
    """A session whose run nests three generators the way the runtime's runner does, and records their teardown."""

    def __init__(self, *, items: int | None = None) -> None:
        self.items = items
        self.steps = _Steps()
        self.torn_down: list[tuple[str, asyncio.Task | None]] = []
        self.workflow = SimpleNamespace(has_streaming_output=True)

    async def _leaf(self):
        token = _LEVEL.set("leaf")
        try:
            n = 0
            while self.items is None or n < self.items:
                await asyncio.sleep(0)  # the innermost await: where a model call would be
                yield _Chunk(n=n)
                n += 1
        finally:
            _LEVEL.reset(token)
            self.torn_down.append(("leaf", asyncio.current_task()))
            self.steps.publish(SimpleNamespace(name="FUNCTION_END"))

    async def _level(self, name, inner):
        token = _LEVEL.set(name)
        try:
            async for item in inner:
                yield item
        finally:
            _LEVEL.reset(token)
            self.torn_down.append((name, asyncio.current_task()))

    async def _result_stream(self):
        # The agent runtime's runner signals the step stream complete where the result
        # stream ends, not where the session does.
        async for item in self._level("result_stream", self._level("astream", self._leaf())):
            yield item
        self.steps.complete()

    @asynccontextmanager
    async def run(self, payload):
        token = _LEVEL.set("session")
        runner = SimpleNamespace(result_stream=lambda to_type=None: self._result_stream())
        try:
            yield runner
        finally:
            _LEVEL.reset(token)


@pytest.fixture
def workflow(monkeypatch):
    wf = _Workflow()
    context = SimpleNamespace(observability_trace_id=None, intermediate_step_manager=wf.steps)
    monkeypatch.setattr(intermediate_steps_subscriber.Context, "get", staticmethod(lambda: context))
    return wf


@contextlib.contextmanager
def _loop_errors():
    """What reaches the running loop's exception handler: the records the collector forwards to err2issue.

    Installed from the test body, not a fixture: pytest-asyncio may run an
    async fixture on another loop than the test's.
    """
    loop = asyncio.get_running_loop()
    seen: list[dict] = []
    previous = loop.get_exception_handler()
    loop.set_exception_handler(lambda _loop, context: seen.append(context))
    try:
        yield seen
    finally:
        loop.set_exception_handler(previous)


async def _settle(seconds: float = 0.5, *, until=None) -> None:
    """Give abandoned generators time to be finalized and their tasks collected, which is when asyncio reports them.

    The reports trickle in over a few hundred milliseconds, one abandoned level
    at a time, so this is a time window rather than a number of loop ticks.
    """
    loop = asyncio.get_running_loop()
    deadline = loop.time() + seconds
    while loop.time() < deadline and not (until and until()):
        gc.collect()
        await asyncio.sleep(0.02)
    gc.collect()


async def _read_then_stop(stream, count: int = 3) -> list:
    """Take ``count`` items and leave, the way a cancelled turn leaves the socket loop."""
    got = []
    async with contextlib.aclosing(stream) as items:
        async for item in items:
            got.append(item)
            if len(got) == count:
                break
    return got


class _Adapter:
    def process(self, step):
        return step


@pytest.mark.asyncio
async def test_nat_s_own_helper_reproduces_the_production_errors(workflow):
    with _loop_errors() as loop_errors:
        # The oracle. If this stops failing the way production did, the fixture
        # no longer models the agent runtime and the test below proves nothing.
        def reported() -> str:
            return " ".join(f"{context.get('message')} {context.get('exception')!r}" for context in loop_errors)

        nat_stream = generate_streaming_response(
            {"q": 1}, session=workflow, streaming=True, step_adaptor=_Adapter(), output_type=None
        )
        await _read_then_stop(nat_stream)
        await _settle(3, until=lambda: "different Context" in reported() and "QueueClosed" in reported())

        reported = reported()
        assert "was created in a different Context" in reported  # #337, #338, #759
        assert "QueueClosed" in reported  # #334


@pytest.mark.asyncio
@pytest.mark.parametrize("count", [1, 2, 3, 4, 5])
async def test_stopping_early_tears_every_level_down_in_the_producer_task(workflow, count):
    # Each count stops the producer at a different point of its cycle; the
    # scheduler is deterministic, so together they cover every place a
    # cancel can land.
    with _loop_errors() as loop_errors:
        got = await _read_then_stop(workflow_stream.stream_workflow({"q": 1}, session=workflow), count)
        await _settle()

        assert [chunk.n for chunk in got] == list(range(count))
        assert loop_errors == []
        names = [name for name, _ in workflow.torn_down]
        assert names == ["leaf", "astream", "result_stream"]
        # One task for the whole chain, and it is the one that entered it.
        assert len({task for _, task in workflow.torn_down}) == 1


@pytest.mark.asyncio
async def test_a_cancelled_consumer_stops_the_run_the_same_way(workflow):
    with _loop_errors() as loop_errors:
        consumed = asyncio.Event()

        async def consume():
            async with contextlib.aclosing(workflow_stream.stream_workflow({"q": 1}, session=workflow)) as items:
                async for _ in items:
                    consumed.set()

        task = asyncio.create_task(consume())
        await consumed.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        await _settle()

        assert loop_errors == []
        assert [name for name, _ in workflow.torn_down] == ["leaf", "astream", "result_stream"]
        assert len({t for _, t in workflow.torn_down}) == 1


@pytest.mark.asyncio
async def test_a_run_that_finishes_yields_everything_and_nothing_else():
    with _loop_errors() as loop_errors:
        wf = _Workflow(items=2)

        got = [item async for item in workflow_stream.stream_workflow({"q": 1}, session=wf)]
        await _settle()

        # Only what the turn yielded: no step, no observability trace.
        assert [item.n for item in got] == [0, 1]
        assert all(isinstance(item, _Chunk) for item in got)
        assert loop_errors == []


@pytest.mark.asyncio
async def test_a_failed_run_is_raised_to_the_consumer():
    with _loop_errors() as loop_errors:
        wf = _Workflow(items=1)

        @asynccontextmanager
        async def failing_run(payload):
            async def boom(to_type=None):
                yield _Chunk(n=0)
                raise RuntimeError("model call failed")

            yield SimpleNamespace(result_stream=boom)

        wf.run = failing_run
        got = []
        with pytest.raises(RuntimeError, match="model call failed"):
            async for item in workflow_stream.stream_workflow({"q": 1}, session=wf):
                got.append(item)
        await _settle()

        assert [item.n for item in got] == [0]
        assert loop_errors == []


class _AdmittedWorkflow:
    """A session whose workflow takes an admission slot, as ``answer_turn`` does, and whose teardown hangs.

    The hang is the case the teardown bound exists for: a checkpoint flush or a
    call on a dead connection in a ``finally``. It is shielded, as such an await
    would be from the one cancel the stream sends.
    """

    def __init__(self, organization_id: str) -> None:
        self.organization_id = organization_id
        self.admitted = asyncio.Event()
        self.unstuck = asyncio.Event()

    async def _result_stream(self):
        from agent.common.turn_admission import admit_turn_async

        async with admit_turn_async(self.organization_id):
            self.admitted.set()
            try:
                while True:
                    await asyncio.sleep(0)
                    yield _Chunk(n=0)
            finally:
                await asyncio.shield(self.unstuck.wait())

    @asynccontextmanager
    async def run(self, payload):
        yield SimpleNamespace(result_stream=lambda to_type=None: self._result_stream())


@pytest.mark.asyncio
async def test_a_turn_whose_teardown_hangs_gives_its_admission_slot_back_when_it_ends(monkeypatch):
    """dev, 2026-11-12: an organization was told "several answers in progress" with nothing running.

    The slot was taken inside the workflow and renewed by it, so a teardown the
    stream stopped waiting for kept it for as long as the teardown ran, with no
    bound at all. Now the stream hands it back when the turn ends.
    """
    from agent.common import turn_admission

    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setattr(turn_admission, "MAX_ACTIVE_TURNS", 10)
    monkeypatch.setattr(turn_admission, "MAX_ACTIVE_TURNS_PER_ORG", 1)
    monkeypatch.setattr(turn_admission, "TURN_LEASE_SECONDS", 0.3)  # renewed every 0.1 s
    monkeypatch.setattr(workflow_stream, "PRODUCER_TEARDOWN_SECONDS", 0.05)
    turn_admission.reset_local_slots()
    wf = _AdmittedWorkflow("org_1")
    try:
        await _read_then_stop(workflow_stream.stream_workflow({"q": 1}, session=wf), count=2)
        assert wf.admitted.is_set()
        # At once, well inside a lease: the slot was given back, not left to age out.
        with turn_admission.admit_turn("org_1"):
            pass
        await asyncio.sleep(0.5)  # longer than a lease: only a renewal could still hold the slot

        with turn_admission.admit_turn("org_1"):  # refused while the slot was the teardown's
            pass
    finally:
        wf.unstuck.set()
        await _settle(0.2)
        turn_admission.reset_local_slots()


@pytest.mark.asyncio
async def test_a_second_cancel_during_the_teardown_wait_still_gives_the_slot_back(monkeypatch):
    """A Stop pressed again, or a supersede the owner republishes every 2 s, cancels the consumer a second time.

    That cancel ends the wait for the producer's teardown with CancelledError;
    the slots must go back on that path too.
    """
    from agent.common import turn_admission

    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setattr(turn_admission, "MAX_ACTIVE_TURNS", 10)
    monkeypatch.setattr(turn_admission, "MAX_ACTIVE_TURNS_PER_ORG", 1)
    monkeypatch.setattr(turn_admission, "TURN_LEASE_SECONDS", 0.3)
    monkeypatch.setattr(workflow_stream, "PRODUCER_TEARDOWN_SECONDS", 1.0)
    turn_admission.reset_local_slots()
    wf = _AdmittedWorkflow("org_1")

    async def consume() -> None:
        async with contextlib.aclosing(workflow_stream.stream_workflow({"q": 1}, session=wf)) as items:
            async for _ in items:
                pass

    task = asyncio.create_task(consume())
    try:
        await wf.admitted.wait()
        await asyncio.sleep(0.05)
        task.cancel()  # the Stop
        await asyncio.sleep(0.2)  # inside the teardown wait
        task.cancel()  # the second cancel
        with pytest.raises(asyncio.CancelledError):
            await task
        with turn_admission.admit_turn("org_1"):
            pass
        await asyncio.sleep(0.5)  # longer than a lease: no renewal holds it either
        with turn_admission.admit_turn("org_1"):
            pass
    finally:
        wf.unstuck.set()
        await _settle(0.2)
        turn_admission.reset_local_slots()
