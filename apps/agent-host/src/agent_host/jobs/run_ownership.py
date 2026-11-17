from __future__ import annotations

import asyncio
import logging
import time
from datetime import UTC
from datetime import datetime
from enum import Enum

logger = logging.getLogger(__name__)

STALE_SECONDS = 300
WAIT_SECONDS = STALE_SECONDS + 60
_POLL_SECONDS = 10


class Verdict(Enum):
    TAKEN = "taken"
    ALIVE = "alive"
    GONE = "gone"


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


async def _last_sign_of_life(session, job_id: str, updated_at: datetime | None) -> datetime | None:
    from sqlalchemy import DateTime
    from sqlalchemy import column
    from sqlalchemy import func
    from sqlalchemy import select
    from sqlalchemy import table

    events = table("job_events", column("job_id"), column("created_at", DateTime))
    last_event = (
        await session.execute(select(func.max(events.c.created_at)).where(events.c.job_id == job_id))
    ).scalar()
    seen = [stamp for stamp in (_as_utc(updated_at), _as_utc(last_event)) if stamp is not None]
    return max(seen) if seen else None


async def try_take(store, job_id: str, now: datetime | None = None) -> Verdict:
    from sqlalchemy import select
    from sqlalchemy import update

    from nat.front_ends.fastapi.async_jobs.job_store import JobInfo
    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

    now = now or datetime.now(UTC)
    async with store.session() as session:
        await session.execute(update(JobInfo).where(JobInfo.job_id == job_id).values(updated_at=JobInfo.updated_at))
        row = (
            await session.execute(select(JobInfo.status, JobInfo.updated_at).where(JobInfo.job_id == job_id))
        ).first()
        if row is None or row[0] not in (JobStatus.SUBMITTED.value, JobStatus.RUNNING.value):
            return Verdict.GONE
        if row[0] == JobStatus.RUNNING.value:
            last = await _last_sign_of_life(session, job_id, row[1])
            if last is not None and (now - last).total_seconds() < STALE_SECONDS:
                return Verdict.ALIVE
        await session.execute(
            update(JobInfo).where(JobInfo.job_id == job_id).values(status=JobStatus.RUNNING.value, updated_at=now)
        )
    return Verdict.TAKEN


async def take_ownership(db_url: str, job_id: str, attempt: int | None = None) -> bool:
    from nat.front_ends.fastapi.async_jobs.job_store import JobStore

    from .event_store import EventStore

    await asyncio.to_thread(EventStore._ensure_table_exists, db_url)
    store = JobStore(scheduler_address="", db_url=db_url)
    deadline = time.monotonic() + WAIT_SECONDS
    while True:
        verdict = await try_take(store, job_id)
        if verdict is Verdict.TAKEN:
            return True
        if verdict is Verdict.GONE:
            logger.info("Job %s (attempt %s) is not waiting or running; this copy does not run", job_id, attempt)
            return False
        if time.monotonic() >= deadline:
            logger.warning("Job %s (attempt %s) is running elsewhere; this copy does not run", job_id, attempt)
            return False
        await asyncio.sleep(_POLL_SECONDS)
