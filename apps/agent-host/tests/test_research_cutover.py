"""The old research claim queue moves onto Hatchet from the agent-worker, as ingest's does (ADR-0150).

The table is the real one: ``research_job_queue`` made and claimed by the claim
substrate the old release ran (``agent.common.claim_queue``), so a claim here is
the old worker's own SQL. Hatchet is faked at ``research_workflow.start``. The
Postgres branch (``TEST_POSTGRES_URL``, ``task be:test:postgres``) adds the
one thing SQLite cannot show: a row the cutover holds is skipped by the old
claim and by a second cutover.
"""

from __future__ import annotations

import asyncio
import os

import pytest
from sqlalchemy import text

from agent.common import claim_queue
from agent_host.jobs import orchestrator_runs
from agent_host.jobs import payload_crypto
from agent_host.jobs import requeue_legacy
from agent_host.jobs import research_workflow
from agent_host.jobs.event_store import EventStore

_POSTGRES = os.environ.get("TEST_POSTGRES_URL")
_TABLES = ("research_job_queue", "research_lane_turns", "job_info", "research_orchestrator_runs")
OLD_CLAIM = {"stale_seconds": 90, "max_attempts": 3}


def test_the_postgres_branch_ran_where_it_is_required():
    """CI's ``task be:test:postgres`` sets the guard: there a missing database fails instead of skipping green."""
    if os.environ.get("TEST_POSTGRES_REQUIRED"):
        assert _POSTGRES, "TEST_POSTGRES_URL is unset while TEST_POSTGRES_REQUIRED is set"


@pytest.fixture(
    params=[
        "sqlite",
        pytest.param("postgres", marks=pytest.mark.skipif(not _POSTGRES, reason="TEST_POSTGRES_URL not set")),
    ]
)
def db_url(request, tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'jobs.db'}" if request.param == "sqlite" else _POSTGRES
    monkeypatch.setenv("NAT_JOB_STORE_DB_URL", url)
    monkeypatch.delenv(requeue_legacy.DRAIN_ENV, raising=False)
    orchestrator_runs._ensured.clear()
    with EventStore._get_or_create_sync_engine(url).begin() as conn:
        for table in _TABLES:
            conn.execute(text(f"DROP TABLE IF EXISTS {table}"))
        conn.execute(text("CREATE TABLE job_info (job_id TEXT PRIMARY KEY, status TEXT)"))
    yield url
    orchestrator_runs._ensured.clear()


@pytest.fixture
def old_queue(db_url) -> claim_queue.ClaimQueue:
    """The old release's research queue, on the real table name and the real claim SQL."""
    queue = claim_queue.ClaimQueue(
        name="research",
        table="research_job_queue",
        turns_table="research_lane_turns",
        db_url=lambda: db_url,
        engine_for=EventStore._get_or_create_sync_engine,
        reap_lock_id=0x41495152_58485300,
    )
    queue.ensure_table(db_url)
    return queue


@pytest.fixture
def started(monkeypatch) -> dict[str, tuple[str | None, str | None]]:
    runs: dict[str, tuple[str | None, str | None]] = {}

    async def start(db_url, job_id, payload, organization_id, priority):
        assert "claim_owner" in payload  # replayed as stored; the worker drops it
        runs[job_id] = (organization_id, priority)
        orchestrator_runs.record(db_url, job_id, f"run-{job_id}")
        return f"run-{job_id}"

    monkeypatch.setattr(research_workflow, "start", start)
    return runs


def _payload() -> str:
    return payload_crypto.serialize_encrypted({"job_id": "x", "input_text": "Atrium", "claim_owner": "host:1"})


def _enqueue(queue, db_url: str, job_id: str, lane: str = "org-a", priority: str | None = None, status="submitted"):
    queue.enqueue(job_id, lane, _payload(), priority)
    with EventStore._get_or_create_sync_engine(db_url).begin() as conn:
        conn.execute(text("INSERT INTO job_info VALUES (:j, :s)"), {"j": job_id, "s": status})


def _silent_for(db_url: str, job_id: str, column: str, minutes: int) -> None:
    """Move one claim timestamp ``minutes`` into the past."""
    engine = EventStore._get_or_create_sync_engine(db_url)
    past = (
        f"NOW() - make_interval(mins => {minutes})"
        if engine.dialect.name == "postgresql"
        else f"datetime('now', '-{minutes} minutes')"
    )
    with engine.begin() as conn:
        conn.execute(text(f"UPDATE research_job_queue SET {column} = {past} WHERE job_id = :j"), {"j": job_id})


