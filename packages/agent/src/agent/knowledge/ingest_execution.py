"""One ingestion job, run to its end: what the ``ingest-document`` task does, without Hatchet.

The orchestrator (Hatchet, ADR-0150, registered in ``ingest_workflow``) decides
when a job runs, how often it is tried and when it is given up. Everything about
the job itself is here, free of ``hatchet_sdk``, so the orchestrator stays
replaceable: run the prepared job on the ingestor (``run_job``), read what it
ended as (``outcome_of``), put a job that will be tried again back to waiting
(``reopen``), and tell the BFF a job ended for good (``settle``,
``ingest_settle_push``), which the workflow does in a step of its own.

A job ends one of five ways:

* ``done``: completed, or a person stopped it. Settled.
* ``failed``: the adapter wrote FAILED. Whether a retry can help is the verdict
  on its failed files (``classify_failure``, stamped on each file), or on the
  job's own message when no file carries one. A retryable failure is reopened
  and tried again while attempts remain; anything else is settled.
* ``superseded``: a newer upload of the same document cancelled the run
  (``settle_superseded``): ``cancelled`` with ``metadata.superseded``, never
  a person's cancel and never a failure.
* ``live``: the run stopped without a terminal status (its run was cancelled
  or timed out, and the adapter abandoned it without a write). The status
  store's own rules settle it.
"""

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

#: Why a job whose payload could not be read ended. A machine prefix the UI
#: maps to its own sentence (``ingest-failure.ts``): reading never started.
UNREADABLE_JOB_MESSAGE = "unreadable_job: the queued ingestion job could not be read; retry to index this file"

#: What ``metadata`` says of a job that waits for another attempt.
RETRYING_KEY = "retrying_after"
#: What ``metadata`` says of a job a newer upload of its document replaced.
SUPERSEDED_KEY = "superseded"


@dataclass(frozen=True)
class Outcome:
    """How a run ended, as the orchestrator acts on it."""

    state: Literal["done", "failed", "live"]
    retryable: bool = False
    reason: str | None = None


def run_job(
    ingestor: BaseIngestor, prepared: PreparedIngestJob, still_owner: Callable[[], bool] | None
) -> IngestionJobStatus:
    """Run ``prepared`` here, on this thread, and return the status it ended with.

    ``still_owner`` is asked before each file is read and before its chunks are
    written; a "no" (the run was cancelled) stops the job without another write.
    Its class at the provider limiter is the job's own priority (ADR-0081).
    """
    with priority_scope(prepared.priority):
        ingestor.run_prepared(prepared, still_owner=still_owner)
    return ingestor.get_job_status(prepared.job_id)


def outcome_of(status: IngestionJobStatus) -> Outcome:
    """What a job's final status means to the orchestrator (see the module docstring)."""
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
    """Put a job that will be tried again back to waiting, so no reader settles it in between.

    The accepted status again (every file waiting), with the failure it will be
    tried after in ``metadata``. Whether it is stored.
    """
    waiting = prepared.status.model_copy(deep=True)
    waiting.metadata = {**waiting.metadata, RETRYING_KEY: {"attempt": attempt, "error": failed.error_message}}
    return ingest_status_store.put(waiting)


def settle(job_id: str) -> int:
    """The job has ended for good: tell the BFF now, which settles its document; how many it settled.

    Raises ``BffError`` when the BFF did not take the call, so the step that
    calls this is tried again. Without a service token nothing is sent.
    """
    return ingest_settle_push.send_settled([job_id])


def settle_timed_out(job_id: str) -> None:
    """The last attempt ran out of time: write the ``interrupted`` failure a lost owner leaves."""
    status = ingest_status_store.get(job_id)
    if status is not None and status.status in (JobState.PENDING, JobState.PROCESSING):
        ingest_status_store.put(ingest_status_store.interrupted(status))


def unreadable_job_failure(status: IngestionJobStatus) -> IngestionJobStatus:
    """``status`` failed because its payload could not be read: the job and every file it left unfinished.

    ``interrupted`` settles the unfinished files, but with its own reason, the
    restart. The BFF reads a single-file job's reason off the file before the
    job, so the files must carry this reason too, or the reader is told the
    service restarted when it did not.
    """
    failed = ingest_status_store.interrupted(status)
    failed.error_message = UNREADABLE_JOB_MESSAGE
    verdict = classify_failure(UNREADABLE_JOB_MESSAGE)
    failed.metadata = {**failed.metadata, "failure_reason": "unreadable_job", "retryable": verdict.retryable}
    # By position: `interrupted` copies the details in order, and a file id may be empty.
    for before, detail in zip(status.file_details, failed.file_details, strict=True):
        if before.status in (FileStatus.SUCCESS, FileStatus.FAILED):
            continue
        detail.error_message = UNREADABLE_JOB_MESSAGE
        detail.failure_category = verdict.category
        detail.retryable = verdict.retryable
    return failed


def fail_unreadable(job_id: str, reason: str) -> None:
    """A job whose payload cannot be read is never run: its status is written failed at once."""
    logger.error("Ingestion job %s has an unreadable payload (%s); not run", job_id, reason)
    status = ingest_status_store.get(job_id)
    if status is not None and status.status in (JobState.PENDING, JobState.PROCESSING):
        ingest_status_store.put(unreadable_job_failure(status))


def settle_superseded(job_id: str) -> bool:
    """A newer upload of the job's document replaced it: ``cancelled``, marked superseded; whether written.

    Never a person's cancel (``ingest_status_store.settle_cancelled``) and never
    a failure: nothing went wrong, a newer Fassung is being read instead. No
    settle push either. The BFF has already pointed the document at the newer
    job, so a push for this one would find no row waiting on it, and in the
    moment before that, would settle the row as stopped.
    """
    status = ingest_status_store.get(job_id)
    if status is None or status.status not in (JobState.PENDING, JobState.PROCESSING):
        return False
    superseded = status.model_copy(deep=True)
    superseded.status = JobState.CANCELLED
    superseded.metadata = {**superseded.metadata, SUPERSEDED_KEY: True}
    logger.info("Ingestion job %s was superseded by a newer upload of its document", job_id)
    return ingest_status_store.put(superseded)
