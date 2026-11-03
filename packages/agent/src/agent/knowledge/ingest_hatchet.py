"""The ``ingest-document`` workflows: ingestion jobs on Hatchet (ADR-0150, ADR-0151).

The thin layer between the orchestrator and the job, and the only module of
ingestion that imports ``hatchet_sdk``: it declares the workflows, triggers a run
per accepted job (``trigger``), cancels one (``cancel_run``) and serves them
(``serve``). What a run does is ``ingest_execution``'s and ``ingest_steps``'s;
Temporal, the documented exit, would replace this file and nothing below it.
The runbook is ``docs/deployment/hatchet.md``.

* ``ingest-document`` on the standard pool, ``ingest-document-heavy`` on the
  high-memory one (``pool=highmem``, its ``index`` takes the worker's slots),
  picked by the original's size (``INGEST_HEAVY_FILE_BYTES``).
* Two steps, ``index`` (``ingest_execution.run_job``) then ``settle`` (the BFF
  push, retried on its own), with ``settle-failed`` as the failure handler. Under
  ``INGEST_PAGE_FAN_OUT`` the standard ``ingest-document`` is declared in steps
  instead (``_declare_fan_out``, ``ingest_steps``): ``extract``, a ``read-page``
  task per page that needs a model, waited for by a durable ``read-pages``,
  ``assemble-write``, the enrichment steps, ``settle``.
* A run's input holds ids, the organisation, the priority and the payload the
  API tier encrypted (``payload_crypto``), never a file name or document text.
* **Fairness and supersede:** ``ingest-org`` (``GROUP_ROUND_ROBIN`` on
  ``input.organization_id``, ``max_runs_per_org()``) and ``ingest-supersede``
  (``CANCEL_IN_PROGRESS`` on ``input.document_id``), named and tenant-scoped,
  so one limit spans both workflows. A superseded run records itself so
  (``ingest_execution.settle_superseded``). ``read-page`` has its own two:
  ``ingest-page-read-fleet`` at ``VLM_FLEET_CONCURRENCY`` and
  ``ingest-page-read-org``.
* **Priority:** ``interactive`` is ``Priority.HIGH``, ``bulk`` ``Priority.LOW``.
* **Retries:** per step with backoff; a failure of the bytes raises
  ``NonRetryableException``; what reaches Hatchet is the class and category only
  (``task_failures``). The provider's 402 for credits in flight pauses new
  ``index`` starts (``ingest-provider-credits``) and retries after
  ``CREDIT_WAIT``, ``CREDIT_WAIT_RETRIES`` times; an ordinary failure is final
  after ``ORDINARY_ATTEMPTS``.
* **Idempotency:** one live run per job id.
"""

from __future__ import annotations

import contextlib
import logging
import threading
import time
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from contextlib import AbstractContextManager
from datetime import UTC
from datetime import datetime
from datetime import timedelta
from typing import Any
from typing import Literal

from hatchet_sdk import ConcurrencyExpression
from hatchet_sdk import ConcurrencyLimitStrategy
from hatchet_sdk import Context
from hatchet_sdk import DesiredWorkerLabel
from hatchet_sdk import DurableContext
from hatchet_sdk import IdempotencyCollisionError
from hatchet_sdk import NonRetryableException
from hatchet_sdk import ParentCondition
from hatchet_sdk import Priority
from hatchet_sdk import RateLimit
from hatchet_sdk import RateLimitDuration
from hatchet_sdk import RetryAfterException
from hatchet_sdk import StatusBasedIdempotencyConfig
from pydantic import BaseModel

from agent.common import bff_http
from agent.common import hatchet_client
from agent.common import task_failures
from agent.observability import direct_trace
from agent.observability import hatchet_tracing

