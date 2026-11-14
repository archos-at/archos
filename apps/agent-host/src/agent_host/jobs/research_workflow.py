"""Research runs on Hatchet: the ``research-run`` task, and starting and cancelling it (ADR-0150).

The thin layer between Hatchet and the research run path, and the only module
of research that imports ``hatchet_sdk``. What a run does is ``worker.run_stored_job``;
this module says how Hatchet holds it:

* FAIR. Concurrency ``GROUP_ROUND_ROBIN`` keyed on ``input.organization_id``
  with ``MAX_ACTIVE_JOBS_PER_ORG`` running per organization: one office's
  scheduled sweep does not make another office's question wait.
* PRIORITISED. An ``interactive`` job runs at ``Priority.HIGH``, a ``bulk``
  one (a scheduled fire) at ``Priority.LOW``.
* WAITS, IS NOT REFUSED. The schedule timeout is a day, the job's own expiry,
  so a busy organization's job waits instead of being dropped.
* RETRIED WHEN THE WORKER IS LOST OR THE FAILURE MAY PASS. ``retries`` is
  ``RESEARCH_WORKER_MAX_ATTEMPTS`` less the first. A transient failure (the job
  database away, a timeout, a provider 5xx or 429; ``task_failures.classify``)
  is tried again, and the retry's ownership check (``run_ownership``) runs
  nothing when the job already ended. A run that failed on its own already
  wrote its verdict, and an unreadable payload fails the same way every time,
  so both raise ``NonRetryableException``. Spent attempts and a run past its
  execution timeout reach the on-failure task, which writes FAILURE unless a
  verdict stands.
* NO MESSAGE TO HATCHET. A failure reaches the engine as its class and
  category, raised ``from None``; the message and its traceback chain, which
  may name a file or a URL, go to our own logs only.
* NO TENANT CONTENT. The input carries ids, the priority and the
  ``payload_crypto`` ciphertext. Without a ``JOB_PAYLOAD_KEK`` nothing is sent.

Cancellation stays a status flip: the cancel route writes INTERRUPTED, which the
run's ``CancellationMonitor`` polls, and also cancels the Hatchet run here so a
run that has not started never starts. The request-context envelope (ADR-0108)
is renewed by the run path itself at its start (``agent_job_setup``), so a run
that waited hours on Hatchet starts with a fresh one.
"""

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

#: The task's name, fixed by the migration contract.
TASK_NAME = "research-run"
#: The worker pool name on Hatchet, the k8s tier that runs it.
WORKER_NAME = "agent-worker"
#: The CEL expression that groups runs for fairness.
CONCURRENCY_KEY = "input.organization_id"
#: The fairness group of a job that names no organization.
PLATFORM_LANE = "__platform__"
#: How long a run may wait for a slot: the job's own default expiry.
SCHEDULE_TIMEOUT = timedelta(days=1)
#: Interactive before bulk, inside one organization's group.
PRIORITIES = {"interactive": Priority.HIGH, "bulk": Priority.LOW}
DEFAULT_PRIORITY = "interactive"
#: How often the worker touches the liveness file the pod's probe reads.
_LIVENESS_EVERY_SECONDS = 15


class ResearchRunInput(BaseModel):
    """What Hatchet stores of a research job: ids, the priority and the ciphertext, nothing in the clear."""

    job_id: str
    #: The fairness group: the organization, or ``PLATFORM_LANE`` when none.
    organization_id: str
    priority: str
    #: ``payload_crypto.serialize_encrypted`` of the ``run_agent_job`` kwargs.
    payload: str


def _int_env(name: str, default: int, *, floor: int | None = None) -> int:
    """``name`` as an int; ``default`` when unset, not a number, or below ``floor``."""
    try:
        value = int(os.environ.get(name, ""))
    except ValueError:
        return default
    return default if floor is not None and value < floor else value


def priority_of(name: str | None) -> Priority:
    """The Hatchet priority of a job's priority name; ``interactive`` when none. An unknown name is refused."""
    try:
        return PRIORITIES[name or DEFAULT_PRIORITY]
    except KeyError:
        raise ValueError(f"unknown research job priority {name!r}; expected one of {sorted(PRIORITIES)}") from None


def check_submittable(priority: str | None) -> None:
    """Refuse, before anything is persisted, a job that could never be started: unknown priority, no KEK."""
    priority_of(priority)
    payload_crypto.require_kek()


# @environment_variable MAX_ACTIVE_JOBS_PER_ORG
# @category Server
# @type int
# @default 3
# @required false
# Research jobs one organization may RUN at once, fleet-wide, so one tenant cannot
# occupy every worker. It is the `research-run` concurrency cap per organization:
# a job over it waits on Hatchet instead of being refused. 0 or negative disables it.
def max_active_per_org() -> int:
    """Research jobs an organization may run at once; 0 or less is no cap."""
    return _int_env("MAX_ACTIVE_JOBS_PER_ORG", 3)


