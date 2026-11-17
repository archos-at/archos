from __future__ import annotations

import logging
import os
import threading
import time
from collections.abc import Callable
from collections.abc import Sequence
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
WORKER_NAME = "ingest-worker"
POOL_LABEL = "pool"
STANDARD_POOL = "standard"
HEAVY_POOL = "highmem"
ORG_LIMIT = "ingest-org"
SUPERSEDE_LIMIT = "ingest-supersede"

DEFAULT_MAX_RUNS_PER_ORG = 16
RETRIES = 2
ORDINARY_ATTEMPTS = RETRIES + 1
CREDIT_WAIT_RETRIES = 10
INDEX_RETRIES = RETRIES + CREDIT_WAIT_RETRIES
CREDIT_WAIT = timedelta(seconds=60)
CREDIT_PAUSE = timedelta(seconds=30)
CREDIT_RATE_LIMIT_KEY = "ingest-provider-credits"
CREDIT_RATE_LIMIT_PER_SECOND = 10_000
SETTLE_RETRIES = 5
SETTLE_TIMEOUT = timedelta(seconds=30)
BACKOFF_FACTOR = 8.0
BACKOFF_MAX_SECONDS = 600
SCHEDULE_TIMEOUT = timedelta(hours=24)
DEFAULT_HEAVY_FILE_BYTES = 40 * 1024 * 1024

PRIORITIES: dict[str, Priority] = {"interactive": Priority.HIGH, "bulk": Priority.LOW}


class IngestDocumentInput(BaseModel):
    job_id: str
    organization_id: str
    document_id: str | None = None
    priority: Literal["interactive", "bulk"] = "interactive"
    payload: str


def _int_env(name: str, default: int, floor: int) -> int:
    try:
        value = int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default
    return value if value >= floor else default


def max_job_seconds() -> int:
    return _int_env("INGEST_MAX_JOB_SECONDS", 7200, floor=1)


def heavy_file_bytes() -> int:
    return _int_env("INGEST_HEAVY_FILE_BYTES", DEFAULT_HEAVY_FILE_BYTES, floor=0)


def heavy_worker_slots() -> int:
    return _int_env("INGEST_HEAVY_WORKER_SLOTS", 1, floor=1)


def max_runs_per_org() -> int:
    return per_org_cap_from_env() or DEFAULT_MAX_RUNS_PER_ORG


def hold_seconds() -> int:
    ordinary = ORDINARY_ATTEMPTS * (max_job_seconds() + BACKOFF_MAX_SECONDS)
    waits = CREDIT_WAIT_RETRIES * int((CREDIT_WAIT + CREDIT_PAUSE).total_seconds())
    return int(SCHEDULE_TIMEOUT.total_seconds()) + ordinary + waits


def organization_limit(name: str, max_runs: int) -> ConcurrencyExpression:
    return ConcurrencyExpression(
        name=name,
        expression="input.organization_id",
        max_runs=max_runs,
        limit_strategy=ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
        is_tenant_scoped=True,
    )


def concurrency() -> list[ConcurrencyExpression]:
    return [
        organization_limit(ORG_LIMIT, max_runs_per_org()),
        ConcurrencyExpression(
            name=SUPERSEDE_LIMIT,
            expression="input.document_id",
            max_runs=1,
            limit_strategy=ConcurrencyLimitStrategy.CANCEL_IN_PROGRESS,
            is_tenant_scoped=True,
        ),
    ]


def workflow_options(heavy: bool = False) -> dict[str, Any]:
    return {
        "name": HEAVY_WORKFLOW_NAME if heavy else WORKFLOW_NAME,
        "input_validator": IngestDocumentInput,
        "default_priority": Priority.HIGH,
        "idempotency": StatusBasedIdempotencyConfig(key_expression="input.job_id", fallback_ttl=SCHEDULE_TIMEOUT),
    }


def credit_rate_limit_key(client: Any) -> str:
    config = getattr(client, "config", None)
    namespace = getattr(config, "namespace", "") or ""
    return f"{namespace}{CREDIT_RATE_LIMIT_KEY}"


def index_options(heavy: bool = False, *, rate_limit_key: str = CREDIT_RATE_LIMIT_KEY) -> dict[str, Any]:
    options: dict[str, Any] = {
        "name": INDEX_STEP,
        "execution_timeout": timedelta(seconds=max_job_seconds()),
        "schedule_timeout": SCHEDULE_TIMEOUT,
        "retries": INDEX_RETRIES,
        "backoff_factor": BACKOFF_FACTOR,
        "backoff_max_seconds": BACKOFF_MAX_SECONDS,
        "rate_limits": [RateLimit(static_key=rate_limit_key, units=1)],
        "concurrency": concurrency(),
    }
    if heavy:
        options["desired_worker_labels"] = [DesiredWorkerLabel(key=POOL_LABEL, value=HEAVY_POOL, required=True)]
        options["slot_cost"] = heavy_worker_slots()
    return options


def settle_options() -> dict[str, Any]:
    return {
        "execution_timeout": SETTLE_TIMEOUT,
        "retries": SETTLE_RETRIES,
        "backoff_factor": 2.0,
        "backoff_max_seconds": 120,
    }