from . import ingest_execution
from . import ingest_run_hold
from . import ingest_status_store
from . import ingest_steps
from .base import BaseIngestor
from .base import PreparedIngestJob
from .ingest_scheduler import lane_of
from .ingest_steps import DEFAULT_MAX_RUNS_PER_ORG  # noqa: F401 - named here, where the limit is declared
from .ingest_steps import ReadPageInput
from .ingest_steps import _credits_in_flight
from .ingest_steps import _stopped
from .ingest_steps import fleet_vision_cap
from .ingest_steps import heavy_worker_slots
from .ingest_steps import max_job_seconds
from .ingest_steps import max_runs_per_org
from .ingest_steps import page_read_slots
from .ingest_steps import page_runs
from .ingest_steps import workflow_for
from .page_fan_out_port import PageNotRead
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
#: The page fan-out (``INGEST_PAGE_FAN_OUT``, ADR-0151): its steps, its page task and that task's pool and limits.
EXTRACT_STEP = "extract"
READ_PAGES_STEP = "read-pages"
ASSEMBLE_STEP = "assemble-write"
PERMIT_STEP = "enrich-permit"
WRITE_ROWS_STEP = "enrich-write"
READ_PAGE_WORKFLOW_NAME = "read-page"
PAGE_READ_POOL = "page-read"
PAGE_READER_NAME = "ingest-page-reader"
PAGE_FLEET_LIMIT = "ingest-page-read-fleet"
PAGE_ORG_LIMIT = "ingest-page-read-org"
READ_PAGE_RETRIES = 2
READ_PAGE_TIMEOUT = timedelta(minutes=5)
EXTRACT_TIMEOUT = timedelta(minutes=30)
ENRICH_TIMEOUT = timedelta(minutes=3)

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
        "concurrency": concurrency(),
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
_declared: dict[str, tuple[object, Any]] | None = None


def _declared_on(shape: str, declare: Callable[[Any], Any]) -> Any:
    global _declared
    client = hatchet_client.client()
    with _lock:
        if _declared is None:
            _declared = {}
        if shape not in _declared or _declared[shape][0] is not client:
            _declared[shape] = (client, declare(client))
        return _declared[shape][1]


def ingest_workflow(heavy: bool = False) -> Any:
    """``ingest-document`` (in steps under ``INGEST_PAGE_FAN_OUT``), or ``-heavy``, on this process's client."""
    if heavy:
        return _declared_on("heavy", lambda client: _declare(client, True))
    if ingest_steps.page_fan_out():
        return _declared_on("fan-out", _declare_fan_out)
    return _declared_on("standard", lambda client: _declare(client, False))


def read_page_task() -> Any:
    """``read-page``, the page fan-out's task for one page, on this process's client."""
    return _declared_on(READ_PAGE_WORKFLOW_NAME, _declare_read_page)


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


# ---------------------------------------------------------------- the page fan-out (ADR-0151)


def read_page_concurrency() -> list[ConcurrencyExpression]:
    """The fleet's vision cap on page tasks (``VLM_FLEET_CONCURRENCY``), then the organizations in turn inside it."""
    cap = fleet_vision_cap()
    limits = ((PAGE_FLEET_LIMIT, "'fleet'"), (PAGE_ORG_LIMIT, "input.organization_id"))
    return [
        ConcurrencyExpression(
            name=name,
            expression=expression,
            max_runs=cap,
            limit_strategy=ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
            is_tenant_scoped=True,
        )
        for name, expression in limits
    ]


def _declare_read_page(client: Any) -> Any:
    @client.task(
        name=READ_PAGE_WORKFLOW_NAME,
        input_validator=ReadPageInput,
        concurrency=read_page_concurrency(),
        execution_timeout=READ_PAGE_TIMEOUT,
        schedule_timeout=SCHEDULE_TIMEOUT,
        retries=READ_PAGE_RETRIES,
        backoff_factor=2.0,
        backoff_max_seconds=60,
    )
    def read_page(input: ReadPageInput, ctx: Context) -> dict[str, Any]:
        return read_page_attempt(input, ctx)

    return read_page


def read_page_attempt(run: ReadPageInput, ctx: Context) -> dict[str, Any]:
    """One attempt of a page: a page not read is tried again, and its last attempt records it unread."""
    final = ctx.attempt_number >= ctx.max_attempts
    try:
        return ingest_steps.read_page(
            run.payload, page=run.page, kind=run.kind, content_hash=run.content_hash, final=final
        )
    except PageNotRead as not_read:
        raise RuntimeError(f"page {run.page} of job {run.job_id} not read ({not_read}); tried again") from None
    except Exception as error:
        raise _sanitized(run.job_id, error, retry=not final) from None


