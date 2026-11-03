"""The ``ingest-document`` workflows: ingestion jobs on Hatchet (ADR-0150).

The thin layer between the orchestrator and the job, and the only module of
ingestion that imports ``hatchet_sdk``. It declares the workflows, triggers a
run for each accepted job (``trigger``), cancels one (``cancel_run``) and serves
them on the ingest-worker tiers (``serve``).

Two workflows, the same steps: ``ingest-document`` on the standard pool and
``ingest-document-heavy`` on the high-memory pool (``pool=highmem``), whose
``index`` costs a whole worker (``slot_cost``). ``trigger`` picks by the
original's size (``INGEST_HEAVY_FILE_BYTES``), which the BFF states at dispatch.

Each is a DAG of two steps, so a crash repeats only the step it happened in:

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
(``knowledge_layer.ingest.processing``), so a repeated ``index`` reads its
pages from the cache. What a run does is ``ingest_execution``'s; Temporal, the
documented exit, would replace this file and nothing below it.

What Hatchet holds of a job is its id, its document's id, its organisation (the
fairness key), its priority and the payload the API tier already encrypted
(``payload_crypto``, ``JOB_PAYLOAD_KEK``): never a file name or a byte of a document.

* **Fairness:** one tenant-scoped concurrency limit, ``ingest-org``, keyed on
  ``input.organization_id`` with ``GROUP_ROUND_ROBIN`` and shared by both
  workflows: each organisation runs at most ``max_runs_per_org()`` jobs
  fleet-wide, heavy or not, and a free slot goes to the organisations in turn.
  A job with no organisation runs in ``PLATFORM_LANE``.
* **A re-upload supersedes:** a second tenant-scoped limit, ``ingest-supersede``,
  ``CANCEL_IN_PROGRESS`` with one run per ``input.document_id``: a newer upload
  of a document cancels the run still indexing the old bytes, which records
  itself superseded (``ingest_execution.settle_superseded``), never as a
  person's cancel and never as a failure. A job carries one document (one
  ``file_ref`` per ``POST /v1/ingest``, one corpus file per job); one without a
  document id is keyed on its own job id, so it supersedes nothing.
* **Priority:** ``interactive`` runs as ``Priority.HIGH``, ``bulk`` as
  ``Priority.LOW``, inside the organisation's turn.
* **Retries:** per step, with exponential backoff: ``RETRIES`` more attempts of
  ``index`` for a failure that may pass, ``SETTLE_RETRIES`` of ``settle``. A
  failure of the bytes raises ``NonRetryableException``. What a step raises
  reaches Hatchet as the exception's class and failure category only, ``from
  None`` (``task_failures``); the message is logged here and nowhere else.
* **Credits in flight:** the provider's 402 for credits that requests in flight
  hold is waited out, not retried at once: the attempt pauses new ``index``
  starts for ``CREDIT_PAUSE`` (the rate-limit key ``ingest-provider-credits``,
  which every ``index`` consumes) and raises ``RetryAfterException`` for
  ``CREDIT_WAIT``. Those count against the step's retries (the SDK says so), so
  ``index`` has ``CREDIT_WAIT_RETRIES`` more of them, and an ordinary failure is
  final after ``ORDINARY_ATTEMPTS`` attempts however many retries remain.
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
from datetime import UTC
from datetime import datetime
from datetime import timedelta
from typing import Any
from typing import Literal

from hatchet_sdk import ConcurrencyExpression
from hatchet_sdk import ConcurrencyLimitStrategy
from hatchet_sdk import Context
from hatchet_sdk import DesiredWorkerLabel
from hatchet_sdk import IdempotencyCollisionError
from hatchet_sdk import NonRetryableException
from hatchet_sdk import Priority
from hatchet_sdk import RateLimit
from hatchet_sdk import RateLimitDuration
from hatchet_sdk import RetryAfterException
from hatchet_sdk import StatusBasedIdempotencyConfig
from pydantic import BaseModel

from agent.common import bff_http
from agent.common import orchestrator_client
from agent.common import task_failures
from agent.observability import direct_trace
from agent.observability import orchestrator_tracing

from . import ingest_execution
from . import ingest_run_hold
from . import ingest_status_store
from .base import BaseIngestor
from .base import PreparedIngestJob
from .ingest_failures import credits_in_flight
from .ingest_scheduler import lane_of
from .ingest_scheduler import per_org_cap_from_env
from .schema import JobState

logger = logging.getLogger(__name__)

WORKFLOW_NAME = "ingest-document"
HEAVY_WORKFLOW_NAME = "ingest-document-heavy"
INDEX_STEP = "index"
SETTLE_STEP = "settle"
SETTLE_FAILED_STEP = "settle-failed"
#: The worker pool's name, as Kubernetes names it.
WORKER_NAME = "ingest-worker"
#: The worker label a pool carries, and the high-memory pool's value of it.
POOL_LABEL = "pool"
STANDARD_POOL = "standard"
HEAVY_POOL = "highmem"
#: The tenant-scoped concurrency limits both workflows share, in this order in both.
ORG_LIMIT = "ingest-org"
SUPERSEDE_LIMIT = "ingest-supersede"

#: Jobs one organisation may run at once, fleet-wide, when ``INGEST_MAX_PER_ORG``
#: is 0. Sixteen is the prod fleet's document slots (8 ingest pods at 2 each), so
#: an office alone may still use the whole fleet, as it could on the claim queue
#: without a cap; round robin hands the next free slot to the next office.
DEFAULT_MAX_RUNS_PER_ORG = 16
RETRIES = 2
#: Attempts an ordinary failure (a dropped worker, a timeout, a transient file failure) gets.
ORDINARY_ATTEMPTS = RETRIES + 1
#: Waits for in-flight credits one job may spend: ten minutes of them at ``CREDIT_WAIT``.
CREDIT_WAIT_RETRIES = 10
INDEX_RETRIES = RETRIES + CREDIT_WAIT_RETRIES
CREDIT_WAIT = timedelta(seconds=60)
#: How long new ``index`` starts wait once one has met the 402: half the retry's wait,
#: so the jobs already running finish their calls and free the credits first.
CREDIT_PAUSE = timedelta(seconds=30)
CREDIT_RATE_LIMIT_KEY = "ingest-provider-credits"
#: The key exists only to be paused, so its limit holds nothing back.
CREDIT_RATE_LIMIT_PER_SECOND = 10_000
#: The settle call is one short request; five tries over about four minutes.
SETTLE_RETRIES = 5
SETTLE_TIMEOUT = timedelta(seconds=30)
#: Waits of 8 s, then 64 s, between attempts (Hatchet: factor ** retry count).
BACKOFF_FACTOR = 8.0
BACKOFF_MAX_SECONDS = 600
#: How long a run may wait for a worker before Hatchet gives it up: the life of
#: the presigned download URL the BFF signs (24 h), after which it could not read.
SCHEDULE_TIMEOUT = timedelta(hours=24)
#: The original's size from which a job runs on the high-memory pool.
DEFAULT_HEAVY_FILE_BYTES = 40 * 1024 * 1024

PRIORITIES: dict[str, Priority] = {"interactive": Priority.HIGH, "bulk": Priority.LOW}


class IngestDocumentInput(BaseModel):
    """What a run carries: ids, the fairness and supersede keys, the priority, and the encrypted payload."""

    job_id: str
    organization_id: str
    #: The document the job indexes, or the job's own id when it names none. None
    #: only on a run an older release triggered, whose workflow version has no
    #: supersede limit.
    document_id: str | None = None
    priority: Literal["interactive", "bulk"] = "interactive"
    payload: str


def _int_env(name: str, default: int, floor: int) -> int:
    try:
        value = int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default
    return value if value >= floor else default


# @environment_variable INGEST_MAX_JOB_SECONDS
# @category Knowledge Layer
# @type int
# @default 7200
# @required false
# The longest one attempt of an ingestion job may run: the `execution_timeout` of
# the `index` step of the `ingest-document` workflows. Past it Hatchet cancels the attempt, the job stops at
# its next check, and the next attempt starts (the last one settles `interrupted`).
def max_job_seconds() -> int:
    """``INGEST_MAX_JOB_SECONDS``; unset, not a number or below one is the default."""
    return _int_env("INGEST_MAX_JOB_SECONDS", 7200, floor=1)


def heavy_file_bytes() -> int:
    """``INGEST_HEAVY_FILE_BYTES``: the original's size from which a job runs heavy; 0 is never."""
    return _int_env("INGEST_HEAVY_FILE_BYTES", DEFAULT_HEAVY_FILE_BYTES, floor=0)


