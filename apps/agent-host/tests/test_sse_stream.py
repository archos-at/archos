from __future__ import annotations

import asyncio
import json
import sys
import types
from types import SimpleNamespace
from unittest.mock import AsyncMock
from unittest.mock import MagicMock

import pytest

from agent_host.jobs.connection_manager import reset_connection_manager
from agent_host.jobs.event_store import EventStore
from agent_host.routes import job_event_stream

DIRECT_DSN = "postgresql://agent:pw@grid-pg-rw:5432/jobs"  # pragma: allowlist secret


@pytest.fixture
def db_url(tmp_path):
    return f"sqlite+aiosqlite:///{tmp_path / 'test_sse_stream.db'}"


@pytest.fixture(autouse=True)
def clear_state():
    EventStore._tables_initialized.clear()
    reset_connection_manager()
    yield
    EventStore._tables_initialized.clear()
    reset_connection_manager()


class FakeListenConnection:
    def __init__(self):
        self.handler = None
        self.channel = None

    async def add_listener(self, channel, handler):
        self.channel = channel
        self.handler = handler

    async def remove_listener(self, channel, handler):
        pass

    async def close(self):
        pass


@pytest.mark.asyncio
async def test_notification_gap_recovered_by_range_fetch_and_terminal_drain(db_url, monkeypatch):

    fake_conn = FakeListenConnection()
    fake_asyncpg = types.SimpleNamespace(connect=AsyncMock(return_value=fake_conn))
    monkeypatch.setitem(sys.modules, "asyncpg", fake_asyncpg)
    monkeypatch.setenv("LISTEN_DB_URL", DIRECT_DSN)

    job_id = "sse-job"
    store = EventStore(db_url, job_id)

    running = SimpleNamespace(status="running", error=None)
    success = SimpleNamespace(status="success", error=None)
    job_store = SimpleNamespace(get_job=AsyncMock(side_effect=[running, success]))

    gen = job_event_stream._sse_generator_postgres(job_store, job_id, db_url, 0)

    first = await asyncio.wait_for(gen.__anext__(), timeout=5.0)
    assert "stream.mode" in first

    pending = asyncio.ensure_future(gen.__anext__())
    await asyncio.sleep(0.3)
    store.store({"type": "step.one", "data": {}})
    store.store({"type": "step.two", "data": {}})
    store.store({"type": "step.three", "data": {}})
    last_id = EventStore.get_events(db_url, job_id)[-1]["_id"]
    fake_conn.handler(None, 1234, fake_conn.channel, json.dumps({"id": last_id}))

    chunk1 = await asyncio.wait_for(pending, timeout=5.0)
    chunk2 = await asyncio.wait_for(gen.__anext__(), timeout=5.0)
    chunk3 = await asyncio.wait_for(gen.__anext__(), timeout=5.0)
    assert "event: step.one" in chunk1
    assert "event: step.two" in chunk2
    assert "event: step.three" in chunk3

    status_chunk = await asyncio.wait_for(gen.__anext__(), timeout=5.0)
    assert "event: job.status" in status_chunk
    assert '"status": "success"' in status_chunk

    store.store({"type": "artifact.update", "data": {"type": "output", "content": "final report"}})
    final_chunk = await asyncio.wait_for(gen.__anext__(), timeout=5.0)
    assert "event: artifact.update" in final_chunk
    assert "final report" in final_chunk

    with pytest.raises(StopAsyncIteration):
        await asyncio.wait_for(gen.__anext__(), timeout=5.0)


@pytest.mark.asyncio
async def test_listen_connects_to_the_direct_dsn_never_the_job_store_url(db_url, monkeypatch):

    connect = AsyncMock(return_value=FakeListenConnection())
    monkeypatch.setitem(sys.modules, "asyncpg", types.SimpleNamespace(connect=connect))
    monkeypatch.setenv("LISTEN_DB_URL", DIRECT_DSN)
    job_store = SimpleNamespace(get_job=AsyncMock(return_value=SimpleNamespace(status="running", error=None)))

    gen = job_event_stream._sse_generator_postgres(job_store, "sse-job", db_url, 0)
    await asyncio.wait_for(gen.__anext__(), timeout=5.0)
    await gen.aclose()

    connect.assert_awaited_once_with("postgres://agent:pw@grid-pg-rw:5432/jobs")  # pragma: allowlist secret