def _left(db_url: str) -> dict[str, str]:
    with EventStore._get_or_create_sync_engine(db_url).connect() as conn:
        return dict(conn.execute(text("SELECT job_id, status FROM research_job_queue")).all())


async def test_a_queued_row_is_started_with_its_organization_and_priority_and_deleted(db_url, old_queue, started):
    _enqueue(old_queue, db_url, "job-a", "org-a", "bulk")
    _enqueue(old_queue, db_url, "job-b", "__platform__")

    result = await requeue_legacy.requeue(db_url)

    assert sorted(result.started) == ["job-a", "job-b"]
    assert started == {"job-a": ("org-a", "bulk"), "job-b": (None, "interactive")}
    assert _left(db_url) == {}
    assert (await requeue_legacy.requeue(db_url)).started == []  # a second pass starts nothing


async def test_a_fresh_claim_stays_with_the_old_worker_that_may_still_run_it(db_url, old_queue, started):
    _enqueue(old_queue, db_url, "job-a")
    assert old_queue.claim_next("old-worker", **OLD_CLAIM).job_id == "job-a"

    result = await requeue_legacy.requeue(db_url)

    assert result.started == [] and started == {}
    assert _left(db_url) == {"job-a": "claimed"}


async def test_a_claim_still_heartbeating_stays_however_old_it_is(db_url, old_queue, started):
    """A draining worker heartbeats the job it runs: an old claim with a fresh heartbeat is still running there."""
    _enqueue(old_queue, db_url, "job-a")
    old_queue.claim_next("old-worker", **OLD_CLAIM)
    _silent_for(db_url, "job-a", "claimed_at", 30)

    assert (await requeue_legacy.requeue(db_url)).started == []


async def test_a_claim_silent_past_the_drain_window_is_moved(db_url, old_queue, started):
    _enqueue(old_queue, db_url, "job-a")
    old_queue.claim_next("old-worker", **OLD_CLAIM)
    _silent_for(db_url, "job-a", "claimed_at", 12)
    _silent_for(db_url, "job-a", "heartbeat_at", 12)  # past 600 + 60 s

    assert (await requeue_legacy.requeue(db_url)).started == ["job-a"]
    assert _left(db_url) == {}


async def test_the_window_follows_the_old_workers_drain_budget(db_url, old_queue, started, monkeypatch):
    monkeypatch.setenv(requeue_legacy.DRAIN_ENV, "1800")
    _enqueue(old_queue, db_url, "job-a")
    old_queue.claim_next("old-worker", **OLD_CLAIM)
    _silent_for(db_url, "job-a", "heartbeat_at", 12)

    assert requeue_legacy.claim_age_floor() == 1860
    assert (await requeue_legacy.requeue(db_url)).started == []


async def test_force_moves_a_fresh_claim_too(db_url, old_queue, started):
    _enqueue(old_queue, db_url, "job-a")
    old_queue.claim_next("old-worker", **OLD_CLAIM)

    assert (await requeue_legacy.requeue(db_url, min_claim_age=0)).started == ["job-a"]


async def test_a_job_already_ended_is_only_deleted(db_url, old_queue, started):
    _enqueue(old_queue, db_url, "job-a", status="interrupted")

    result = await requeue_legacy.requeue(db_url)

    assert result.already_terminal == ["job-a"] and started == {}
    assert _left(db_url) == {}


async def test_a_job_already_on_hatchet_is_not_started_twice(db_url, old_queue, started):
    _enqueue(old_queue, db_url, "job-a")
    orchestrator_runs.record(db_url, "job-a", "run-earlier")

    result = await requeue_legacy.requeue(db_url)

    assert result.already_on_hatchet == ["job-a"] and started == {}
    assert _left(db_url) == {}


async def test_an_unreadable_payload_stays_and_the_pass_goes_on(db_url, old_queue, started):
    old_queue.enqueue("job-bad", "org-a", "enc:garbage")
    _enqueue(old_queue, db_url, "job-a")

    result = await requeue_legacy.requeue(db_url)

    assert result.unreadable == ["job-bad"] and result.started == ["job-a"]
    assert _left(db_url) == {"job-bad": "queued"}


