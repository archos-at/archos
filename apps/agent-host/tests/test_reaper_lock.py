from __future__ import annotations

from unittest.mock import AsyncMock
from unittest.mock import MagicMock

import pytest

from agent.knowledge import leader_lock
from agent_host.routes import job_reaper

POOLED = "postgresql+asyncpg://agent:pw@grid-pg-pooler-rw:5432/jobs"  # pragma: allowlist secret
DIRECT = "postgresql://agent:pw@grid-pg-rw:5432/jobs"  # pragma: allowlist secret


def _engine(monkeypatch, *, wins: bool):
    conn = MagicMock()
    conn.execute.return_value.scalar.return_value = wins
    engine = MagicMock()
    engine.connect.return_value = conn
    seen_urls: list[str] = []

    def lock_engine(url):
        seen_urls.append(url)
        return engine

    monkeypatch.setattr(leader_lock, "_lock_engine", lock_engine)
    return seen_urls, conn


@pytest.fixture(autouse=True)
def _lock_dsn(monkeypatch):
    monkeypatch.setenv("LOCK_DB_URL", DIRECT)


@pytest.mark.asyncio
async def test_the_reaper_locks_on_the_direct_dsn_not_the_job_store_url(monkeypatch):
    seen_urls, conn = _engine(monkeypatch, wins=True)
    cycle = AsyncMock(return_value=["job-1"])
    monkeypatch.setattr(job_reaper, "_do_reap_cycle", cycle)

    reaped = await job_reaper.reap_stale_jobs_once(MagicMock(), POOLED)

    assert reaped == ["job-1"]
    assert seen_urls == [DIRECT]
    (lock_sql, lock_params), _ = conn.execute.call_args_list[0]
    assert "pg_try_advisory_lock(:id)" in str(lock_sql)
    assert lock_params == {"id": job_reaper._PG_REAPER_LOCK_ID}
    (unlock_sql, _), _ = conn.execute.call_args_list[-1]
    assert "pg_advisory_unlock" in str(unlock_sql)
    conn.close.assert_called_once()


@pytest.mark.asyncio
async def test_a_replica_that_loses_the_election_skips_the_cycle(monkeypatch):
    _, conn = _engine(monkeypatch, wins=False)
    cycle = AsyncMock(return_value=["job-1"])
    monkeypatch.setattr(job_reaper, "_do_reap_cycle", cycle)

    assert await job_reaper.reap_stale_jobs_once(MagicMock(), POOLED) == []

    cycle.assert_not_awaited()
    conn.close.assert_called_once()


@pytest.mark.asyncio
async def test_the_lock_is_released_when_the_cycle_raises(monkeypatch):
    _, conn = _engine(monkeypatch, wins=True)
    monkeypatch.setattr(job_reaper, "_do_reap_cycle", AsyncMock(side_effect=RuntimeError("cycle failed")))

    with pytest.raises(RuntimeError, match="cycle failed"):
        await job_reaper.reap_stale_jobs_once(MagicMock(), POOLED)

    (unlock_sql, _), _ = conn.execute.call_args_list[-1]
    assert "pg_advisory_unlock" in str(unlock_sql)
    conn.close.assert_called_once()


@pytest.mark.asyncio
async def test_a_lock_that_cannot_be_taken_skips_the_cycle_and_the_next_tick_retries(monkeypatch, caplog):
    conn = MagicMock()
    conn.execute.side_effect = RuntimeError("connection lost")
    engine = MagicMock()
    engine.connect.return_value = conn
    monkeypatch.setattr(leader_lock, "_lock_engine", lambda url: engine)
    cycle = AsyncMock(return_value=["job-1"])
    monkeypatch.setattr(job_reaper, "_do_reap_cycle", cycle)

    with caplog.at_level("WARNING"):
        assert await job_reaper.reap_stale_jobs_once(MagicMock(), POOLED) == []

    cycle.assert_not_awaited()
    assert "skipping this cycle" in caplog.text
    conn.close.assert_called_once()
