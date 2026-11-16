from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import text

from agent_host.jobs.event_store import EventStore
from agent_host.jobs.runner import _current_job_status
from agent_host.jobs.runner import _should_write_notice
from agent_host.jobs.runner import _update_status_if_not_terminal


@pytest.fixture
def db_url(tmp_path):
    url = f"sqlite+aiosqlite:///{tmp_path / 'write_gating.db'}"
    _ensure_job_info_table(url)
    yield url
    EventStore._tables_initialized.discard(url)


@pytest.fixture(autouse=True)
def clear_engine_caches():
    EventStore._tables_initialized.clear()
    yield
    EventStore._tables_initialized.clear()


def _ensure_job_info_table(db_url: str) -> None:
    engine = EventStore._get_or_create_sync_engine(db_url)
    with engine.connect() as conn:
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS job_info ("
                "  job_id TEXT PRIMARY KEY,"
                "  status TEXT,"
                "  config_file TEXT,"
                "  error TEXT,"
                "  output_path TEXT,"
                "  created_at DATETIME,"
                "  updated_at DATETIME,"
                "  expiry_seconds INTEGER,"
                "  output TEXT,"
                "  is_expired BOOLEAN DEFAULT 0"
                ")"
            )
        )
        conn.commit()


def _seed_job(db_url: str, job_id: str, status: str) -> None:
    from datetime import UTC
    from datetime import datetime
    from datetime import timedelta

    engine = EventStore._get_or_create_sync_engine(db_url)
    ts = (datetime.now(UTC) - timedelta(seconds=10)).replace(tzinfo=None)
    with engine.connect() as conn:
        conn.execute(
            text(
                "INSERT OR REPLACE INTO job_info "
                "(job_id, status, created_at, updated_at, expiry_seconds, is_expired) "
                "VALUES (:job_id, :status, :ts, :ts, 3600, 0)"
            ),
            {"job_id": job_id, "status": status, "ts": ts},
        )
        conn.commit()


def _make_store(db_url: str):
    from nat.front_ends.fastapi.async_jobs.job_store import JobStore

    return JobStore(scheduler_address="", db_url=db_url)


def _fake_store(status: str | None = None, exc: BaseException | None = None):
    if exc is not None:
        return SimpleNamespace(get_job=AsyncMock(side_effect=exc))
    job = SimpleNamespace(status=status) if status is not None else None
    return SimpleNamespace(get_job=AsyncMock(return_value=job))


class TestCurrentJobStatus:
    @pytest.mark.asyncio
    async def test_passes_the_status_through(self):
        assert await _current_job_status(_fake_store("failure"), "job-1") == "failure"

    @pytest.mark.asyncio
    async def test_missing_job_is_none(self):
        assert await _current_job_status(_fake_store(None), "job-1") is None

    @pytest.mark.asyncio
    async def test_unreadable_status_is_none(self):
        assert await _current_job_status(_fake_store(exc=ConnectionError("db down")), "job-1") is None

    @pytest.mark.asyncio
    async def test_no_store_is_none(self):
        assert await _current_job_status(None, "job-1") is None


class TestShouldWriteNotice:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("status", ["running", "success", "failure", "interrupted", None])
    @pytest.mark.parametrize("verdict", ["interrupted", "failure"])
    async def test_winner_always_may_write(self, status, verdict):
        assert (
            await _should_write_notice(job_store=_fake_store(status), job_id="j", verdict=verdict, finalized=True)
            is True
        )

    @pytest.mark.asyncio
    async def test_user_cancel_notice_survives_a_lost_status_race(self):
        assert (
            await _should_write_notice(
                job_store=_fake_store("interrupted"), job_id="j", verdict="interrupted", finalized=False
            )
            is True
        )

    @pytest.mark.asyncio
    async def test_loser_cancel_after_winner_success_is_skipped(self):
        assert (
            await _should_write_notice(
                job_store=_fake_store("success"), job_id="j", verdict="interrupted", finalized=False
            )
            is False
        )

    @pytest.mark.asyncio
    async def test_cancel_after_reaper_failure_is_skipped(self):
        assert (
            await _should_write_notice(
                job_store=_fake_store("failure"), job_id="j", verdict="interrupted", finalized=False
            )
            is False
        )

    @pytest.mark.asyncio
    async def test_failure_after_winner_success_is_skipped(self):
        assert (
            await _should_write_notice(job_store=_fake_store("success"), job_id="j", verdict="failure", finalized=False)
            is False
        )

    @pytest.mark.asyncio
    async def test_failure_after_user_cancel_is_skipped(self):
        assert (
            await _should_write_notice(
                job_store=_fake_store("interrupted"), job_id="j", verdict="failure", finalized=False
            )
            is False
        )

    @pytest.mark.asyncio
    async def test_same_verdict_failure_may_repeat(self):
        assert (
            await _should_write_notice(job_store=_fake_store("failure"), job_id="j", verdict="failure", finalized=False)
            is True
        )

    @pytest.mark.asyncio
    async def test_unreadable_status_fails_open(self):
        assert (
            await _should_write_notice(
                job_store=_fake_store(exc=ConnectionError("db down")),
                job_id="j",
                verdict="failure",
                finalized=False,
            )
            is True
        )

    @pytest.mark.asyncio
    async def test_missing_job_fails_open(self):
        assert (
            await _should_write_notice(job_store=_fake_store(None), job_id="j", verdict="failure", finalized=False)
            is True
        )

    @pytest.mark.asyncio
    async def test_no_store_fails_open(self):
        assert await _should_write_notice(job_store=None, job_id="j", verdict="failure", finalized=False) is True


class TestReapedThenFinishedWritesNothing:
    @pytest.mark.asyncio
    async def test_reaped_success_finish_writes_neither_turn_nor_notice(self, db_url):
        from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

        _seed_job(db_url, "job-1", "failure")  # ghost-job reaper got here first
        store = _make_store(db_url)

        finalized = await _update_status_if_not_terminal(store, "job-1", JobStatus.SUCCESS, output={"report": "late"})

        assert finalized is False  # the SUCCESS site publishes `if finalized`: no thread turn
        assert (
            await _should_write_notice(
                job_store=store, job_id="job-1", verdict=JobStatus.INTERRUPTED.value, finalized=False
            )
            is False
        )

        job = await store.get_job("job-1")
        assert job.status == "failure"
        assert job.output is None  # the late answer persisted nowhere


class TestUserCancelKeepsItsNotice:
    @pytest.mark.asyncio
    async def test_user_cancel_still_leaves_its_notice(self, db_url):
        from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

        _seed_job(db_url, "job-1", "interrupted")  # cancel route wrote the verdict
        store = _make_store(db_url)

        finalized = await _update_status_if_not_terminal(
            store, "job-1", JobStatus.INTERRUPTED, error="cancelled by user"
        )
        assert finalized is False
        assert (
            await _should_write_notice(
                job_store=store, job_id="job-1", verdict=JobStatus.INTERRUPTED.value, finalized=False
            )
            is True
        )
