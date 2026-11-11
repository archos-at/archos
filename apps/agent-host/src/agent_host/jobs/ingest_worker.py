"""The dedicated ingestion worker tier (ADR-0076, ADR-0150).

Run as its own container: ``PROCESS_ROLE=ingest-worker`` makes the entrypoint start
``python -m agent_host.jobs.ingest_worker``. It is a Hatchet worker serving the
``ingest-document`` task (``agent.knowledge.ingest_workflow``). Its lifespan builds
the agent-runtime workflow once, which activates the ingestor exactly as the web
roles do (same summary model, same shared Qdrant, same object store), and then
Hatchet hands it runs, ``INGEST_MAX_WORKERS`` at once, fair across every
organisation.

No web server, no port, no state of its own: jobs live in Hatchet, their status
in Postgres, vectors in the shared Qdrant cluster.

On SIGTERM the SDK stops taking runs and waits for the ones it holds; a pod that
is killed instead (OOM, node loss) leaves its runs to Hatchet, which tries them
again. Re-indexing replaces a file's chunks, so the second run is the one that
counts.

From boot on it also moves what the retired claim queue holds onto Hatchet
(``agent.knowledge.ingest_cutover``), every minute while that table has jobs,
since API pods on the old release write it until the rollout ends; and it runs
the folder card builder beside the task.

Config (env):
  CONFIG_FILE / NAT_CONFIG_FILE        the agent-runtime config the web tier runs
  INGEST_MAX_WORKERS               jobs this process runs at once (default 2)
  INGEST_WORKER_POOL               `standard` (default, `ingest-document`) or `highmem`
                                   (`ingest-document-heavy`, `INGEST_HEAVY_WORKER_SLOTS` slots)
  WORKER_LIVENESS_FILE            touched while the worker is alive
  HATCHET_CLIENT_*                 the Hatchet connection (the SDK's own variables)
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import time
from collections.abc import AsyncIterator

from agent.common.data_flow_register import assert_no_latent_vendor
from agent.common.logging_utils import suppress_noisy_dependency_logs
from agent.common.residency import assert_residency
from agent.knowledge import ingest_cutover
from agent.knowledge import ingest_workflow
from agent.knowledge.leader_lock import require_direct_dsns

from . import ingest_dispatch
from . import lease_policy

logger = logging.getLogger(__name__)

_DEFAULT_CONFIG = "/app/configs/config_oib_openrouter.yml"
_LIVENESS_EVERY_SECONDS = 15
#: How often the worker moves what the retired claim queue holds onto Hatchet.
CUTOVER_EVERY_SECONDS = 60
#: How long that queue must hold nothing before the worker stops asking.
CUTOVER_QUIET_SECONDS = 3600


def _pool() -> str:
    """``INGEST_WORKER_POOL``: which workflow this worker serves; anything but ``highmem`` is the standard pool."""
    pool = os.environ.get("INGEST_WORKER_POOL", "").strip().lower()
    return ingest_workflow.HEAVY_POOL if pool == ingest_workflow.HEAVY_POOL else ingest_workflow.STANDARD_POOL


def _slots() -> int:
    """``INGEST_MAX_WORKERS``, the per-pod concurrency the adapter documents (default 2)."""
    return max(1, lease_policy.int_env("INGEST_MAX_WORKERS", 2, floor=1))


@contextlib.asynccontextmanager
async def ingestor_lifespan() -> AsyncIterator:
    """Build the ingestor, keep the side loops running beside the task, and tear down at the end."""
    from agent.knowledge.factory import get_active_ingestor
    from agent.observability import boot_timing
    from agent.observability import ensure_registered as register_telemetry
    from agent.observability.boot_timing import BootClock
    from nat.builder.workflow_builder import WorkflowBuilder
    from nat.runtime.loader import load_config

    config_file = os.environ.get("CONFIG_FILE") or os.environ.get("NAT_CONFIG_FILE") or _DEFAULT_CONFIG
    # Grid's telemetry `_type`s register at import; load_config fails without them.
    register_telemetry()
    clock = BootClock("ingest-worker")
    with clock.phase("load_config"):
        config = load_config(config_file)
    building = time.monotonic()
    async with WorkflowBuilder.from_config(config=config):
        clock.record("workflow_build", time.monotonic() - building)
        ingestor = get_active_ingestor()
        if ingestor is None or getattr(ingestor, "supports_durable_jobs", False) is not True:
            raise RuntimeError(f"{config_file} activates no ingestor that runs jobs from Hatchet")
        clock.ready()
        boot_timing.flush()
        stop = asyncio.Event()
        loops = [
            _start_folder_cards(stop),
            asyncio.create_task(_liveness(stop), name="liveness"),
            asyncio.create_task(_cutover_loop(stop), name="ingest-cutover"),
        ]
        try:
            yield ingestor
        finally:
            stop.set()
            await asyncio.gather(*loops, return_exceptions=True)


def _cut_over() -> bool:
    """One pass: the cheap check, then a batch onto Hatchet; whether the old queue still had jobs.

    Best effort: a failed pass counts as one that found jobs, so the loop keeps going.
    """
    try:
        if ingest_cutover.live_rows() == 0:
            return False
        ingest_cutover.redispatch_queued(ingest_workflow.trigger)
    except Exception as error:  # noqa: BLE001 - a failed cutover must not keep the worker down
        logger.warning("Ingest cutover pass failed (%s); the next one tries again", type(error).__name__)
    return True


async def _cutover_loop(
    stop: asyncio.Event, *, every: float = CUTOVER_EVERY_SECONDS, quiet_for: float = CUTOVER_QUIET_SECONDS
) -> None:
    """Pass after pass while the retired queue holds jobs: API pods on the old release still write it.

    The first pass runs at boot. Once the table has held nothing for
    ``quiet_for`` seconds the loop stops, and the worker asks no more.
    """
    quiet = 0.0
    while quiet < quiet_for:
        quiet = 0.0 if await asyncio.to_thread(_cut_over) else quiet + every
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=every)
        if stop.is_set():
            return
    logger.info("Ingest cutover: %s held no job for %ds; no longer checked", ingest_cutover.TABLE, int(quiet_for))


async def _liveness(stop: asyncio.Event) -> None:
    liveness = os.environ.get("WORKER_LIVENESS_FILE", "/tmp/ingest-worker.alive")
    while not stop.is_set():
        lease_policy.touch_liveness(liveness)
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=_LIVENESS_EVERY_SECONDS)


def _start_folder_cards(stop: asyncio.Event) -> asyncio.Task:
    """The folder card builder's loop, beside the task.

    It always runs: whether an organization has cards is its ``folder-cards`` WorkOS
    flag, which the builder asks the BFF per claimed folder (ADR-0127), so a
    deployment where no organization has the flag finds an empty queue.
    """
    from agent.knowledge.folder_cards import worker

    logger.info("Ingest worker builds folder cards")
    return asyncio.create_task(worker.loop(stop), name="folder-cards")


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
    suppress_noisy_dependency_logs()
    # Every file takes a `keyed_lock` while it replaces its predecessor, which
    # needs the direct DSN (ADR-0083). It never LISTENs. Fail the boot, not the
    # first file.
    require_direct_dsns(listen=False)
    assert_no_latent_vendor()
    assert_residency()  # no model call outside the cell's zone (ADR-0167)
    ingest_workflow.serve(ingestor_lifespan, ingest_dispatch.decode, slots=_slots(), pool=_pool())


if __name__ == "__main__":
    main()
