"""The ``ingest-document`` workflow: ingestion jobs on Hatchet (ADR-0150).

The thin layer between the orchestrator and the job, and the only module of
ingestion that imports ``hatchet_sdk``. It declares the workflow, triggers a run
of it for each accepted job (``trigger``), cancels one (``cancel_run``) and
serves it on the ingest-worker tier (``serve``).

The workflow is a DAG of two steps, so a crash repeats only the step it
happened in:

* ``index``: fetch, read, summarise, embed and write the job's files
  (``ingest_execution.run_job``). Its output is the job id and the status it
  ended with, nothing of the document.
* ``settle`` (after ``index``): tell the BFF (``ingest_execution.settle``), with
  retries of its own, so a BFF that is away for a moment costs a retried call,
  never a re-indexed file. ``settle-failed``, the workflow's failure handler,
  tells it the same about a job that failed for good.

``index`` is one step because the adapter holds a file's pages, text and chunks
in memory from the download to the write (``LlamaIndexIngestor._ingest_job``).
Its costly middle, reading the pages, is already persisted: every vision and
transcription result is cached by content hash in Dragonfly for 30 days
(``knowledge_layer.llamaindex.processing``), so a repeated ``index`` reads its
pages from the cache. A boundary between reading and writing would have to
persist the whole parsed document first. What a run does is
``ingest_execution``'s; Temporal, the documented exit, would replace this file
and nothing below it.

What Hatchet holds of a job is its id, its organisation (the fairness key), its
priority and the payload the API tier already encrypted (``payload_crypto``,
``JOB_PAYLOAD_KEK``): never a file name or a byte of a document.

* **Fairness:** the workflow's concurrency, keyed on ``input.organization_id``
  with ``GROUP_ROUND_ROBIN``: each organisation runs at most ``max_runs_per_org()``
  jobs fleet-wide, and a free slot goes to the organisations in turn. A job
  with no organisation runs in ``PLATFORM_LANE``.
* **Priority:** ``interactive`` runs as ``Priority.HIGH``, ``bulk`` as
  ``Priority.LOW``, inside the organisation's turn.
* **Retries:** per step, with exponential backoff: ``RETRIES`` more attempts
  of ``index`` for a failure that may pass (a dropped worker, a timeout, a
  transient file failure), ``SETTLE_RETRIES`` of ``settle``. A failure of the
  bytes raises ``NonRetryableException``.
* **Idempotency:** one live run per job id, so asking twice for the base
  corpus's deterministic ids starts one run.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from datetime import timedelta
from typing import Any
from typing import Literal

from hatchet_sdk import ConcurrencyExpression
from hatchet_sdk import ConcurrencyLimitStrategy
from hatchet_sdk import Context
from hatchet_sdk import IdempotencyCollisionError
from hatchet_sdk import NonRetryableException
from hatchet_sdk import Priority
from hatchet_sdk import StatusBasedIdempotencyConfig
from pydantic import BaseModel

from agent.common import bff_http
from agent.common import hatchet_client

from . import ingest_execution
from . import ingest_run_hold
from . import ingest_status_store
from .base import BaseIngestor
from .base import PreparedIngestJob
from .ingest_scheduler import lane_of
from .ingest_scheduler import per_org_cap_from_env

logger = logging.getLogger(__name__)

WORKFLOW_NAME = "ingest-document"
INDEX_STEP = "index"
SETTLE_STEP = "settle"
SETTLE_FAILED_STEP = "settle-failed"
#: The worker pool's name, as Kubernetes names it.
WORKER_NAME = "ingest-worker"

#: Jobs one organisation may run at once, fleet-wide, when ``INGEST_MAX_PER_ORG``
#: is 0. Sixteen is the prod fleet's document slots (8 ingest pods at 2 each), so
#: an office alone may still use the whole fleet, as it could on the claim queue
#: without a cap; round robin hands the next free slot to the next office.
DEFAULT_MAX_RUNS_PER_ORG = 16
RETRIES = 2
#: The settle call is one short request; five tries over about four minutes.
SETTLE_RETRIES = 5
SETTLE_TIMEOUT = timedelta(seconds=30)
#: Waits of 8 s, then 64 s, between attempts (Hatchet: factor ** retry count).
BACKOFF_FACTOR = 8.0
BACKOFF_MAX_SECONDS = 600
#: How long a run may wait for a worker before Hatchet gives it up: the life of
#: the presigned download URL the BFF signs (24 h), after which it could not read.
SCHEDULE_TIMEOUT = timedelta(hours=24)

PRIORITIES: dict[str, Priority] = {"interactive": Priority.HIGH, "bulk": Priority.LOW}


class IngestDocumentInput(BaseModel):
    """What a run carries: ids, the fairness key, the priority, and the encrypted payload."""

    job_id: str
    organization_id: str
    priority: Literal["interactive", "bulk"] = "interactive"
    payload: str


# @environment_variable INGEST_MAX_JOB_SECONDS
# @category Knowledge Layer
# @type int
# @default 7200
# @required false
# The longest one attempt of an ingestion job may run: the `execution_timeout` of
# the `index` step of the `ingest-document` workflow. Past it Hatchet cancels the attempt, the job stops at
# its next check, and the next attempt starts (the last one settles `interrupted`).
def max_job_seconds() -> int:
    """``INGEST_MAX_JOB_SECONDS``; unset, not a number or below one is the default."""
    try:
        seconds = int(os.environ.get("INGEST_MAX_JOB_SECONDS", "").strip() or 7200)
    except ValueError:
        return 7200
    return seconds if seconds > 0 else 7200


def max_runs_per_org() -> int:
    """The per-organisation ``max_runs``: ``INGEST_MAX_PER_ORG``, or ``DEFAULT_MAX_RUNS_PER_ORG``."""
    return per_org_cap_from_env() or DEFAULT_MAX_RUNS_PER_ORG


def hold_seconds() -> int:
    """How long the status row is vouched for: the wait for a worker, then every attempt and its backoff."""
    attempts = RETRIES + 1
    return int(SCHEDULE_TIMEOUT.total_seconds()) + attempts * (max_job_seconds() + BACKOFF_MAX_SECONDS)


def workflow_options() -> dict[str, Any]:
    """The workflow's declaration, as ``Hatchet.workflow`` takes it."""
    return {
        "name": WORKFLOW_NAME,
        "input_validator": IngestDocumentInput,
        "concurrency": ConcurrencyExpression(
            expression="input.organization_id",
            max_runs=max_runs_per_org(),
            limit_strategy=ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
        ),
        "default_priority": Priority.HIGH,
        "idempotency": StatusBasedIdempotencyConfig(key_expression="input.job_id", fallback_ttl=SCHEDULE_TIMEOUT),
    }


