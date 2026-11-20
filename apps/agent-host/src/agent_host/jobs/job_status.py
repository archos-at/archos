from __future__ import annotations

import json
import logging
from datetime import UTC
from datetime import datetime
from typing import Any

from .conversation_output import INTERRUPTED_NOTICE
from .conversation_output import write_job_notice
from .event_store import BatchingEventStore
from .event_store import EventStore
from .outcome_notify import notify_job_outcome

logger = logging.getLogger(__name__)


async def _update_status_if_not_terminal(job_store: Any, job_id: str, status: Any, **kwargs: Any) -> bool:
    from sqlalchemy import update

    from nat.front_ends.fastapi.async_jobs.job_store import JobInfo
    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

    if not isinstance(status, JobStatus):
        status = JobStatus(status)
    terminal_statuses = {JobStatus.SUCCESS.value, JobStatus.FAILURE.value, JobStatus.INTERRUPTED.value}
    stmt = (
        update(JobInfo)
        .where(JobInfo.job_id == job_id, JobInfo.status.not_in(terminal_statuses))
        .values(_status_values(status, **kwargs))
    )
    async with job_store.session() as session:
        result = await session.execute(stmt)
        written = (result.rowcount or 0) > 0
    if written:
        return True
    await _explain_refused_write(job_store, job_id, status)
    return False


def _status_values(status: Any, *, error: Any = None, output_path: Any = None, output: Any = None) -> dict[str, Any]:
    from pydantic import BaseModel

    if isinstance(output, BaseModel):
        output = output.model_dump_json(round_trip=True)
    if isinstance(output, dict | list):
        output = json.dumps(output)
    return {
        "status": status.value,
        "error": error,
        "output_path": output_path,
        "output": output,
        "updated_at": datetime.now(UTC),
    }


async def _explain_refused_write(job_store: Any, job_id: str, status: Any) -> None:
    job = await job_store.get_job(job_id)
    if job is None:
        raise ValueError(f"Job {job_id} not found in job store")
    logger.info("Job %s already in terminal status %s; not overwriting with %s", job_id, job.status, status)


async def _current_job_status(job_store: Any, job_id: str) -> str | None:
    if job_store is None:
        return None
    try:
        job = await job_store.get_job(job_id)
    except Exception:
        logger.warning("Could not read current status for job %s", job_id, exc_info=True)
        return None
    if job is None:
        return None
    return getattr(job, "status", None)


async def _should_write_notice(*, job_store: Any, job_id: str, verdict: str, finalized: bool) -> bool:
    if finalized:
        return True
    status = await _current_job_status(job_store, job_id)
    if status is None or status == verdict:
        return True
    logger.info(
        "Job %s already in terminal status %s; skipping %s notice (loser writes nothing user-visible)",
        job_id,
        status,
        verdict,
    )
    return False


async def _should_notify_outcome(*, job_store: Any, job_id: str, verdict: str, finalized: bool) -> bool:
    if finalized:
        return True
    return await _current_job_status(job_store, job_id) == verdict


async def _should_emit_cancelled_event(*, job_store: Any, job_id: str, finalized: bool) -> bool:
    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

    if finalized:
        return True
    status = await _current_job_status(job_store, job_id)
    if status is None or status == JobStatus.INTERRUPTED.value:
        return True
    logger.info(
        "Job %s already in terminal status %s; skipping job.cancelled event "
        "(a late abort must not rewrite the standing verdict)",
        job_id,
        status,
    )
    return False


def _emit_lifecycle_event(*, db_url: str, event_store: Any | None, job_id: str, event: dict[str, Any]) -> Any:
    if event_store is None:
        event_store = BatchingEventStore(EventStore(db_url, job_id))
    event_store.store(event)
    if hasattr(event_store, "flush"):
        event_store.flush()
    return event_store


async def _finalize_cancelled_run(
    *,
    job_store: Any,
    db_url: str,
    job_id: str,
    parent_conversation_id: str | None,
    usage_context: dict | None,
    event_store: Any | None,
    expect_run: bool = False,
) -> Any:
    logger.info("Job %s cancelled", job_id)
    finalized = await _mark_interrupted(job_store, job_id)
    await _publish_interrupted(
        job_store=job_store,
        job_id=job_id,
        finalized=finalized,
        parent_conversation_id=parent_conversation_id,
        usage_context=usage_context,
        expect_run=expect_run,
    )
    if await _should_emit_cancelled_event(job_store=job_store, job_id=job_id, finalized=finalized):
        cancelled = {"type": "job.cancelled", "data": {"reason": "cancelled by user"}}
        event_store = _emit_lifecycle_event(db_url=db_url, event_store=event_store, job_id=job_id, event=cancelled)
    return event_store


async def _mark_interrupted(job_store: Any, job_id: str) -> bool:
    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

    if not job_store:
        return False
    try:
        return await _update_status_if_not_terminal(job_store, job_id, JobStatus.INTERRUPTED, error="cancelled by user")
    except ConnectionError, TimeoutError, RuntimeError:
        return False


async def _publish_interrupted(
    *,
    job_store: Any,
    job_id: str,
    finalized: bool,
    parent_conversation_id: str | None,
    usage_context: dict | None,
    expect_run: bool,
) -> None:
    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

    if await _should_write_notice(
        job_store=job_store,
        job_id=job_id,
        verdict=JobStatus.INTERRUPTED.value,
        finalized=finalized,
    ):
        await write_job_notice(
            conversation_id=parent_conversation_id,
            job_id=job_id,
            usage_context=usage_context,
            notice=INTERRUPTED_NOTICE,
            expect_run=expect_run,
        )
    if await _should_notify_outcome(
        job_store=job_store,
        job_id=job_id,
        verdict=JobStatus.INTERRUPTED.value,
        finalized=finalized,
    ):
        await notify_job_outcome(
            job_id=job_id, usage_context=usage_context, status="interrupted", expect_run=expect_run
        )
