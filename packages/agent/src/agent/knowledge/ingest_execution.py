from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from agent.common.provider_limiter import priority_scope

from . import ingest_settle_push
from . import ingest_status_store
from .base import BaseIngestor
from .base import PreparedIngestJob
from .ingest_failures import classify_failure
from .schema import FileStatus
from .schema import IngestionJobStatus
from .schema import JobState

logger = logging.getLogger(__name__)

UNREADABLE_JOB_MESSAGE = "unreadable_job: the queued ingestion job could not be read; retry to index this file"

RETRYING_KEY = "retrying_after"
SUPERSEDED_KEY = "superseded"


@dataclass(frozen=True)
class Outcome:
    state: Literal["done", "failed", "live"]
    retryable: bool = False
    reason: str | None = None


def run_job(
    ingestor: BaseIngestor, prepared: PreparedIngestJob, still_owner: Callable[[], bool] | None
) -> IngestionJobStatus:
    with priority_scope(prepared.priority):
        ingestor.run_prepared(prepared, still_owner=still_owner)
    return ingestor.get_job_status(prepared.job_id) or ingest_status_store.interrupted(prepared.status)


def outcome_of(status: IngestionJobStatus) -> Outcome:
    if status.status in (JobState.COMPLETED, JobState.CANCELLED):
        return Outcome("done")
    if status.status != JobState.FAILED:
        return Outcome("live")
    failed = [d for d in status.file_details if d.status == FileStatus.FAILED and d.retryable is not None]
    if failed:
        retryable = any(d.retryable for d in failed)
        reason = next((d.error_message for d in failed if d.retryable == retryable), None)
        return Outcome("failed", retryable, reason or status.error_message)
    verdict = classify_failure(status.error_message)
    return Outcome("failed", verdict.retryable, status.error_message)


def reopen(prepared: PreparedIngestJob, failed: IngestionJobStatus, attempt: int) -> bool:
    waiting = prepared.status.model_copy(deep=True)
    waiting.metadata = {**waiting.metadata, RETRYING_KEY: {"attempt": attempt, "error": failed.error_message}}
    return ingest_status_store.put(waiting)


def settle(job_id: str) -> int:
    return ingest_settle_push.send_settled([job_id])


def settle_timed_out(job_id: str) -> None:
    status = ingest_status_store.get(job_id)
    if status is not None and status.status in (JobState.PENDING, JobState.PROCESSING):
        ingest_status_store.put(ingest_status_store.interrupted(status))


def unreadable_job_failure(status: IngestionJobStatus) -> IngestionJobStatus:
    failed = ingest_status_store.interrupted(status)
    failed.error_message = UNREADABLE_JOB_MESSAGE
    verdict = classify_failure(UNREADABLE_JOB_MESSAGE)
    failed.metadata = {**failed.metadata, "failure_reason": "unreadable_job", "retryable": verdict.retryable}
    for before, detail in zip(status.file_details, failed.file_details, strict=True):
        if before.status in (FileStatus.SUCCESS, FileStatus.FAILED):
            continue
        detail.error_message = UNREADABLE_JOB_MESSAGE
        detail.failure_category = verdict.category
        detail.retryable = verdict.retryable
    return failed


def fail_unreadable(job_id: str, reason: str) -> None:
    logger.error("Ingestion job %s has an unreadable payload (%s); not run", job_id, reason)
    status = ingest_status_store.get(job_id)
    if status is not None and status.status in (JobState.PENDING, JobState.PROCESSING):
        ingest_status_store.put(unreadable_job_failure(status))


def settle_superseded(job_id: str) -> bool:
    status = ingest_status_store.get(job_id)
    if status is None or status.status not in (JobState.PENDING, JobState.PROCESSING):
        return False
    superseded = status.model_copy(deep=True)
    superseded.status = JobState.CANCELLED
    superseded.metadata = {**superseded.metadata, SUPERSEDED_KEY: True}
    logger.info("Ingestion job %s was superseded by a newer upload of its document", job_id)
    return ingest_status_store.put(superseded)