def index_options() -> dict[str, Any]:
    """The ``index`` step, as ``Workflow.task`` takes it."""
    return {
        "name": INDEX_STEP,
        "execution_timeout": timedelta(seconds=max_job_seconds()),
        "schedule_timeout": SCHEDULE_TIMEOUT,
        "retries": RETRIES,
        "backoff_factor": BACKOFF_FACTOR,
        "backoff_max_seconds": BACKOFF_MAX_SECONDS,
    }


def settle_options() -> dict[str, Any]:
    """The ``settle`` step and the failure handler: short, and tried again on their own."""
    return {
        "execution_timeout": SETTLE_TIMEOUT,
        "retries": SETTLE_RETRIES,
        "backoff_factor": 2.0,
        "backoff_max_seconds": 120,
    }


_lock = threading.Lock()
#: The workflow as declared on the client that declared it; rebuilt when the client changes (a test's fake).
_declared: tuple[object, Any] | None = None


def ingest_workflow() -> Any:
    """The ``ingest-document`` workflow on this process's Hatchet client."""
    global _declared
    client = hatchet_client.client()
    with _lock:
        if _declared is None or _declared[0] is not client:
            _declared = (client, _declare(client))
        return _declared[1]


def _declare(client: Any) -> Any:
    workflow = client.workflow(**workflow_options())

    @workflow.task(**index_options())
    def index(input: IngestDocumentInput, ctx: Context) -> dict[str, Any]:
        return execute(input, ctx)

    @workflow.task(name=SETTLE_STEP, parents=[index], **settle_options())
    def settle(input: IngestDocumentInput, ctx: Context) -> dict[str, Any]:
        return settle_step(input.job_id)

    @workflow.on_failure_task(name=SETTLE_FAILED_STEP, **settle_options())
    def settle_failed(input: IngestDocumentInput, ctx: Context) -> dict[str, Any]:
        return settle_step(input.job_id)

    return workflow


def settle_step(job_id: str) -> dict[str, Any]:
    """Tell the BFF; an answer that a retry would only repeat (a 4xx) is not tried again."""
    try:
        return {"job_id": job_id, "settled": ingest_execution.settle(job_id)}
    except bff_http.BffRefusedError as refused:
        if refused.status < 500 and refused.status != 429:
            raise NonRetryableException(
                f"the BFF refused to settle ingestion job {job_id} ({refused.status})"
            ) from None
        raise