def heavy_worker_slots() -> int:
    """``INGEST_HEAVY_WORKER_SLOTS``: a high-memory worker's slots, all of which its ``index`` takes."""
    return _int_env("INGEST_HEAVY_WORKER_SLOTS", 1, floor=1)


def max_runs_per_org() -> int:
    """The per-organisation ``max_runs``: ``INGEST_MAX_PER_ORG``, or ``DEFAULT_MAX_RUNS_PER_ORG``."""
    return per_org_cap_from_env() or DEFAULT_MAX_RUNS_PER_ORG


def hold_seconds() -> int:
    """How long the status row is vouched for: the wait for a worker, then every attempt and its backoff."""
    ordinary = ORDINARY_ATTEMPTS * (max_job_seconds() + BACKOFF_MAX_SECONDS)
    waits = CREDIT_WAIT_RETRIES * int((CREDIT_WAIT + CREDIT_PAUSE).total_seconds())
    return int(SCHEDULE_TIMEOUT.total_seconds()) + ordinary + waits


def concurrency() -> list[ConcurrencyExpression]:
    """Both workflows' limits, in one order (the SDK: chains that share tenant-scoped limits order them alike)."""
    return [
        ConcurrencyExpression(
            name=ORG_LIMIT,
            expression="input.organization_id",
            max_runs=max_runs_per_org(),
            limit_strategy=ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
            is_tenant_scoped=True,
        ),
        ConcurrencyExpression(
            name=SUPERSEDE_LIMIT,
            expression="input.document_id",
            max_runs=1,
            limit_strategy=ConcurrencyLimitStrategy.CANCEL_IN_PROGRESS,
            is_tenant_scoped=True,
        ),
    ]