async def test_a_failed_start_leaves_the_row_for_the_next_pass(db_url, old_queue, monkeypatch, caplog):
    _enqueue(old_queue, db_url, "job-a")

    async def unreachable(*_args):
        raise ConnectionError("hatchet away")

    monkeypatch.setattr(research_workflow, "start", unreachable)

    with pytest.raises(ConnectionError):
        await requeue_legacy.requeue(db_url)
    assert _left(db_url) == {"job-a": "queued"}
    assert await requeue_legacy.cut_over(db_url, asyncio.Event()) is True
    assert "Research cutover pass failed (ConnectionError)" in caplog.text
    assert _left(db_url) == {"job-a": "queued"}


async def test_a_pass_reports_work_while_a_claim_waits_for_its_window(db_url, old_queue, started, caplog):
    caplog.set_level("INFO")
    _enqueue(old_queue, db_url, "job-a")
    _enqueue(old_queue, db_url, "job-b")
    old_queue.claim_next("old-worker", **OLD_CLAIM)

    assert await requeue_legacy.cut_over(db_url, asyncio.Event()) is True  # one moved, one waiting
    assert "Research cutover: 1 job(s) moved from research_job_queue to Hatchet" in caplog.text
    assert await requeue_legacy.cut_over(db_url, asyncio.Event()) is True  # the claim still waits


async def test_a_pass_over_an_empty_or_a_dropped_table(db_url, old_queue, started):
    assert await requeue_legacy.cut_over(db_url, asyncio.Event()) is False
    with EventStore._get_or_create_sync_engine(db_url).begin() as conn:
        conn.execute(text("DROP TABLE research_job_queue"))
    assert await requeue_legacy.cut_over(db_url, asyncio.Event()) is None


@pytest.mark.skipif(not _POSTGRES, reason="TEST_POSTGRES_URL not set")
async def test_a_row_the_cutover_holds_is_skipped_by_the_old_claim_and_a_second_cutover(
    db_url, old_queue, started, request
):
    if request.node.callspec.params["db_url"] != "postgres":
        pytest.skip("row locks are Postgres's")
    _enqueue(old_queue, db_url, "job-a")
    holder = EventStore._get_or_create_sync_engine(db_url).connect()
    try:
        assert requeue_legacy._lock_next(holder, 660, set())[0] == "job-a"

        assert old_queue.claim_next("old-worker", **OLD_CLAIM) is None
        assert (await requeue_legacy.requeue(db_url)).started == []
    finally:
        holder.rollback()
        holder.close()
    assert old_queue.claim_next("old-worker", **OLD_CLAIM).job_id == "job-a"


# ---------------------------------------------------------------- the worker's loop


def _passes(monkeypatch, *answers: bool | None) -> list[int]:
    queue = list(answers)
    calls: list[int] = []

    async def cut_over(db_url, stop):
        calls.append(1)
        return queue.pop(0) if queue else False

    monkeypatch.setattr(requeue_legacy, "cut_over", cut_over)
    return calls


async def test_the_loop_keeps_passing_while_there_is_work_and_stops_once_quiet(monkeypatch, caplog):
    caplog.set_level("INFO")
    calls = _passes(monkeypatch, False, True, False, True)

    await asyncio.wait_for(requeue_legacy.cutover_loop("db", asyncio.Event(), every=0.001, quiet_for=0.003), 5)

    assert len(calls) == 7  # four answered, then three quiet passes
    assert "held no job for 0s; no longer checked" in caplog.text


async def test_the_loop_ends_once_the_table_is_gone(monkeypatch, caplog):
    caplog.set_level("INFO")
    calls = _passes(monkeypatch, True, None, True)

    await asyncio.wait_for(requeue_legacy.cutover_loop("db", asyncio.Event(), every=0.001, quiet_for=1.0), 5)

    assert len(calls) == 2
    assert "research_job_queue is gone; no longer checked" in caplog.text


async def test_the_worker_lifespan_runs_the_cutover_and_stops_it(tmp_path, monkeypatch):
    seen: list[str] = []

    async def cutover_loop(db_url, stop):
        seen.append(db_url)
        await stop.wait()
        seen.append("stopped")

    monkeypatch.setenv("WORKER_LIVENESS_FILE", str(tmp_path / "alive"))
    monkeypatch.setenv("NAT_JOB_STORE_DB_URL", "sqlite:///jobs.db")
    monkeypatch.setattr(requeue_legacy, "cutover_loop", cutover_loop)

    lifespan = research_workflow._liveness()
    await lifespan.__anext__()
    await asyncio.sleep(0)
    assert seen == ["sqlite:///jobs.db"]
    await lifespan.aclose()
    assert seen == ["sqlite:///jobs.db", "stopped"]