def _fan_out_step(timeout: timedelta, **options: Any) -> dict[str, Any]:
    return {"execution_timeout": timeout, "retries": RETRIES, "backoff_factor": 2.0, **options}


def _declare_fan_out(client: Any) -> Any:
    """``ingest-document`` in steps. The tenant-scoped limits sit on ``extract`` and ``assemble-write``.

    The engine refuses a tenant-scoped limit at the level of a workflow of
    several tasks, so ``ingest-org`` and ``ingest-supersede`` (``concurrency()``,
    in the same order) hold the two steps that do a file's work; named, they are
    one limit across both.
    """
    options = workflow_options(False)
    options.pop("concurrency", None)
    workflow = client.workflow(**options)
    index = {**index_options(rate_limit_key=credit_rate_limit_key(client)), "concurrency": concurrency()}

    @workflow.task(**_fan_out_step(EXTRACT_TIMEOUT, name=EXTRACT_STEP, concurrency=concurrency()))
    def extract(input: IngestDocumentInput, ctx: Context) -> dict[str, Any]:
        return ingest_steps.extract(input.payload)

    # Durable: it waits on a durable slot, never on one its page tasks need, and may be evicted while it waits.
    @workflow.durable_task(
        name=READ_PAGES_STEP,
        parents=[extract],
        execution_timeout=index["execution_timeout"],
        skip_if=[ParentCondition(parent=extract, expression="output.fan_out == false")],
    )
    async def read_pages(input: IngestDocumentInput, ctx: DurableContext) -> dict[str, Any]:
        task = read_page_task()
        items = [
            task.create_bulk_run_item(input=page, key=f"{input.job_id}:{page.page}")
            for page in page_runs(input, ctx.task_output(extract))
        ]
        results = await task.aio_run_many(items, return_exceptions=True) if items else []
        return ingest_steps.summarize_reads(list(results))

    @workflow.task(**{**index, "name": ASSEMBLE_STEP, "parents": [extract, read_pages]})
    def assemble_write(input: IngestDocumentInput, ctx: Context) -> dict[str, Any]:
        return assemble_attempt(input, ctx, ctx.task_output(extract))

    _declare_after_write(workflow, extract, assemble_write)
    return workflow


def _declare_after_write(workflow: Any, extract: Any, assemble_write: Any) -> None:
    """The enrichment steps (skipped when the write did not defer them), the permit after the tags, then ``settle``."""
    stored = ParentCondition(parent=assemble_write, expression="output.enrichment_stored == 0")
    calls = [
        _declare_enrichment(workflow, name, [extract, assemble_write], stored, extract)
        for name in ingest_steps.ENRICHMENTS
    ]
    tags = calls[ingest_steps.ENRICHMENTS.index("tags")]

    @workflow.task(
        **_fan_out_step(
            ENRICH_TIMEOUT,
            name=PERMIT_STEP,
            parents=[extract, tags],
            skip_if=[ParentCondition(parent=tags, expression="output.permit == false")],
        )
    )
    def enrich_permit(input: IngestDocumentInput, ctx: Context) -> dict[str, Any]:
        return ingest_steps.permit(input.payload, ctx.task_output(extract).get("content_hash"))

    @workflow.task(**_fan_out_step(ENRICH_TIMEOUT, name=WRITE_ROWS_STEP, parents=[extract, *calls]))
    def enrich_write(input: IngestDocumentInput, ctx: Context) -> dict[str, Any]:
        return ingest_steps.write_rows(input.payload, ctx.task_output(extract).get("content_hash"))

    @workflow.task(name=SETTLE_STEP, parents=[enrich_write, enrich_permit], **settle_options())
    def settle(input: IngestDocumentInput, ctx: Context) -> dict[str, Any]:
        return settle_step(input.job_id)

    @workflow.on_failure_task(name=SETTLE_FAILED_STEP, **settle_options())
    def settle_failed(input: IngestDocumentInput, ctx: Context) -> dict[str, Any]:
        return settle_step(input.job_id)


def _declare_enrichment(workflow: Any, name: str, parents: list[Any], skip: Any, extract: Any) -> Any:
    @workflow.task(**_fan_out_step(ENRICH_TIMEOUT, name=f"enrich-{name}", parents=parents, skip_if=[skip]))
    def enrich_one(input: IngestDocumentInput, ctx: Context) -> dict[str, Any]:
        return ingest_steps.enrich(input.payload, name, ctx.task_output(extract).get("content_hash"))

    return enrich_one


