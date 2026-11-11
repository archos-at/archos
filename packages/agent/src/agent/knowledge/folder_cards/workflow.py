"""The ``folder-cards-*`` tasks: the folder card builder on Hatchet (ADR-0127, ADR-0150).

The thin layer between the orchestrator and the builder, and the only module of
folder cards that imports ``hatchet_sdk``. What a task does is ``worker``'s;
Temporal, the documented exit, would replace this file and nothing below it.

Three workflows, served by the standard ingest worker (``ingest_workflow.serve``),
because a build needs the summary model and the embedder that worker holds:

* ``folder-cards-sweep``, every minute: starts a ``folder-cards-build`` run for
  each collection that holds a due folder (``worker.sweep``). The debounce stays
  in our dirty set (``queue``: two clocks per folder that every mark moves), so
  something has to ask it; the engine's cron does, once for the fleet, where
  every ingest worker used to poll.
* ``folder-cards-build``: one collection's due folders, children before parents
  (``worker.build_collection``). ``give-up`` is its failure handler.
* ``folder-cards-reconcile``, nightly: marks every folder whose card no longer
  matches its inputs (``worker.reconcile``).

What Hatchet holds of a run is the collection's name and its organisation, both
ids: never a folder path, which is a person's words, and nothing of a document.
A task's error reaches it as a class and a category (``task_failures``).

* **One build per collection:** ``folder-cards-build`` is idempotent on
  ``input.collection`` while a run of it is live, so the sweep's next minute,
  or a second trigger from anywhere, starts nothing. That replaces the claim.
* **Fairness:** one tenant-scoped concurrency limit, ``folder-cards-org``, keyed
  on ``input.organization_id`` with ``GROUP_ROUND_ROBIN``: an organisation
  builds one collection at a time, and a free slot goes to the organisations
  in turn. One at a time also keeps the monthly token budget's read-then-spend
  honest.
* **Retries:** ``RETRIES`` more attempts of ``build``, 25 s and then ten minutes
  apart. A folder that failed is the only work the next attempt finds; on the
  last attempt it is given up there and then (``worker._give_up``). ``give-up``
  runs only for a run that never got that far (its worker lost on every
  attempt, or every attempt timed out) and makes its folders wait a quiet
  period again.
* **A long build runs once:** the engine holds the run for ``BUILD_TIMEOUT``
  and hands it to nobody else meanwhile. The builder stops starting folders
  after ``worker.RUN_BUDGET_SECONDS``, well inside it; the claim queue this
  replaced handed a folder out again after 900 s whether or not it was still
  being built.
* **Slots of their own:** the three tasks are durable tasks for one reason, a
  worker counts durable slots apart from its standard ones. A build waits on a
  model, not on a CPU, so it must neither take a document's slot nor wait
  behind two hours of ingestion; ``WORKER_SLOTS`` per worker is the one builder
  per pod the old loop was, plus room for the sweep. None of them uses a
  durable wait, so no eviction policy applies.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from datetime import timedelta
from typing import Any

from hatchet_sdk import ConcurrencyExpression
from hatchet_sdk import ConcurrencyLimitStrategy
from hatchet_sdk import Context
from hatchet_sdk import DurableContext
from hatchet_sdk import EmptyModel
from hatchet_sdk import IdempotencyCollisionError
from hatchet_sdk import StatusBasedIdempotencyConfig
from pydantic import BaseModel

from agent.common import orchestrator_client
from agent.common import task_failures
from agent.observability import direct_trace
from agent.observability import orchestrator_tracing

from . import worker

logger = logging.getLogger(__name__)

BUILD_WORKFLOW = "folder-cards-build"
SWEEP_WORKFLOW = "folder-cards-sweep"
RECONCILE_WORKFLOW = "folder-cards-reconcile"
BUILD_STEP = "build"
GIVE_UP_STEP = "give-up"
ORG_LIMIT = "folder-cards-org"

#: Durable slots a standard ingest worker offers these tasks.
WORKER_SLOTS = 2
SWEEP_CRON = "* * * * *"
#: Nightly, UTC, off the hour.
RECONCILE_CRON = "23 2 * * *"

RETRIES = 2
#: Waits of 25 s, then ``BACKOFF_MAX_SECONDS``, between attempts (Hatchet: factor ** retry count).
BACKOFF_FACTOR = 25.0
BACKOFF_MAX_SECONDS = 600
#: The builder's own budget plus the slowest single folder.
BUILD_TIMEOUT = timedelta(seconds=worker.RUN_BUDGET_SECONDS + 600)
#: How long a build may wait for a slot. Past it the run is gone and the folders, still dirty, are swept again.
BUILD_SCHEDULE_TIMEOUT = timedelta(hours=1)
#: A sweep that found no worker within its minute is dropped: the next one is as good.
SWEEP_SCHEDULE_TIMEOUT = timedelta(seconds=50)
SWEEP_TIMEOUT = timedelta(minutes=2)
RECONCILE_TIMEOUT = timedelta(hours=1)
GIVE_UP_TIMEOUT = timedelta(seconds=30)


class FolderCardsBuildInput(BaseModel):
    """What a build run carries: the collection (the idempotency key) and its organisation (the fairness key)."""

    collection: str
    organization_id: str


def build_options() -> dict[str, Any]:
    """The ``build`` task, as ``Workflow.durable_task`` takes it."""
    return {
        "name": BUILD_STEP,
        "execution_timeout": BUILD_TIMEOUT,
        "schedule_timeout": BUILD_SCHEDULE_TIMEOUT,
        "retries": RETRIES,
        "backoff_factor": BACKOFF_FACTOR,
        "backoff_max_seconds": BACKOFF_MAX_SECONDS,
        "eviction_policy": None,
        "concurrency": [
            ConcurrencyExpression(
                name=ORG_LIMIT,
                expression="input.organization_id",
                max_runs=1,
                limit_strategy=ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
                is_tenant_scoped=True,
            )
        ],
    }


def build_workflow_options() -> dict[str, Any]:
    return {
        "name": BUILD_WORKFLOW,
        "input_validator": FolderCardsBuildInput,
        "idempotency": StatusBasedIdempotencyConfig(
            key_expression="input.collection", fallback_ttl=BUILD_SCHEDULE_TIMEOUT + BUILD_TIMEOUT
        ),
    }


_lock = threading.Lock()
#: The workflows as declared on the client that declared them; rebuilt when the client changes (a test's fake).
_declared: tuple[object, list[Any]] | None = None


def workflows() -> list[Any]:
    """The build, sweep and reconcile workflows on this process's Hatchet client, for a worker to serve."""
    global _declared
    client = orchestrator_client.client()
    with _lock:
        if _declared is None or _declared[0] is not client:
            _declared = (client, [_declare_build(client), _declare_sweep(client), _declare_reconcile(client)])
        return list(_declared[1])