@pytest.mark.asyncio
async def test_the_stream_never_listens_on_the_job_store_url(db_url, monkeypatch):

    connect = AsyncMock()
    monkeypatch.setitem(sys.modules, "asyncpg", types.SimpleNamespace(connect=connect))
    monkeypatch.delenv("LISTEN_DB_URL", raising=False)

    gen = job_event_stream._sse_generator_postgres(MagicMock(), "sse-job", db_url, 0)
    with pytest.raises(KeyError, match="LISTEN_DB_URL"):
        await gen.__anext__()

    connect.assert_not_awaited()


@pytest.mark.asyncio
async def test_pubsub_midstream_failure_resumes_polling_from_last_yielded_event(monkeypatch):

    resume: dict = {}

    async def fake_postgres(job_store, job_id, db_url, start_event_id=0, progress=None):
        assert progress is not None
        progress["last_event_id"] = 42
        yield "id: 42\nevent: step.one\ndata: {}\n\n"
        raise RuntimeError("connection dropped mid-stream")

    async def fake_polling(job_store, job_id, db_url, start_event_id=0):
        resume["start_event_id"] = start_event_id
        yield "id: 43\nevent: step.two\ndata: {}\n\n"

    monkeypatch.setattr(job_event_stream, "_sse_generator_postgres", fake_postgres)
    monkeypatch.setattr(job_event_stream, "_sse_generator_polling", fake_polling)

    chunks = [
        chunk
        async for chunk in job_event_stream.sse_generator(MagicMock(), "job-1", "postgresql://db/x", start_event_id=5)
    ]

    assert resume["start_event_id"] == 42
    assert len(chunks) == 2


@pytest.mark.asyncio
async def test_pubsub_failure_before_any_event_resumes_from_start_event_id(monkeypatch):

    resume: dict = {}

    async def fake_postgres(job_store, job_id, db_url, start_event_id=0, progress=None):
        raise RuntimeError("could not connect")
        yield  # pragma: no cover - makes this an async generator

    async def fake_polling(job_store, job_id, db_url, start_event_id=0):
        resume["start_event_id"] = start_event_id
        yield "id: 5\nevent: stream.mode\ndata: {}\n\n"

    monkeypatch.setattr(job_event_stream, "_sse_generator_postgres", fake_postgres)
    monkeypatch.setattr(job_event_stream, "_sse_generator_polling", fake_polling)

    chunks = [
        chunk
        async for chunk in job_event_stream.sse_generator(MagicMock(), "job-1", "postgresql://db/x", start_event_id=5)
    ]

    assert resume["start_event_id"] == 5
    assert len(chunks) == 1


@pytest.mark.asyncio
async def test_a_silent_stream_sends_a_keepalive_instead_of_going_byte_quiet(db_url, monkeypatch):

    monkeypatch.setattr(job_event_stream, "SSE_KEEPALIVE_SECONDS", 0.0)

    job_id = "sse-quiet-job"
    running = SimpleNamespace(status="running", error=None)
    job_store = SimpleNamespace(get_job=AsyncMock(return_value=running))

    gen = job_event_stream._sse_generator_polling(job_store, job_id, db_url, 0)
    try:
        chunks = []
        for _ in range(4):
            chunks.append(await asyncio.wait_for(gen.__anext__(), timeout=5.0))

        assert any(chunk == job_event_stream.SSE_KEEPALIVE_FRAME for chunk in chunks), chunks
        assert job_event_stream.SSE_KEEPALIVE_FRAME.startswith(":")
    finally:
        await gen.aclose()


@pytest.mark.asyncio
async def test_a_stream_carrying_real_events_sends_no_keepalives(db_url, monkeypatch):

    monkeypatch.setattr(job_event_stream, "SSE_KEEPALIVE_SECONDS", 0.0)

    job_id = "sse-busy-job"
    store = EventStore(db_url, job_id)
    for index in range(3):
        store.store({"type": f"step.{index}", "data": {}})

    running = SimpleNamespace(status="running", error=None)
    job_store = SimpleNamespace(get_job=AsyncMock(return_value=running))

    gen = job_event_stream._sse_generator_polling(job_store, job_id, db_url, 0)
    try:
        chunks = []
        for _ in range(4):
            chunks.append(await asyncio.wait_for(gen.__anext__(), timeout=5.0))

        assert not any(chunk == job_event_stream.SSE_KEEPALIVE_FRAME for chunk in chunks), chunks
        for index in range(3):
            assert any(f"event: step.{index}" in chunk for chunk in chunks), chunks
    finally:
        await gen.aclose()
