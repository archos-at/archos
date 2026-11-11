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
  attempt, or every attempt timed out): its folders wait a quiet period again,
  and after ``queue.GIVE_UP_ROUNDS`` such runs they leave the dirty set until
  the nightly reconcile (``worker.give_up_run``), so nothing is tried for ever.
* **A long build runs once:** the engine holds the run for ``BUILD_TIMEOUT``
  and hands it to nobody else meanwhile. The builder stops starting folders
  after ``worker.RUN_BUDGET_SECONDS``, well inside it; the claim queue this
  replaced handed a folder out again after 900 s whether or not it was still
  being built.
* **Slots of their own:** a build waits on a model for up to half an hour, and
  an ingest pod's two or three standard slots are sized to the memory of a
  document being read. In those slots two organisations' builds would hold
  every upload of a pod back, and a long import would hold every build back. So
  the three tasks are durable tasks, for one reason: the durable slots are the
  only second pool a worker of hatchet-sdk 1.44.0 has. They use no durable wait,
  so no eviction policy applies. The evidence, re-read whenever the SDK moves:

  * A worker's pools are ``default`` and ``durable`` and no other
    (``hatchet_sdk/types/slot_types.py:4``). ``Hatchet.worker`` takes ``slots``
    and ``durable_slots`` and hands the SDK's slot resolver no other pool
    (``hatchet.py:309``). A task draws on ``durable`` by being durable
    (``runnables/task.py:185``); ``slot_cost`` charges ``default`` only
    (``runnables/workflow.py:1482``). The resolver knows "custom slot types"
    (``utils/slots.py:76``), and no public decorator can ask for one.
  * A second ``hatchet.worker(...)`` in the process is not supported. Each
    ``Worker`` installs the process's SIGTERM handler when it is built
    (``worker/worker.py:145`` and ``:717``), so only the last one drains, and
    ``start`` owns its thread's event loop and blocks (``:432``). Tried on
    engine v0.114.2 with the second worker on a thread: both served, each from
    its own slots, but its tasks ran on another loop than the lifespan's (the
    summary model's client), it took a new run after SIGTERM, and the process
    did not exit.
  * A worker label routes a run to a worker; it reserves nothing inside one.

  ``test_folder_card_workflow_engine.py`` holds the isolation on a real engine.
  The day the SDK lets a task name a pool, these become plain tasks on one.
"""

from __future__ import annotations

import asyncio
import functools
from datetime import timedelta
from typing import Any

from hatchet_sdk import IdempotencyCollisionError
from hatchet_sdk import StatusBasedIdempotencyConfig
from pydantic import BaseModel

from agent.common import orchestrator_client
from agent.knowledge.ingest_workflow import organization_limit
from agent.observability import direct_trace
from agent.observability import orchestrator_tracing

from . import worker

BUILD_WORKFLOW = "folder-cards-build"
SWEEP_WORKFLOW = "folder-cards-sweep"
RECONCILE_WORKFLOW = "folder-cards-reconcile"
BUILD_STEP = "build"
GIVE_UP_STEP = "give-up"
ORG_LIMIT = "folder-cards-org"

#: Durable slots a standard ingest worker offers these tasks: the one builder per pod the old loop was, and the sweep.
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


def workflows() -> list[Any]:
    """The build, sweep and reconcile workflows on this process's Hatchet client, for a worker to serve."""
    return list(_declare(orchestrator_client.client()))


@functools.cache
def _declare(client: Any) -> tuple[Any, Any, Any]:
    """Declared once per client: a test's fake is another client, and declares its own.

    Each task is its step function below, called as the SDK calls a task: ``(input, ctx)``.
    """
    build = client.workflow(
        name=BUILD_WORKFLOW,
        input_validator=FolderCardsBuildInput,
        idempotency=StatusBasedIdempotencyConfig(
            key_expression="input.collection", fallback_ttl=BUILD_SCHEDULE_TIMEOUT + BUILD_TIMEOUT
        ),
    )
    build.durable_task(
        name=BUILD_STEP,
        execution_timeout=BUILD_TIMEOUT,
        schedule_timeout=BUILD_SCHEDULE_TIMEOUT,
        retries=RETRIES,
        backoff_factor=BACKOFF_FACTOR,
        backoff_max_seconds=BACKOFF_MAX_SECONDS,
        eviction_policy=None,
        concurrency=[organization_limit(ORG_LIMIT, max_runs=1)],
    )(build_step)
    build.on_failure_task(name=GIVE_UP_STEP, execution_timeout=GIVE_UP_TIMEOUT, retries=RETRIES)(give_up_step)
    sweep = client.workflow(name=SWEEP_WORKFLOW, on_crons=[SWEEP_CRON])
    sweep.durable_task(
        name="sweep", execution_timeout=SWEEP_TIMEOUT, schedule_timeout=SWEEP_SCHEDULE_TIMEOUT, eviction_policy=None
    )(sweep_step)
    reconcile = client.workflow(name=RECONCILE_WORKFLOW, on_crons=[RECONCILE_CRON])
    reconcile.durable_task(name="reconcile", execution_timeout=RECONCILE_TIMEOUT, retries=1, eviction_policy=None)(
        reconcile_step
    )
    return build, sweep, reconcile


async def build_step(run: FolderCardsBuildInput, ctx: Any) -> dict[str, Any]:
    """One attempt of ``build``. Its output is counts by outcome: nothing of a folder.

    What it raises, a failed folder's error among them, reaches Hatchet as a class
    and a category (``orchestrator_client.sanitized``) and is always retried.
    """
    final = ctx.attempt_number >= ctx.max_attempts
    traceparent = orchestrator_tracing.traceparent_of(getattr(ctx, "additional_metadata", None))
    try:
        with direct_trace.continued_from(traceparent):
            report = await worker.build_collection(
                run.collection, run.organization_id, final=final, should_stop=lambda: bool(ctx.is_cancelled)
            )
    except Exception as error:
        raise orchestrator_client.sanitized(f"Folder cards of {run.collection}", error) from None
    return {"collection": run.collection, "outcomes": dict(report.outcomes)}


def give_up_step(run: FolderCardsBuildInput, ctx: Any = None) -> dict[str, Any]:
    try:
        return {"collection": run.collection, **worker.give_up_run(run.collection)}
    except Exception as error:
        raise orchestrator_client.sanitized(f"Giving up folder cards of {run.collection}", error) from None


async def sweep_step(input: Any = None, ctx: Any = None) -> dict[str, Any]:
    try:
        return {"started": await asyncio.to_thread(worker.sweep, trigger)}
    except Exception as error:
        raise orchestrator_client.sanitized("The folder card sweep", error) from None


async def reconcile_step(input: Any = None, ctx: Any = None) -> dict[str, Any]:
    try:
        return {"marked": await worker.reconcile()}
    except Exception as error:
        raise orchestrator_client.sanitized("The folder card reconcile", error) from None


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
