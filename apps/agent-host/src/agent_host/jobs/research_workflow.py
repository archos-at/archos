from __future__ import annotations

import asyncio
import logging
import os
import socket
from collections.abc import AsyncIterator
from datetime import timedelta
from typing import Any

from hatchet_sdk import ConcurrencyExpression
from hatchet_sdk import ConcurrencyLimitStrategy
from hatchet_sdk import Context
from hatchet_sdk import Hatchet
from hatchet_sdk import Priority
from pydantic import BaseModel

from agent.common import orchestrator_client
from agent.common import task_failures
from agent.knowledge.ingest_failures import DETERMINISTIC

from . import orchestrator_runs
from . import payload_crypto
from . import worker

logger = logging.getLogger(__name__)

TASK_NAME = "research-run"
WORKER_NAME = "agent-worker"
CONCURRENCY_KEY = "input.organization_id"
PLATFORM_LANE = "__platform__"
SCHEDULE_TIMEOUT = timedelta(days=1)
PRIORITIES = {"interactive": Priority.HIGH, "bulk": Priority.LOW}
DEFAULT_PRIORITY = "interactive"
_LIVENESS_EVERY_SECONDS = 15


class ResearchRunInput(BaseModel):
    job_id: str
    organization_id: str
    priority: str
    payload: str


def _int_env(name: str, default: int, *, floor: int | None = None) -> int:
    try:
        value = int(os.environ.get(name, ""))
    except ValueError:
        return default
    return default if floor is not None and value < floor else value


def priority_of(name: str | None) -> Priority:
    try:
        return PRIORITIES[name or DEFAULT_PRIORITY]
    except KeyError:
        raise ValueError(f"unknown research job priority {name!r}; expected one of {sorted(PRIORITIES)}") from None


def check_submittable(priority: str | None) -> None:
    priority_of(priority)
    payload_crypto.require_kek()


def max_active_per_org() -> int:
    return _int_env("MAX_ACTIVE_JOBS_PER_ORG", 3)


def execution_timeout() -> timedelta:
    return timedelta(seconds=_int_env("RESEARCH_RUN_TIMEOUT_SECONDS", 7200, floor=60))


def retries() -> int:
    return _int_env("RESEARCH_WORKER_MAX_ATTEMPTS", 3, floor=1) - 1


def _concurrency() -> ConcurrencyExpression | None:
    cap = max_active_per_org()
    if cap <= 0:
        return None
    return ConcurrencyExpression(
        expression=CONCURRENCY_KEY, max_runs=cap, limit_strategy=ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN
    )


def _db_url() -> str:
    return os.environ.get("NAT_JOB_STORE_DB_URL", "sqlite:///./data/jobs.db")


def _failure_of(exc: Exception) -> task_failures.TaskFailure:
    if isinstance(exc, worker.PoisonPayloadError):
        return task_failures.TaskFailure(type(exc).__name__, DETERMINISTIC)
    return task_failures.classify(exc)


async def _forget(db_url: str, job_id: str) -> None:
    try:
        await asyncio.to_thread(orchestrator_runs.forget, db_url, job_id)
    except Exception:
        logger.warning("Job %s: its Hatchet run id was not forgotten", job_id, exc_info=True)


async def run_task(run: ResearchRunInput, attempt: int | None = None) -> dict[str, str]:
    db_url = _db_url()
    try:
        ran = await worker.run_stored_job(db_url, run.job_id, run.payload, attempt)
    except Exception as exc:
        failure = _failure_of(exc)
        logger.error("Job %s failed on Hatchet: %s", run.job_id, failure.text, exc_info=exc)
        if not failure.transient:
            await _forget(db_url, run.job_id)
        raise orchestrator_client.task_error(failure, retry=failure.transient) from None
    if ran:
        await _forget(db_url, run.job_id)
    return {"job_id": run.job_id, "ran": "yes" if ran else "duplicate"}


async def record_failure(run: ResearchRunInput) -> None:
    db_url = _db_url()
    try:
        await worker.record_exhausted_verdict(db_url, run.job_id)
    except Exception as exc:
        failure = task_failures.classify(exc)
        logger.error("Job %s: its failure was not recorded: %s", run.job_id, failure.text, exc_info=exc)
        raise orchestrator_client.task_error(failure, retry=False) from None
    await _forget(db_url, run.job_id)


_declared: dict[int, tuple[Hatchet, Any]] = {}