def workflow_options(heavy: bool = False) -> dict[str, Any]:
    """A workflow's declaration, as ``Hatchet.workflow`` takes it."""
    return {
        "name": HEAVY_WORKFLOW_NAME if heavy else WORKFLOW_NAME,
        "input_validator": IngestDocumentInput,
        "default_priority": Priority.HIGH,
        "idempotency": StatusBasedIdempotencyConfig(key_expression="input.job_id", fallback_ttl=SCHEDULE_TIMEOUT),
    }


def credit_rate_limit_key(client: Any) -> str:
    """The rate-limit key every ``index`` consumes, in this stack's Hatchet namespace (keys are not namespaced)."""
    config = getattr(client, "config", None)
    namespace = getattr(config, "namespace", "") or ""
    return f"{namespace}{CREDIT_RATE_LIMIT_KEY}"


def index_options(heavy: bool = False, *, rate_limit_key: str = CREDIT_RATE_LIMIT_KEY) -> dict[str, Any]:
    """The ``index`` step, as ``Workflow.task`` takes it; the heavy one needs a high-memory worker to itself."""
    options: dict[str, Any] = {
        "name": INDEX_STEP,
        "execution_timeout": timedelta(seconds=max_job_seconds()),
        "schedule_timeout": SCHEDULE_TIMEOUT,
        "retries": INDEX_RETRIES,
        "backoff_factor": BACKOFF_FACTOR,
        "backoff_max_seconds": BACKOFF_MAX_SECONDS,
        "rate_limits": [RateLimit(static_key=rate_limit_key, units=1)],
        # On the task, not the workflow: the engine refuses tenant-scoped limits on a multi-task workflow.
        "concurrency": concurrency(),
    }
    if heavy:
        options["desired_worker_labels"] = [DesiredWorkerLabel(key=POOL_LABEL, value=HEAVY_POOL, required=True)]
        options["slot_cost"] = heavy_worker_slots()
    return options


