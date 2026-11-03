"""``research-run`` on a real Hatchet engine: the main evidence that research runs on Hatchet (ADR-0150).

Runs when ``HATCHET_CLIENT_TOKEN`` and ``HATCHET_CLIENT_HOST_PORT`` are set
(CI runs ``hatchet-lite`` as a service container); skipped otherwise. Each test
gets its own namespace, so its workflow registration (with its own concurrency
cap) and its runs meet nobody else's.

The worker is a real one in a subprocess (``orchestrator_engine_worker.py``):
``research_workflow.run_worker`` registers the task, Hatchet dispatches to it,
and a run goes through ``worker.run_stored_job`` to a stand-in agent that writes
the event store as a run does. The test process submits through
``research_workflow.start`` and cancels through the cancel route's own
``stop_interrupted_job``, against one SQLite job store both processes share.
"""

from __future__ import annotations

import asyncio
import os
import signal
import subprocess
import sys
import time
import uuid
from collections.abc import Callable
from collections.abc import Iterator
from pathlib import Path

import pytest

from agent.common import orchestrator_client
from agent_host.jobs import orchestrator_runs
from agent_host.jobs import research_workflow
from agent_host.jobs.event_store import EventStore

pytestmark = pytest.mark.skipif(
    not (os.environ.get("HATCHET_CLIENT_TOKEN") and os.environ.get("HATCHET_CLIENT_HOST_PORT")),
    reason="needs a Hatchet engine (HATCHET_CLIENT_TOKEN, HATCHET_CLIENT_HOST_PORT)",
)

_WORKER = Path(__file__).with_name("orchestrator_engine_worker.py")


