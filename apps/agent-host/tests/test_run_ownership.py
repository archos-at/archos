"""One run of a research job at a time, and a timeout that ends as FAILURE (ADR-0150).

Hatchet delivers at least once: a copy of a run can start while another is
alive. ``run_ownership`` lets exactly one run the agent; the job store is real
(SQLite), so the compare-and-set runs as it does in production. And a run that
Hatchet stops at its execution timeout is told apart from a person's cancel by
what the cancel route wrote.
"""

from __future__ import annotations

from datetime import UTC
from datetime import datetime
from datetime import timedelta

import pytest

from agent_host.jobs import agent_job
from agent_host.jobs import payload_crypto
from agent_host.jobs import run_ownership
from agent_host.jobs import worker as worker_mod
from agent_host.jobs.agent_job import JobRequest
from agent_host.jobs.agent_job import JobScope
from agent_host.jobs.agent_job import RunStoppedError
from agent_host.jobs.event_store import EventStore
from agent_host.jobs.runner import sanitize_job_error


@pytest.fixture
def db_url(tmp_path):
    from nat.front_ends.fastapi.async_jobs.job_store import Base

    EventStore._tables_initialized.clear()
    url = f"sqlite+aiosqlite:///{tmp_path / 'jobs.db'}"
    Base.metadata.create_all(EventStore._get_or_create_sync_engine(url))
    yield url
    EventStore._tables_initialized.clear()


def _store(db_url: str):
    from nat.front_ends.fastapi.async_jobs.job_store import JobStore

    return JobStore(scheduler_address="", db_url=db_url)


async def _job(db_url: str, status: str = "submitted", *, silent_for: timedelta | None = None) -> None:
    from sqlalchemy import update

    from nat.front_ends.fastapi.async_jobs.job_store import JobInfo

    store = _store(db_url)
    await store._create_job(job_id="job-1", expiry_seconds=3600)
    stamp = datetime.now(UTC) - (silent_for or timedelta(0))
    async with store.session() as session:
        await session.execute(update(JobInfo).where(JobInfo.job_id == "job-1").values(status=status, updated_at=stamp))
    EventStore._ensure_table_exists(db_url)


async def _status(db_url: str) -> str:
    return (await _store(db_url).get_job("job-1")).status


async def test_a_waiting_job_is_taken_once_and_the_second_copy_loses(db_url):
    await _job(db_url)

    first = await run_ownership.try_take(_store(db_url), "job-1")
    second = await run_ownership.try_take(_store(db_url), "job-1")

    assert (first, second) == (run_ownership.Verdict.TAKEN, run_ownership.Verdict.ALIVE)
    assert await _status(db_url) == "running"


async def test_a_running_job_whose_run_went_silent_is_taken_over_once(db_url):
    """A retry after a worker died: the previous attempt never finished and has been silent past the window."""
    await _job(db_url, "running", silent_for=timedelta(seconds=run_ownership.STALE_SECONDS + 5))

    rescue = await run_ownership.try_take(_store(db_url), "job-1")
    late = await run_ownership.try_take(_store(db_url), "job-1")

    assert (rescue, late) == (run_ownership.Verdict.TAKEN, run_ownership.Verdict.ALIVE)


async def test_a_recent_event_keeps_a_quiet_job_alive(db_url):
    await _job(db_url, "running", silent_for=timedelta(seconds=run_ownership.STALE_SECONDS + 5))
    EventStore(db_url, "job-1").store({"type": "job.heartbeat", "data": {}})

    assert await run_ownership.try_take(_store(db_url), "job-1") is run_ownership.Verdict.ALIVE


async def test_the_ghost_reaper_leaves_a_job_a_retry_just_took_over(db_url):
    """The rescue writes no event until its workflow is built; the reaper must read the takeover as life."""
    from sqlalchemy import text

    from agent_host.routes import job_reaper

    silent = run_ownership.STALE_SECONDS + 5
    await _job(db_url, "running", silent_for=timedelta(seconds=silent))
    EventStore(db_url, "job-1").store({"type": "job.heartbeat", "data": {}})
    stamp = (datetime.now(UTC) - timedelta(seconds=silent)).replace(tzinfo=None)
    with EventStore._get_or_create_sync_engine(db_url).begin() as conn:
        conn.execute(text("UPDATE job_events SET created_at = :stamp"), {"stamp": stamp})
    assert job_reaper._find_stale_jobs(db_url, ("running",)) == ["job-1"]

    assert await run_ownership.try_take(_store(db_url), "job-1") is run_ownership.Verdict.TAKEN

    assert job_reaper._find_stale_jobs(db_url, ("running",)) == []


def test_a_waiting_retry_takes_a_dead_run_before_the_reaper_fails_it():
    """One window, and a retry that waits past it: the reaper may not call a run dead before a retry may take it."""
    from agent_host.routes import job_reaper

    assert run_ownership.STALE_SECONDS == job_reaper.GHOST_JOB_TIMEOUT_SECONDS
    assert run_ownership.WAIT_SECONDS > run_ownership.STALE_SECONDS + run_ownership._POLL_SECONDS


@pytest.mark.parametrize("status", ["success", "failure", "interrupted"])
async def test_a_finished_job_is_never_taken(db_url, status):
    await _job(db_url, status)

    assert await run_ownership.try_take(_store(db_url), "job-1") is run_ownership.Verdict.GONE
    assert await _status(db_url) == status


async def test_the_losing_copy_returns_without_running_the_agent(db_url, monkeypatch):
    """The duplicate Hatchet delivered: another copy is running the job, so this one runs nothing."""
    await _job(db_url, "running")
    monkeypatch.setattr(run_ownership, "WAIT_SECONDS", 0)
    ran: list[dict] = []

    async def agent(**kwargs):
        ran.append(kwargs)

    monkeypatch.setattr(worker_mod, "run_agent_job", agent)
    stored = payload_crypto.serialize_encrypted({"job_id": "job-1", "db_url": db_url, "input_text": "q"})

    assert await worker_mod.run_stored_job(db_url, "job-1", stored, attempt=1) is False
    assert ran == []
    assert await worker_mod.run_stored_job(db_url, "job-2", stored, attempt=1) is False  # no such job


# ---------------------------------------------------------------- the timeout verdict


def _request(db_url: str) -> JobRequest:
    return JobRequest(
        db_url=db_url,
        config_file_path="c.yml",
        job_id="job-1",
        input_text="q",
        agent_class_path="pkg.Agent",
        agent_config_name="deep_research_agent",
    )


@pytest.fixture
def verdicts(monkeypatch) -> list[str]:
    seen: list[str] = []

    async def failed(_scope, _request, exc):
        seen.append(f"failed:{sanitize_job_error(exc)}")

    async def cancelled(**_kwargs):
        seen.append("cancelled by user")

    monkeypatch.setattr(agent_job, "finish_failed", failed)
    monkeypatch.setattr(agent_job, "_finalize_cancelled_run", cancelled)
    return seen


async def test_a_cancel_nobody_recorded_is_the_timeout_and_ends_as_failure(db_url, verdicts):
    await _job(db_url, "running")

    await agent_job._finish_cancelled(JobScope(), _request(db_url))

    assert verdicts == [f"failed:{sanitize_job_error(RunStoppedError())}"]
    assert "Zeitlimit" in verdicts[0]


async def test_a_cancel_the_route_recorded_stays_a_cancel(db_url, verdicts):
    await _job(db_url, "interrupted")

    await agent_job._finish_cancelled(JobScope(), _request(db_url))

    assert verdicts == ["cancelled by user"]