_lock = threading.Lock()
_declared: dict[bool, tuple[object, Any]] | None = None


def ingest_workflow(heavy: bool = False) -> Any:
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
    return orchestrator_client.sanitized(f"Ingestion job {job_id}", error, retry=retry)


def workflow_for(byte_size: int | None) -> bool:
    threshold = heavy_file_bytes()
    return bool(threshold) and byte_size is not None and byte_size >= threshold


class WorkflowNotRegistered(RuntimeError): ...


_registered: dict[bool, object] = {}


def require_registered(heavy: bool) -> None:
    ingest_workflow(heavy)
    client = orchestrator_client.client()
    if _registered.get(heavy) is client:
        return
    name = HEAVY_WORKFLOW_NAME if heavy else WORKFLOW_NAME
    listed = orchestrator_client.within_rest_timeout(lambda: client.workflows.list(workflow_name=name))
    wanted = client.config.apply_namespace(name)
    if not any(workflow.name == wanted for workflow in listed.rows or []):
        raise WorkflowNotRegistered(f"no worker has registered {wanted} yet")
    _registered[heavy] = client


def trigger(
    job_id: str,
    organization_id: str | None,
    priority: str | None,
    payload: str,
    *,
    document_id: str | None = None,
    byte_size: int | None = None,
) -> bool:
    rank = priority if priority in PRIORITIES else "interactive"
    heavy = workflow_for(byte_size)
    require_registered(heavy)
    run_input = IngestDocumentInput(
        job_id=job_id,
        organization_id=lane_of(organization_id),
        document_id=document_id or job_id,
        priority=rank,
        payload=payload,
    )
    ids = {"job_id": job_id, "document_id": run_input.document_id, "organization_id": run_input.organization_id}
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
    orchestrator_client.within_rest_timeout(lambda: orchestrator_client.client().runs.cancel(run_id))


class _Runtime:
    ingestor: BaseIngestor | None = None
    decode: Callable[[str], PreparedIngestJob] | None = None


_runtime = _Runtime()
_monotonic = time.monotonic


def execute(run: IngestDocumentInput, ctx: Context) -> dict[str, Any]:
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
    if attempt <= 1:
        return None
    status = ingest_status_store.get(job_id)
    if status is None or status.status in (JobState.PENDING, JobState.PROCESSING):
        return None
    if status.status == JobState.FAILED:
        raise NonRetryableException(f"ingestion job {job_id} already failed for good")
    return {"job_id": job_id, "status": status.status.value}


def _may_wait(ctx: Context) -> bool:
    return ctx.attempt_number < ctx.max_attempts


def _wait_for_credits(prepared: PreparedIngestJob, failed: Any, ctx: Context) -> RetryAfterException:
    job_id = prepared.job_id
    logger.warning("Ingestion job %s met the provider's in-flight credit limit; waiting %s", job_id, CREDIT_WAIT)
    ingest_execution.reopen(prepared, failed or ingest_status_store.get(job_id) or prepared.status, ctx.attempt_number)
    ingest_run_hold.hold(job_id, None, hold_seconds())
    try:
        until = datetime.now(UTC) + CREDIT_PAUSE
        ctx.pause_rate_limit(credit_rate_limit_key(orchestrator_client.client()), until)
    except Exception as error:  # noqa: BLE001 - the retry below is the wait; the pause only spares the others
        logger.warning("Could not pause new ingest starts (%s); waiting without", type(error).__name__)
    return RetryAfterException("ProviderCreditsInFlight (transient)", after=CREDIT_WAIT)


def _stopped(job_id: str, elapsed: float, final: bool) -> dict[str, Any]:
    if elapsed >= max_job_seconds() - 1:
        logger.error("Ingestion job %s ran past %ds and was stopped", job_id, max_job_seconds())
        if final:
            ingest_execution.settle_timed_out(job_id)
        return {"job_id": job_id, "status": "timed_out"}
    if not ingest_run_hold.stopped_by_person(job_id):
        ingest_execution.settle_superseded(job_id)
        return {"job_id": job_id, "status": "superseded"}
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
        raise NonRetryableException(f"ingestion job {prepared.job_id} failed for good")
    return {"job_id": prepared.job_id, "status": status.status.value}


def _credits_in_flight(status) -> bool:
    messages = [d.error_message for d in status.file_details if d.retryable] or [status.error_message]
    return any(credits_in_flight(message) for message in messages)


def serve(
    lifespan: Callable[[], AbstractAsyncContextManager[BaseIngestor]],
    decode: Callable[[str], PreparedIngestJob],
    *,
    slots: int,
    pool: str = STANDARD_POOL,
    also: Sequence[Any] = (),
    durable_slots: int | None = None,
) -> None:
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
    client.rate_limits.put(credit_rate_limit_key(client), CREDIT_RATE_LIMIT_PER_SECOND, RateLimitDuration.SECOND)
    worker = client.worker(
        f"{WORKER_NAME}-heavy" if heavy else WORKER_NAME,
        slots=heavy_worker_slots() if heavy else max(1, slots),
        labels={POOL_LABEL: pool},
        durable_slots=durable_slots,
        workflows=[ingest_workflow(heavy), *also],
        lifespan=worker_lifespan,
    )
    worker.start()