class Engine:
    """One test's namespace on the engine, its job store, and the workers it starts."""

    def __init__(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        self.tmp_path = tmp_path
        self.db_url = f"sqlite+aiosqlite:///{tmp_path / 'jobs.db'}"
        self.env = {
            **os.environ,
            "HATCHET_CLIENT_NAMESPACE": f"research_test_{uuid.uuid4().hex[:12]}",
            "NAT_JOB_STORE_DB_URL": self.db_url,
            "PYTHONPATH": os.pathsep.join(sys.path),
        }
        for name in ("HATCHET_CLIENT_NAMESPACE", "NAT_JOB_STORE_DB_URL"):
            monkeypatch.setenv(name, self.env[name])
        from nat.front_ends.fastapi.async_jobs.job_store import Base

        # The runtime's start-up creates job_info in production; nothing here runs it.
        Base.metadata.create_all(EventStore._get_or_create_sync_engine(self.db_url))
        self.workers: list[subprocess.Popen] = []

    def start_worker(self, **env: str) -> subprocess.Popen:
        liveness = self.tmp_path / f"alive-{len(self.workers)}"
        process = subprocess.Popen(  # noqa: S603 - our own worker script, our own interpreter
            [sys.executable, str(_WORKER)],
            env={**self.env, **env, "WORKER_LIVENESS_FILE": str(liveness)},
        )
        self.workers.append(process)
        _wait_for(liveness.exists, timeout=60, what="the worker to start")
        return process

    def stop(self) -> None:
        for process in self.workers:
            if process.poll() is None:
                process.send_signal(signal.SIGTERM)
        for process in self.workers:
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                process.kill()

    async def submit(self, job_id: str, input_text: str, organization_id: str, priority: str = "interactive") -> str:
        """Persist the job's status row and start its run, as ``submit_agent_job`` does."""
        from nat.front_ends.fastapi.async_jobs.job_store import JobStore

        await JobStore(scheduler_address="", db_url=self.db_url)._create_job(job_id=job_id, expiry_seconds=3600)
        payload = {"job_id": job_id, "db_url": self.db_url, "input_text": input_text, "claim_owner": None}
        deadline = time.monotonic() + 30
        while True:  # the worker registers the workflow a moment after it starts
            try:
                return await research_workflow.start(self.db_url, job_id, payload, organization_id, priority)
            except Exception:
                if time.monotonic() > deadline:
                    raise
                await asyncio.sleep(1)

    def events(self, job_id: str) -> list[dict]:
        return EventStore.get_events(self.db_url, job_id)

    def times(self, job_id: str, event_type: str) -> list[float]:
        return [event["data"]["at"] for event in self.events(job_id) if event["type"] == event_type]

    async def status(self, job_id: str) -> str | None:
        from nat.front_ends.fastapi.async_jobs.job_store import JobStore

        job = await JobStore(scheduler_address="", db_url=self.db_url).get_job(job_id)
        return getattr(job, "status", None)


def _wait_for(predicate: Callable[[], bool], *, timeout: float, what: str) -> None:
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out after {timeout}s waiting for {what}")
        time.sleep(0.5)


@pytest.fixture
def engine(hatchet, tmp_path, monkeypatch) -> Iterator[Engine]:
    """A real client (not the suite's fake) in a namespace of this test's own."""
    on_engine = Engine(tmp_path, monkeypatch)
    orchestrator_client.reset_for_tests(None)
    research_workflow._declared.clear()
    orchestrator_runs._ensured.clear()
    EventStore._tables_initialized.clear()
    try:
        yield on_engine
    finally:
        on_engine.stop()
        orchestrator_client.reset_for_tests(None)
        research_workflow._declared.clear()


async def test_a_research_run_runs_end_to_end_and_its_events_reach_the_event_store(engine):
    engine.start_worker()

    run_id = await engine.submit("job-e2e", "ok", "org-a")

    _wait_for(lambda: engine.times("job-e2e", "test.finished"), timeout=60, what="the run to finish")
    assert await engine.status("job-e2e") == "success"
    assert [event["type"] for event in engine.events("job-e2e")] == ["test.started", "test.finished"]
    assert run_id
    _wait_for(lambda: orchestrator_runs.run_id_for(engine.db_url, "job-e2e") is None, timeout=10, what="the id")
    status = await orchestrator_client.client().runs.aio_get_status(run_id)
    assert status.value == "COMPLETED"


async def test_cancel_stops_a_running_run_and_its_hatchet_run(engine, monkeypatch):
    from agent_host.routes import job_kill

    async def no_bff(**_kwargs):
        return None

    monkeypatch.setattr(job_kill, "notify_job_outcome_from_access", no_bff)
    engine.start_worker()
    run_id = await engine.submit("job-cancel", "sleep:120", "org-a")
    _wait_for(lambda: engine.times("job-cancel", "test.started"), timeout=60, what="the run to start")

    # What the cancel route does: the verdict first, then stop the run.
    from agent_host.jobs.runner import _update_status_if_not_terminal
    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus
    from nat.front_ends.fastapi.async_jobs.job_store import JobStore

    store = JobStore(scheduler_address="", db_url=engine.db_url)
    assert await _update_status_if_not_terminal(store, "job-cancel", JobStatus.INTERRUPTED, error="cancelled by user")
    await job_kill.stop_interrupted_job(engine.db_url, "job-cancel", reason="cancelled by user")

    _wait_for(lambda: engine.times("job-cancel", "test.cancelled"), timeout=30, what="the run to be cancelled")
    assert not engine.times("job-cancel", "test.finished")
    status = await orchestrator_client.client().runs.aio_get_status(run_id)
    assert status.value == "CANCELLED"


async def test_a_run_whose_worker_dies_runs_again_on_another_worker(engine):
    """The retry: the first worker exits mid-run, Hatchet hands the run to the next one."""
    engine.start_worker()
    marker = engine.tmp_path / "first-attempt"

    await engine.submit("job-retry", f"exit-once:{marker}", "org-a")
    _wait_for(marker.exists, timeout=60, what="the first attempt")
    engine.start_worker()

    _wait_for(lambda: engine.times("job-retry", "test.finished"), timeout=180, what="the second attempt")
    assert len(engine.times("job-retry", "test.started")) == 2
    assert await engine.status("job-retry") == "success"


async def test_one_organization_runs_at_most_its_cap_and_another_is_not_held_behind_it(engine):
    engine.start_worker(MAX_ACTIVE_JOBS_PER_ORG="1", RESEARCH_WORKERS="4")

    await engine.submit("a-1", "sleep:4", "org-a", "bulk")
    await engine.submit("a-2", "sleep:4", "org-a", "bulk")
    await engine.submit("b-1", "sleep:4", "org-b")

    _wait_for(
        lambda: all(engine.times(job, "test.finished") for job in ("a-1", "a-2", "b-1")),
        timeout=120,
        what="all three runs",
    )
    (a1_start,), (a1_end,) = engine.times("a-1", "test.started"), engine.times("a-1", "test.finished")
    (a2_start,), (a2_end,) = engine.times("a-2", "test.started"), engine.times("a-2", "test.finished")
    (b1_start,) = engine.times("b-1", "test.started")
    first_end, second_start = sorted([(a1_start, a1_end), (a2_start, a2_end)])[0][1], max(a1_start, a2_start)
    assert second_start >= first_end, "two of org-a's runs overlapped past its cap of one"
    assert b1_start < second_start, "org-b waited behind org-a's second run"