def _declare_build(client: Any) -> Any:
    workflow = client.workflow(**build_workflow_options())

    @workflow.durable_task(**build_options())
    async def build(input: FolderCardsBuildInput, ctx: DurableContext) -> dict[str, Any]:
        return await build_step(input, ctx)

    @workflow.on_failure_task(name=GIVE_UP_STEP, execution_timeout=GIVE_UP_TIMEOUT, retries=RETRIES)
    def give_up(input: FolderCardsBuildInput, ctx: Context) -> dict[str, Any]:
        return give_up_step(input)

    return workflow


def _declare_sweep(client: Any) -> Any:
    workflow = client.workflow(name=SWEEP_WORKFLOW, on_crons=[SWEEP_CRON])

    @workflow.durable_task(
        name="sweep", execution_timeout=SWEEP_TIMEOUT, schedule_timeout=SWEEP_SCHEDULE_TIMEOUT, eviction_policy=None
    )
    async def sweep(input: EmptyModel, ctx: DurableContext) -> dict[str, Any]:
        return await sweep_step()

    return workflow


def _declare_reconcile(client: Any) -> Any:
    workflow = client.workflow(name=RECONCILE_WORKFLOW, on_crons=[RECONCILE_CRON])

    @workflow.durable_task(name="reconcile", execution_timeout=RECONCILE_TIMEOUT, retries=1, eviction_policy=None)
    async def reconcile(input: EmptyModel, ctx: DurableContext) -> dict[str, Any]:
        return await reconcile_step()

    return workflow


def _sanitized(what: str, error: BaseException) -> Exception:
    """``error`` as Hatchet may store it: class and category, no message; logged in full here. Always retried."""
    failure = task_failures.classify(error)
    logger.error("%s failed on Hatchet: %s", what, failure.text, exc_info=error)
    return orchestrator_client.task_error(failure, retry=True)


async def build_step(run: FolderCardsBuildInput, ctx: Any) -> dict[str, Any]:
    """One attempt of ``build``. Its output is counts by outcome: nothing of a folder."""
    final = ctx.attempt_number >= ctx.max_attempts
    traceparent = orchestrator_tracing.traceparent_of(getattr(ctx, "additional_metadata", None))
    try:
        with direct_trace.continued_from(traceparent):
            report = await worker.build_collection(
                run.collection, run.organization_id, final=final, should_stop=lambda: bool(ctx.is_cancelled)
            )
    except worker.BuildFailed as failed:
        raise _sanitized(f"Folder cards of {run.collection}", failed.report.failures[0]) from None
    except Exception as error:
        raise _sanitized(f"Folder cards of {run.collection}", error) from None
    return {"collection": run.collection, "outcomes": dict(report.outcomes)}


def give_up_step(run: FolderCardsBuildInput) -> dict[str, Any]:
    try:
        return {"collection": run.collection, "deferred": worker.give_up_run(run.collection)}
    except Exception as error:
        raise _sanitized(f"Giving up folder cards of {run.collection}", error) from None


async def sweep_step() -> dict[str, Any]:
    try:
        return {"started": await asyncio.to_thread(worker.sweep, trigger)}
    except Exception as error:
        raise _sanitized("The folder card sweep", error) from None


async def reconcile_step() -> dict[str, Any]:
    try:
        return {"marked": await worker.reconcile()}
    except Exception as error:
        raise _sanitized("The folder card reconcile", error) from None


def trigger(collection: str, organization_id: str) -> bool:
    """Start a build run for ``collection``; whether this call started one (one already live starts none).

    The run's metadata carries the trigger span's ``traceparent``, so the
    trigger, the run's wait for a slot and every generation are one trace.
    Raises when Hatchet cannot be reached.
    """
    run_input = FolderCardsBuildInput(collection=collection, organization_id=organization_id)
    with orchestrator_tracing.linked_metadata("folder-cards-trigger", run_input.model_dump()) as metadata:
        try:
            workflows()[0].run(run_input, wait_for_result=False, additional_metadata=metadata)
        except IdempotencyCollisionError:
            return False
    return True
