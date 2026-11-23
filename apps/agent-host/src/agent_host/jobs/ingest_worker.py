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
from agent.knowledge import ingest_workflow
from agent.knowledge.leader_lock import require_direct_dsns

from . import ingest_dispatch
from . import lease_policy

logger = logging.getLogger(__name__)

_DEFAULT_CONFIG = "/app/configs/config_oib_openrouter.yml"
_LIVENESS_EVERY_SECONDS = 15


def _pool() -> str:
    pool = os.environ.get("INGEST_WORKER_POOL", "").strip().lower()
    return ingest_workflow.HEAVY_POOL if pool == ingest_workflow.HEAVY_POOL else ingest_workflow.STANDARD_POOL


def _slots() -> int:
    return max(1, lease_policy.int_env("INGEST_MAX_WORKERS", 2, floor=1))


@contextlib.asynccontextmanager
async def ingestor_lifespan() -> AsyncIterator:
    from agent.knowledge.factory import get_active_ingestor
    from agent.observability import boot_timing
    from agent.observability import ensure_registered as register_telemetry
    from agent.observability.boot_timing import BootClock
    from nat.builder.workflow_builder import WorkflowBuilder
    from nat.runtime.loader import load_config

    config_file = os.environ.get("CONFIG_FILE") or os.environ.get("NAT_CONFIG_FILE") or _DEFAULT_CONFIG
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
        liveness = asyncio.create_task(_liveness(stop), name="liveness")
        try:
            yield ingestor
        finally:
            stop.set()
            await asyncio.gather(liveness, return_exceptions=True)


async def _liveness(stop: asyncio.Event) -> None:
    liveness = os.environ.get("WORKER_LIVENESS_FILE", "/tmp/ingest-worker.alive")
    while not stop.is_set():
        lease_policy.touch_liveness(liveness)
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=_LIVENESS_EVERY_SECONDS)


def _folder_cards(pool: str) -> dict:
    if pool == ingest_workflow.HEAVY_POOL:
        return {}
    from agent.knowledge.folder_cards import workflow

    logger.info("Ingest worker serves the folder card tasks")
    return {"also": workflow.workflows(), "durable_slots": workflow.WORKER_SLOTS}


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
    suppress_noisy_dependency_logs()
    require_direct_dsns(listen=False)
    assert_no_latent_vendor()
    assert_residency()  # no model call outside the cell's zone (ADR-0167)
    pool = _pool()
    ingest_workflow.serve(ingestor_lifespan, ingest_dispatch.decode, slots=_slots(), pool=pool, **_folder_cards(pool))


if __name__ == "__main__":
    main()