def assemble_attempt(run: IngestDocumentInput, ctx: Context, extracted: dict[str, Any]) -> dict[str, Any]:
    """``index``'s attempt over the page answers; its output adds the assembly's counts (references only)."""
    counts: dict[str, int] = {"answers": 0, "pages_read_here": 0, "enrichment_stored": 0}
    return {**execute(run, ctx, scope=ingest_steps.assembly(extracted, counts)), **counts}


def served_workflows(pool: str) -> list[Any]:
    """What a pool's worker registers: its workflow, and the page tasks on the standard pool under the fan-out."""
    if pool == HEAVY_POOL:
        return [ingest_workflow(True)]
    if pool == PAGE_READ_POOL:
        return [read_page_task()]
    return [ingest_workflow(False), *([read_page_task()] if ingest_steps.page_fan_out() else [])]


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
    return hatchet_client.task_error(failure, retry=retry)


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
    metadata carries the trigger span's ``traceparent`` (``hatchet_tracing``).
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
    with hatchet_tracing.linked_metadata("ingest-trigger", {**ids, "heavy": heavy}) as metadata:
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
    hatchet_client.client().runs.cancel(run_id)


class _Runtime:
    """What the served workflow runs with: set once by ``serve`` in the worker process."""

    ingestor: BaseIngestor | None = None
    decode: Callable[[str], PreparedIngestJob] | None = None


_runtime = _Runtime()
#: The clock an attempt's runtime is read on; a seam for the tests.
_monotonic = time.monotonic


def execute(
    run: IngestDocumentInput,
    ctx: Context,
    scope: Callable[[PreparedIngestJob], AbstractContextManager[Any]] | None = None,
) -> dict[str, Any]:
    """One attempt of the ``index`` step (see the module docstrings here and in ``ingest_execution``).

    ``scope`` wraps the run: the page fan-out's ``assemble-write`` runs it with the
    page answers read back and the enrichment deferred (``ingest_steps.assembly``).
    """
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
        with direct_trace.continued_from(hatchet_tracing.traceparent_of(metadata)), (scope or _no_scope)(prepared):
            status = ingest_execution.run_job(ingestor, prepared, still_owner=lambda: not ctx.is_cancelled)
    except Exception as error:
        if task_failures.classify(error).credits_in_flight and _may_wait(ctx):
            raise _wait_for_credits(prepared, None, ctx) from None
        raise _sanitized(run.job_id, error, retry=not final) from None
    if ctx.is_cancelled:
        return _stopped(run.job_id, _monotonic() - started, final)
    return _ended(prepared, status, ctx, final)


def _no_scope(_prepared: PreparedIngestJob) -> AbstractContextManager[None]:
    return contextlib.nullcontext()


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
        ctx.pause_rate_limit(credit_rate_limit_key(hatchet_client.client()), until)
    except Exception as error:  # noqa: BLE001 - the retry below is the wait; the pause only spares the others
        logger.warning("Could not pause new ingest starts (%s); waiting without", type(error).__name__)
    return RetryAfterException("ProviderCreditsInFlight (transient)", after=CREDIT_WAIT)


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
    client = hatchet_client.client()
    if pool == PAGE_READ_POOL:
        slots = page_read_slots()

    async def worker_lifespan():
        async with lifespan() as ingestor:
            _runtime.ingestor = ingestor
            try:
                yield ingestor
            finally:
                _runtime.ingestor = None

    hatchet_tracing.instrument(getattr(client, "config", None))
    # A static key must exist before a step consumes it; it is only ever paused.
    client.rate_limits.put(credit_rate_limit_key(client), CREDIT_RATE_LIMIT_PER_SECOND, RateLimitDuration.SECOND)
    worker = client.worker(
        {HEAVY_POOL: f"{WORKER_NAME}-heavy", PAGE_READ_POOL: PAGE_READER_NAME}.get(pool, WORKER_NAME),
        slots=heavy_worker_slots() if heavy else max(1, slots),
        labels={POOL_LABEL: pool},
        workflows=served_workflows(pool),
        lifespan=worker_lifespan,
    )
    worker.start()
