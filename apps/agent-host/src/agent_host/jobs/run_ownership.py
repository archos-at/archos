"""One run of a research job at a time, though the orchestrator delivers at least once (ADR-0150).

Hatchet may start a second copy of a run while the first is alive: a worker it
lost touch with (a partition, a stalled event loop) keeps running while the
engine hands the task to another. Each copy takes ownership here before it
runs the agent, with a compare-and-set on ``job_info``; a copy that loses
returns without running.

THE RULE. A copy owns the job when, in one locked transaction:

* the job is ``submitted`` (no run has started it): it moves to ``running``; or
* the job is ``running`` and its run has shown no sign of life for
  ``STALE_SECONDS``: no ``job_info`` write and no event (the run emits a
  ``job.heartbeat`` every 30 s, ``runner.HEARTBEAT_INTERVAL_SECONDS``). That is
  a previous attempt that never finished; taking it over touches
  ``updated_at``, so a third copy sees the job alive, and so does the ghost
  reaper, which reads the same two signs. The window is the ghost reaper's
  (``routes/job_reaper.GHOST_JOB_TIMEOUT_SECONDS`` is this number), the one
  this tier already trusts to call a run dead; a shorter one would take over a
  run still building its workflow, which emits nothing for a while.

Anything else loses: a terminal job, or a ``running`` one whose run is alive.
A copy that finds the job alive polls for ``STALE_SECONDS`` and a margin
before it gives up, because a retry Hatchet started after a worker died can
arrive before that worker's last heartbeat has aged out. A copy that gives up
ends its Hatchet run as done ("duplicate"), deliberately: failing it instead
would spend the job's retries while the live run works, and the on-failure
task would then write FAILURE over that live run. The cost: if the live run
dies after the copy gave up, nothing is left to retry it and the ghost reaper
fails the job, visibly.

WHY NOT THE ATTEMPT NUMBER. Hatchet's ``retry_count`` cannot tell a duplicate
from a rescue: two copies of one delivery share it, and the engine reassigns a
lost worker's task without spending a retry, so a rescue can carry the same
number as the run it replaces. A higher number is no proof either, since the
attempt before may still be running on a partitioned worker. Liveness is the
one thing that says the previous attempt is gone, so the rule rests on it and
the attempt number is only logged.

The lock is a no-op ``UPDATE`` on the job's row taken first in the
transaction: on Postgres a row lock, on SQLite the database write lock, so two
copies decide one after the other and the second sees the first one's write.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import UTC
from datetime import datetime
from enum import Enum

logger = logging.getLogger(__name__)

#: Silent this long, the previous run is gone. The ghost reaper's window is this number.
STALE_SECONDS = 300
#: How long a copy that found the run alive keeps looking before it gives up.
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
    """One locked compare-and-set: whether this copy now owns the run of ``job_id``."""
    from sqlalchemy import select
    from sqlalchemy import update

    from nat.front_ends.fastapi.async_jobs.job_store import JobInfo
    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

    now = now or datetime.now(UTC)
    async with store.session() as session:
        # The lock: a write that changes nothing, so the other copy waits here.
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
    """Whether this copy may run the agent for ``job_id``; waits a while for a run that may have died."""
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