def settle_options() -> dict[str, Any]:
    """The ``settle`` step and the failure handler: short, and tried again on their own."""
    return {
        "execution_timeout": SETTLE_TIMEOUT,
        "retries": SETTLE_RETRIES,
        "backoff_factor": 2.0,
        "backoff_max_seconds": 120,
    }


_lock = threading.Lock()
#: Each workflow as declared on the client that declared it; rebuilt when the client changes (a test's fake).
_declared: dict[bool, tuple[object, Any]] | None = None


def ingest_workflow(heavy: bool = False) -> Any:
    """The ``ingest-document`` (or ``-heavy``) workflow on this process's Hatchet client."""
    global _declared
    client = orchestrator_client.client()
    with _lock:
        if _declared is None:
            _declared = {}
        if heavy not in _declared or _declared[heavy][0] is not client:
            _declared[heavy] = (client, _declare(client, heavy))
        return _declared[heavy][1]


def _declare(client: Any, heavy: bool) -> Any:
    workflow = client.workflow(**workflow_options(heavy))

    @workflow.task(**index_options(heavy, rate_limit_key=credit_rate_limit_key(client)))
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
        raise _sanitized(job_id, refused) from None
    except Exception as error:
        raise _sanitized(job_id, error) from None


def _sanitized(job_id: str, error: Exception, *, retry: bool = True) -> Exception:
    """``error`` as Hatchet may store it: class and category, no message (``task_failures``); logged in full here.

    Tried again under the step's policy while ``retry``: a failure of the bytes
    ends as a FAILED status the step reads (``_ended``), not as an exception.
    """
    failure = task_failures.classify(error)
    logger.error("Ingestion job %s failed on Hatchet: %s", job_id, failure.text, exc_info=error)
    return orchestrator_client.task_error(failure, retry=retry)


def workflow_for(byte_size: int | None) -> bool:
    """Whether a job whose original is ``byte_size`` bytes runs heavy; an unknown size does not."""
    threshold = heavy_file_bytes()
    return bool(threshold) and byte_size is not None and byte_size >= threshold


def trigger(
    job_id: str,
    organization_id: str | None,
    priority: str | None,
    payload: str,
    *,
    document_id: str | None = None,
    byte_size: int | None = None,
) -> bool:
    """Start a run for an accepted job; whether this call started one (one already live starts none).

    ``payload`` is the job as ``ingest_dispatch.encode`` stores it, encrypted.
    ``byte_size`` (the original's, as the BFF stated it) picks the workflow;
    ``document_id`` is what a later upload of the document supersedes. The run's
    metadata carries the trigger span's ``traceparent`` (``orchestrator_tracing``).
    Raises when Hatchet cannot be reached; the caller decides what that costs.
    """
    rank = priority if priority in PRIORITIES else "interactive"
    heavy = workflow_for(byte_size)
    run_input = IngestDocumentInput(
        job_id=job_id,
        organization_id=lane_of(organization_id),
        document_id=document_id or job_id,
        priority=rank,
        payload=payload,
    )
    ids = {"job_id": job_id, "document_id": run_input.document_id, "organization_id": run_input.organization_id}
    # The row was written live a moment ago, so it is not stale before the hold lands.
    with orchestrator_tracing.linked_metadata("ingest-trigger", {**ids, "heavy": heavy}) as metadata:
        try:
            ref = ingest_workflow(heavy).run(
                run_input, wait_for_result=False, additional_metadata=metadata, priority=PRIORITIES[rank]
            )
        except IdempotencyCollisionError as collision:
            ingest_run_hold.hold(job_id, collision.existing_run_external_id, hold_seconds())
            return False
    ingest_run_hold.hold(job_id, ref.workflow_run_id, hold_seconds())
    return True