def research_run(hatchet: Hatchet) -> Any:
    declared = _declared.get(id(hatchet))
    if declared is not None and declared[0] is hatchet:
        return declared[1]
    workflow = hatchet.workflow(
        name=TASK_NAME,
        input_validator=ResearchRunInput,
        concurrency=_concurrency(),
        default_priority=Priority.HIGH,
    )

    @workflow.task(
        name="run",
        execution_timeout=execution_timeout(),
        schedule_timeout=SCHEDULE_TIMEOUT,
        retries=retries(),
    )
    async def _run(run: ResearchRunInput, ctx: Context) -> dict[str, str]:
        logger.info("Hatchet run %s: job %s, attempt %s", ctx.workflow_run_id, run.job_id, ctx.attempt_number)
        return await run_task(run, ctx.attempt_number)

    @workflow.on_failure_task(name="record-failure")
    async def _on_failure(run: ResearchRunInput, ctx: Context) -> None:
        await record_failure(run)

    _declared[id(hatchet)] = (hatchet, workflow)
    return workflow


async def start(
    db_url: str, job_id: str, payload: dict[str, Any], organization_id: str | None, priority: str | None
) -> str:
    name = priority or DEFAULT_PRIORITY
    run = ResearchRunInput(
        job_id=job_id,
        organization_id=organization_id or PLATFORM_LANE,
        priority=name,
        payload=payload_crypto.serialize_encrypted(payload),
    )
    ref = await research_run(orchestrator_client.client()).aio_run(
        run,
        wait_for_result=False,
        priority=priority_of(name),
        additional_metadata={"job_id": job_id, "organization_id": run.organization_id},
    )
    run_id = ref.workflow_run_id
    try:
        await asyncio.to_thread(orchestrator_runs.record, db_url, job_id, run_id)
    except Exception:
        logger.warning("Job %s: Hatchet run %s started but its id was not stored", job_id, run_id, exc_info=True)
    logger.info("Job %s started as Hatchet run %s", job_id, run_id)
    return run_id


async def cancel(db_url: str, job_id: str) -> bool:
    run_id = await asyncio.to_thread(orchestrator_runs.run_id_for, db_url, job_id)
    if run_id is None:
        return False
    try:
        await asyncio.wait_for(
            orchestrator_client.client().runs.aio_cancel(run_id), orchestrator_client.REST_TIMEOUT_SECONDS
        )
    except Exception:
        logger.warning("Job %s: Hatchet run %s not cancelled; INTERRUPTED stops it", job_id, run_id, exc_info=True)
        return False
    await asyncio.to_thread(orchestrator_runs.forget, db_url, job_id)
    logger.info("Job %s: Hatchet run %s cancelled", job_id, run_id)
    return True


def _touch_liveness(path: str) -> None:
    try:
        with open(path, "w") as handle:
            handle.write("ok")
    except OSError:
        logger.warning("Could not write the liveness file %s", path, exc_info=True)


async def _liveness() -> AsyncIterator[None]:
    from . import requeue_legacy

    path = os.environ.get("WORKER_LIVENESS_FILE", "/tmp/research-worker.alive")

    async def _touch() -> None:
        while True:
            _touch_liveness(path)
            await asyncio.sleep(_LIVENESS_EVERY_SECONDS)

    task = asyncio.create_task(_touch())
    stop = asyncio.Event()
    cutover = asyncio.create_task(requeue_legacy.cutover_loop(_db_url(), stop), name="research-cutover")
    try:
        yield None
    finally:
        task.cancel()
        stop.set()
        await asyncio.gather(cutover, return_exceptions=True)


def run_worker() -> None:
    from agent.observability import orchestrator_tracing
    from agent.observability import otlp_metrics
    from agent.observability.boot_timing import BootClock

    hatchet = orchestrator_client.client()
    otlp_metrics.install_from_env()
    orchestrator_tracing.instrument(getattr(hatchet, "config", None))
    slots = _int_env("RESEARCH_WORKERS", 1, floor=1)
    hatchet_worker = hatchet.worker(
        f"{WORKER_NAME}-{socket.gethostname()}",
        slots=slots,
        workflows=[research_run(hatchet)],
        lifespan=_liveness,
    )
    logger.info("Research worker on Hatchet started (slots=%s, per-org cap=%s)", slots, max_active_per_org())
    BootClock("research-worker").ready()
    hatchet_worker.start()