# @environment_variable RESEARCH_RUN_TIMEOUT_SECONDS
# @category Agent Jobs
# @type int
# @default 7200
# @required false
# How long one attempt of a research run may execute before Hatchet cancels it.
# A backstop well past the deep researcher's own 40-minute wall clock, not a
# budget: the run stops itself first.
def execution_timeout() -> timedelta:
    """The execution timeout of one attempt."""
    return timedelta(seconds=_int_env("RESEARCH_RUN_TIMEOUT_SECONDS", 7200, floor=60))


# @environment_variable RESEARCH_WORKER_MAX_ATTEMPTS
# @category Server
# @type int
# @default 3
# @required false
# Attempts of a research run before it is given up and marked FAILURE. Only a
# lost worker or a timeout spends one: a run that fails on its own is not retried.
def retries() -> int:
    """Attempts after the first."""
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
    """A poison payload fails the same way every time; anything else is classified."""
    if isinstance(exc, worker.PoisonPayloadError):
        return task_failures.TaskFailure(type(exc).__name__, DETERMINISTIC)
    return task_failures.classify(exc)


async def _forget(db_url: str, job_id: str) -> None:
    try:
        await asyncio.to_thread(orchestrator_runs.forget, db_url, job_id)
    except Exception:
        logger.warning("Job %s: its Hatchet run id was not forgotten", job_id, exc_info=True)


async def run_task(run: ResearchRunInput, attempt: int | None = None) -> dict[str, str]:
    """One attempt of a research run: the run path, its failures mapped to Hatchet's terms.

    The failure is logged in full here and reaches Hatchet as its class and
    category only (``task_failures``). A transient one (the job database
    away, a timeout, a provider 5xx or 429) is retried; anything else is not.
    """
    db_url = _db_url()
    try:
        ran = await worker.run_stored_job(db_url, run.job_id, run.payload, attempt)
    except Exception as exc:
        failure = _failure_of(exc)
        logger.error("Job %s failed on Hatchet: %s", run.job_id, failure.text, exc_info=exc)
        if not failure.transient:
            # The retry keeps the id for its cancel; a run that ends here does not need it.
            await _forget(db_url, run.job_id)
        raise orchestrator_client.task_error(failure, retry=failure.transient) from None
    # A cancel ends the run too: only a lost worker leaves the id for its retry,
    # and a duplicate copy leaves it to the copy that runs.
    if ran:
        await _forget(db_url, run.job_id)
    return {"job_id": run.job_id, "ran": "yes" if ran else "duplicate"}


async def record_failure(run: ResearchRunInput) -> None:
    """Every attempt is spent, or the run outlived its timeout: FAILURE, unless a verdict stands."""
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
    """The ``research-run`` workflow on ``hatchet``, declared once per client."""
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
    """Start ``research-run`` for a persisted job without waiting, and remember its run id."""
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
        # The run exists; the cancel route still stops it through job_info.
        logger.warning("Job %s: Hatchet run %s started but its id was not stored", job_id, run_id, exc_info=True)
    logger.info("Job %s started as Hatchet run %s", job_id, run_id)
    return run_id


async def cancel(db_url: str, job_id: str) -> bool:
    """Cancel the Hatchet run of ``job_id``, if one is recorded; whether a cancel was sent.

    A failed cancel is logged, not raised: INTERRUPTED is already written, a
    running run's ``CancellationMonitor`` stops on it, and a run that starts
    later finds the job terminal and does not run.
    """
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
    """The worker's lifespan: touch the liveness file while its event loop runs, and run the cutover.

    The cutover moves what the old ``research_job_queue`` still holds onto
    Hatchet, from boot on (``requeue_legacy.cutover_loop``); it ends on its own.
    """
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
        # Stopped between rows, never mid-transaction: a pass ends after the row it holds.
        stop.set()
        await asyncio.gather(cutover, return_exceptions=True)


def run_worker() -> None:
    """The agent-worker role: register ``research-run`` and run it until SIGTERM.

    ``RESEARCH_WORKERS`` is the worker's slots. On SIGTERM the SDK stops taking
    runs and waits for the ones it holds; a pod killed before they end is a lost
    worker, whose runs Hatchet assigns again.
    """
    from agent.observability import orchestrator_tracing
    from agent.observability import otlp_metrics
    from agent.observability.boot_timing import BootClock

    hatchet = orchestrator_client.client()
    otlp_metrics.install_from_env()
    # The SDK's step-run spans, into Langfuse beside the run's own (never into Hatchet's database).
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