def cancel_run(run_id: str) -> None:
    """Cancel a run by its id, through the SDK's runs API. Raises when Hatchet cannot be reached."""
    orchestrator_client.client().runs.cancel(run_id)


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
    final = ctx.attempt_number >= min(ORDINARY_ATTEMPTS, ctx.max_attempts)
    if final:
        ingest_run_hold.release(run.job_id)
    if (settled := _settled_before(run.job_id, ctx.attempt_number)) is not None:
        return settled
    try:
        prepared = decode(run.payload)
    except Exception as error:  # noqa: BLE001 - a poison payload must never reach the ingestor
        ingest_execution.fail_unreadable(run.job_id, type(error).__name__)
        raise NonRetryableException(f"unreadable_job: {type(error).__name__}") from None
    started = _monotonic()
    metadata = getattr(ctx, "additional_metadata", None)
    try:
        with direct_trace.continued_from(orchestrator_tracing.traceparent_of(metadata)):
            status = ingest_execution.run_job(ingestor, prepared, still_owner=lambda: not ctx.is_cancelled)
    except Exception as error:
        if task_failures.classify(error).credits_in_flight and _may_wait(ctx):
            raise _wait_for_credits(prepared, None, ctx) from None
        raise _sanitized(run.job_id, error, retry=not final) from None
    if ctx.is_cancelled:
        return _stopped(run.job_id, _monotonic() - started, final)
    return _ended(prepared, status, ctx, final)


def _settled_before(job_id: str, attempt: int) -> dict[str, Any] | None:
    """A retry of a job an earlier attempt settled for good does nothing again (a timeout the engine retries)."""
    if attempt <= 1:
        return None
    status = ingest_status_store.get(job_id)
    if status is None or status.status in (JobState.PENDING, JobState.PROCESSING):
        return None
    if status.status == JobState.FAILED:
        raise NonRetryableException(f"ingestion job {job_id} already failed for good")
    return {"job_id": job_id, "status": status.status.value}


def _may_wait(ctx: Context) -> bool:
    """Whether a retry is left to wait for credits with."""
    return ctx.attempt_number < ctx.max_attempts


def _wait_for_credits(prepared: PreparedIngestJob, failed: Any, ctx: Context) -> RetryAfterException:
    """The 402 for credits in flight: pause new starts, keep the row waiting, and try again after ``CREDIT_WAIT``."""
    job_id = prepared.job_id
    logger.warning("Ingestion job %s met the provider's in-flight credit limit; waiting %s", job_id, CREDIT_WAIT)
    # Back to waiting, so the next attempt runs it (``_settled_before``) and no reader settles it meanwhile.
    ingest_execution.reopen(prepared, failed or ingest_status_store.get(job_id) or prepared.status, ctx.attempt_number)
    ingest_run_hold.hold(job_id, None, hold_seconds())
    try:
        until = datetime.now(UTC) + CREDIT_PAUSE
        ctx.pause_rate_limit(credit_rate_limit_key(orchestrator_client.client()), until)
    except Exception as error:  # noqa: BLE001 - the retry below is the wait; the pause only spares the others
        logger.warning("Could not pause new ingest starts (%s); waiting without", type(error).__name__)
    return RetryAfterException("ProviderCreditsInFlight (transient)", after=CREDIT_WAIT)


