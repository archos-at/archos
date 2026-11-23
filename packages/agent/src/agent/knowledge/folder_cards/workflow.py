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

WORKER_SLOTS = 2
SWEEP_CRON = "* * * * *"
RECONCILE_CRON = "23 2 * * *"

RETRIES = 2
BACKOFF_FACTOR = 25.0
BACKOFF_MAX_SECONDS = 600
BUILD_TIMEOUT = timedelta(seconds=worker.RUN_BUDGET_SECONDS + 600)
BUILD_SCHEDULE_TIMEOUT = timedelta(hours=1)
SWEEP_SCHEDULE_TIMEOUT = timedelta(seconds=50)
SWEEP_TIMEOUT = timedelta(minutes=2)
RECONCILE_TIMEOUT = timedelta(hours=1)
GIVE_UP_TIMEOUT = timedelta(seconds=30)


class FolderCardsBuildInput(BaseModel):
    collection: str
    organization_id: str


def workflows() -> list[Any]:
    return list(_declare(orchestrator_client.client()))


@functools.cache
def _declare(client: Any) -> tuple[Any, Any, Any]:
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
    run_input = FolderCardsBuildInput(collection=collection, organization_id=organization_id)
    with orchestrator_tracing.linked_metadata("folder-cards-trigger", run_input.model_dump()) as metadata:
        try:
            workflows()[0].run(run_input, wait_for_result=False, additional_metadata=metadata)
        except IdempotencyCollisionError:
            return False
    return True
