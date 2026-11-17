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
    def __init__(self, n: int) -> None:
        self.n = n


class _Steps:
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
    loop = asyncio.get_running_loop()
    seen: list[dict] = []
    previous = loop.get_exception_handler()
    loop.set_exception_handler(lambda _loop, context: seen.append(context))
    try:
        yield seen
    finally:
        loop.set_exception_handler(previous)


async def _settle(seconds: float = 0.5, *, until=None) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + seconds
    while loop.time() < deadline and not (until and until()):
        gc.collect()
        await asyncio.sleep(0.02)
    gc.collect()


async def _read_then_stop(stream, count: int = 3) -> list:
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
    with _loop_errors() as loop_errors:
        got = await _read_then_stop(workflow_stream.stream_workflow({"q": 1}, session=workflow), count)
        await _settle()

        assert [chunk.n for chunk in got] == list(range(count))
        assert loop_errors == []
        names = [name for name, _ in workflow.torn_down]
        assert names == ["leaf", "astream", "result_stream"]
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