def _stopped(job_id: str, elapsed: float, final: bool) -> dict[str, Any]:
    """The run was cancelled: by its timeout, by a person (``ingest_dispatch.cancel``), or by a newer upload."""
    if elapsed >= max_job_seconds() - 1:
        logger.error("Ingestion job %s ran past %ds and was stopped", job_id, max_job_seconds())
        if final:
            ingest_execution.settle_timed_out(job_id)
        return {"job_id": job_id, "status": "timed_out"}
    if not ingest_run_hold.stopped_by_person(job_id):
        # The engine cancelled it for a newer run of the same document (``SUPERSEDE_LIMIT``).
        ingest_execution.settle_superseded(job_id)
        return {"job_id": job_id, "status": "superseded"}
    # A person stopped it. The cancel settled the row; the run may have written
    # it live again before it saw the cancel, so settle it once more.
    ingest_status_store.settle_cancelled(job_id)
    return {"job_id": job_id, "status": "cancelled"}


def _ended(prepared: PreparedIngestJob, status, ctx: Context, final: bool) -> dict[str, Any]:
    outcome = ingest_execution.outcome_of(status)
    if outcome.state == "live":
        raise RuntimeError(f"ingestion job {prepared.job_id} stopped without a final status")
    if outcome.state == "failed" and outcome.retryable and _credits_in_flight(status) and _may_wait(ctx):
        raise _wait_for_credits(prepared, status, ctx)
    if outcome.state == "failed" and outcome.retryable and not final:
        ingest_execution.reopen(prepared, status, ctx.attempt_number)
        raise RuntimeError(f"ingestion job {prepared.job_id} failed for the moment; tried again")
    if outcome.state == "failed":
        # Failed for good; ``settle-failed`` tells the BFF. The category only: a message may name the file.
        raise NonRetryableException(f"ingestion job {prepared.job_id} failed for good")
    return {"job_id": prepared.job_id, "status": status.status.value}


def _credits_in_flight(status) -> bool:
    """Whether the job's failure is the provider's in-flight credit 402, on a failed file or the job."""
    messages = [d.error_message for d in status.file_details if d.retryable] or [status.error_message]
    return any(credits_in_flight(message) for message in messages)


def serve(
    lifespan: Callable[[], AbstractAsyncContextManager[BaseIngestor]],
    decode: Callable[[str], PreparedIngestJob],
    *,
    slots: int,
    pool: str = STANDARD_POOL,
) -> None:
    """Run the ingest worker of ``pool``: ``slots`` steps at once, until SIGTERM has drained them. Blocks.

    The standard pool serves ``ingest-document``, the high-memory pool (``HEAVY_POOL``)
    ``ingest-document-heavy``, labelled ``pool=highmem`` so the heavy ``index``
    finds it. ``lifespan`` builds the ingestor (the agent runtime's workflow) on
    the worker's own event loop and keeps it for the worker's life. The SDK owns
    the signals: on SIGTERM it stops taking runs and waits for the ones it holds.
    """
    _runtime.decode = decode
    heavy = pool == HEAVY_POOL
    client = orchestrator_client.client()

    async def worker_lifespan():
        async with lifespan() as ingestor:
            _runtime.ingestor = ingestor
            try:
                yield ingestor
            finally:
                _runtime.ingestor = None

    orchestrator_tracing.instrument(getattr(client, "config", None))
    # A static key must exist before a step consumes it; it is only ever paused.
    client.rate_limits.put(credit_rate_limit_key(client), CREDIT_RATE_LIMIT_PER_SECOND, RateLimitDuration.SECOND)
    worker = client.worker(
        f"{WORKER_NAME}-heavy" if heavy else WORKER_NAME,
        slots=heavy_worker_slots() if heavy else max(1, slots),
        labels={POOL_LABEL: pool},
        workflows=[ingest_workflow(heavy)],
        lifespan=worker_lifespan,
    )
    worker.start()
