from __future__ import annotations

from datetime import UTC
from datetime import datetime
from datetime import timedelta

import pytest
from sqlalchemy import text

from agent_host.jobs.access import ensure_job_access_table
from agent_host.jobs.access import expire_terminal_jobs
from agent_host.jobs.event_store import EventStore

DAY = 86400


def _iso(days_ago: float) -> str:
    return (datetime.now(UTC) - timedelta(days=days_ago)).strftime("%Y-%m-%d %H:%M:%S")


async def _store_jobs(dsn: str, jobs: list[tuple[str, str | None, float, int]]) -> None:
    from nat.front_ends.fastapi.async_jobs.job_store import Base
    from nat.front_ends.fastapi.async_jobs.job_store import JobStore

    Base.metadata.create_all(EventStore._get_or_create_sync_engine(dsn))
    store = JobStore(scheduler_address="", db_url=dsn)
    ensure_job_access_table(dsn)
    EventStore._ensure_table_exists(dsn)
    for job_id, status, _, expiry in jobs:
        await store._create_job(job_id=job_id, expiry_seconds=expiry)
        if status is not None:
            await store.update_status(job_id, status)
    engine = EventStore._get_or_create_sync_engine(dsn)
    with engine.connect() as conn:
        for job_id, _, days_ago, _ in jobs:
            conn.execute(
                text("UPDATE job_info SET updated_at = :u WHERE job_id = :j"), {"u": _iso(days_ago), "j": job_id}
            )
            conn.execute(
                text("INSERT INTO job_access (job_id, owner_auth_type, owner_subject) VALUES (:j, 'jwt', 'u')"),
                {"j": job_id},
            )
            conn.execute(
                text("INSERT INTO job_events (job_id, event_type, event_data) VALUES (:j, 'job.status', '{}')"),
                {"j": job_id},
            )
        conn.commit()


@pytest.mark.asyncio
async def test_expires_the_statuses_the_job_store_writes(tmp_path):
    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

    dsn = f"sqlite+aiosqlite:///{tmp_path / 'jobs.db'}"
    await _store_jobs(
        dsn,
        [
            ("active", JobStatus.RUNNING, 30, 3600),
            ("queued", None, 30, 3600),
            ("old-del", JobStatus.SUCCESS, 30, 3600),
            ("old-failed", JobStatus.FAILURE, 30, 3600),
            ("mid-mark", JobStatus.INTERRUPTED, 2, 3600),
            ("newest", JobStatus.SUCCESS, 1, 3600),
        ],
    )

    marked, deleted = expire_terminal_jobs(dsn, delete_grace_seconds=7 * DAY)

    assert (marked, deleted) == (3, 2)
    engine = EventStore._get_or_create_sync_engine(dsn)
    with engine.connect() as conn:
        info = dict(conn.execute(text("SELECT job_id, is_expired FROM job_info")).fetchall())
        assert set(info) == {"active", "queued", "mid-mark", "newest"}
        for table in ("job_access", "job_events"):
            remaining = set(conn.execute(text(f"SELECT job_id FROM {table}")).scalars().all())
            assert remaining.isdisjoint({"old-del", "old-failed"}), f"{table} kept a deleted job"
        assert info["mid-mark"]
        assert not info["newest"]
        assert not info["active"]
        assert not info["queued"]


def test_noop_when_no_job_info_table(tmp_path):
    dsn = f"sqlite:///{tmp_path / 'empty.db'}"
    assert expire_terminal_jobs(dsn, delete_grace_seconds=604800) == (0, 0)


@pytest.mark.asyncio
async def test_a_grace_shorter_than_the_expiry_never_deletes_a_job_before_it_expires(tmp_path):
    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

    dsn = f"sqlite+aiosqlite:///{tmp_path / 'jobs.db'}"
    await _store_jobs(
        dsn,
        [
            ("long-lived", JobStatus.SUCCESS, 0.5, DAY),
            ("newest", JobStatus.SUCCESS, 0.1, DAY),
        ],
    )

    assert expire_terminal_jobs(dsn, delete_grace_seconds=3600) == (0, 0)