def trigger(job_id: str, organization_id: str | None, priority: str | None, payload: str) -> bool:
    """Start a run for an accepted job; whether this call started one (one already live starts none).

    ``payload`` is the job as ``ingest_dispatch.encode`` stores it, encrypted.
    Raises when Hatchet cannot be reached; the caller decides what that costs.
    """
    rank = priority if priority in PRIORITIES else "interactive"
    run_input = IngestDocumentInput(
        job_id=job_id, organization_id=lane_of(organization_id), priority=rank, payload=payload
    )
    # The row was written live a moment ago, so it is not stale before the hold lands.
    try:
        ref = ingest_workflow().run(
            run_input, wait_for_result=False, additional_metadata={"job_id": job_id}, priority=PRIORITIES[rank]
        )
    except IdempotencyCollisionError as collision:
        ingest_run_hold.hold(job_id, collision.existing_run_external_id, hold_seconds())
        return False
    ingest_run_hold.hold(job_id, ref.workflow_run_id, hold_seconds())
    return True


def cancel_run(run_id: str) -> None:
    """Cancel a run by its id, through the SDK's runs API. Raises when Hatchet cannot be reached."""
    hatchet_client.client().runs.cancel(run_id)


class _Runtime:
    """What the served workflow runs with: set once by ``serve`` in the worker process."""

    ingestor: BaseIngestor | None = None
    decode: Callable[[str], PreparedIngestJob] | None = None


_runtime = _Runtime()
#: The clock an attempt's runtime is read on; a seam for the tests.
_monotonic = time.monotonic


def execute(run: IngestDocumentInput, ctx: Context) -> dict[str, Any]:
    """One attempt of the ``index`` step (see the module docstrings here and in ``ingest_execution``)."""
    ingestor, decode = _runtime.ingestor, _runtime.decode
    if ingestor is None or decode is None:
        raise RuntimeError("the ingest-document workflow runs only in a process that serves it")
    last_attempt = ctx.attempt_number >= ctx.max_attempts
    if last_attempt:
        ingest_run_hold.release(run.job_id)
    try:
        prepared = decode(run.payload)
    except Exception as error:  # noqa: BLE001 - a poison payload must never reach the ingestor
        ingest_execution.fail_unreadable(run.job_id, type(error).__name__)
        raise NonRetryableException(f"unreadable_job: {type(error).__name__}") from None
    started = _monotonic()
    status = ingest_execution.run_job(ingestor, prepared, still_owner=lambda: not ctx.is_cancelled)
    if ctx.is_cancelled:
        return _stopped(run.job_id, _monotonic() - started, last_attempt)
    return _ended(prepared, status, ctx.attempt_number, last_attempt)


def _stopped(job_id: str, elapsed: float, last_attempt: bool) -> dict[str, Any]:
    """The run was cancelled: by its timeout, or by a person (``ingest_dispatch.cancel``)."""
    if elapsed >= max_job_seconds() - 1:
        logger.error("Ingestion job %s ran past %ds and was stopped", job_id, max_job_seconds())
        if last_attempt:
            ingest_execution.settle_timed_out(job_id)
        return {"job_id": job_id, "status": "timed_out"}
    # A person stopped it. The cancel settled the row; the run may have written
    # it live again before it saw the cancel, so settle it once more.
    ingest_status_store.settle_cancelled(job_id)
    return {"job_id": job_id, "status": "cancelled"}


def _ended(prepared: PreparedIngestJob, status, attempt: int, last_attempt: bool) -> dict[str, Any]:
    outcome = ingest_execution.outcome_of(status)
    if outcome.state == "live":
        raise RuntimeError(f"ingestion job {prepared.job_id} stopped without a final status")
    if outcome.state == "failed" and outcome.retryable and not last_attempt:
        ingest_execution.reopen(prepared, status, attempt)
        raise RuntimeError(f"ingestion job {prepared.job_id} failed for the moment; tried again")
    if outcome.state == "failed":
        # Failed for good; ``settle-failed`` tells the BFF. The category only: a message may name the file.
        raise NonRetryableException(f"ingestion job {prepared.job_id} failed for good")
    return {"job_id": prepared.job_id, "status": status.status.value}


def serve(
    lifespan: Callable[[], AbstractAsyncContextManager[BaseIngestor]],
    decode: Callable[[str], PreparedIngestJob],
    *,
    slots: int,
) -> None:
    """Run the ingest worker: ``slots`` steps at once, until SIGTERM has drained them. Blocks.

    ``lifespan`` builds the ingestor (the agent runtime's workflow) on the
    worker's own event loop and keeps it for the worker's life. The SDK owns the
    signals: on SIGTERM it stops taking runs and waits for the ones it holds.
    """
    _runtime.decode = decode

    async def worker_lifespan():
        async with lifespan() as ingestor:
            _runtime.ingestor = ingestor
            try:
                yield ingestor
            finally:
                _runtime.ingestor = None

    worker = hatchet_client.client().worker(
        WORKER_NAME, slots=max(1, slots), workflows=[ingest_workflow()], lifespan=worker_lifespan
    )
    worker.start()
