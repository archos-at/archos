"""The one-shot move of the jobs the retired ingest claim queue still holds onto Hatchet.

Ingestion ran on our own claim queue, ``ingest_job_queue`` (ADR-0076), until
Hatchet replaced it (ADR-0150). A deployment that switches over may hold jobs
there that no worker will claim any more: queued ones, and claims of a worker
the deploy replaced. Each is handed to Hatchet with the payload it already
carries (encrypted, the same the task reads) and then deleted from the old
table, which no code writes again and a later migration drops.

The status rows of those jobs are held from the moment the store's
``held_until`` column arrives (``ingest_status_store``), so none reads as
interrupted while it waits for this. ``trigger`` holds them again for Hatchet.

The ingest worker runs this on every boot (``agent_host.jobs.ingest_worker``),
which is cheap once the table is empty or absent, and an operator can run it by
hand: ``python -m agent.knowledge.ingest_cutover``. The runbook: apply the
platform, deploy, let the ingest workers boot (or run this), and watch
``ingest_job_queue`` empty. A claim younger than ``_STALE_SECONDS`` belongs to
an old worker that may still be draining; it is moved on a later run.

The claim, row by row, is ``agent.common.claim_queue``'s own, so two workers
booting together never hand one job over twice.
"""

from __future__ import annotations

import logging
from collections.abc import Callable

from sqlalchemy import inspect

from agent.common import claim_queue
from agent.common.claim_queue import PRIORITY_BULK

from .document_metadata_store import DocumentMetadataStore
from .ingest_scheduler import PLATFORM_LANE
from .ingest_status_store import _db_url

logger = logging.getLogger(__name__)

TABLE = "ingest_job_queue"
_WORKER = "hatchet-cutover"
#: The old workers' stale window (``INGEST_CLAIM_STALE_SECONDS``' default).
_STALE_SECONDS = 180

#: A trigger: (job id, organisation id, priority, payload) -> whether it started a run.
Trigger = Callable[[str, str | None, str, str], bool]


def _engine(url: str):
    return DocumentMetadataStore._get_or_create_sync_engine(url)


_QUEUE = claim_queue.ClaimQueue(
    name="ingest-cutover",
    table=TABLE,
    turns_table="ingest_lane_turns",
    db_url=_db_url,
    engine_for=_engine,
    reap_lock_id=0x41495149_4E474354,
)


def _table_exists(url: str) -> bool:
    with _engine(url).connect() as conn:
        return TABLE in inspect(conn).get_table_names()


def redispatch_queued(trigger: Trigger, *, limit: int = 10_000) -> int:
    """Hand every job still waiting in ``ingest_job_queue`` to Hatchet; how many were handed over.

    A trigger that fails gives the job back to the table, unspent, and ends the
    run: Hatchet is not there, and the next run tries again.
    """
    url = _db_url()
    if not url or not _table_exists(url):
        return 0
    moved = 0
    while moved < limit:
        claim = _QUEUE.claim_next(_WORKER, stale_seconds=_STALE_SECONDS, max_attempts=1_000_000)
        if claim is None:
            break
        organization = None if claim.lane == PLATFORM_LANE else claim.lane
        priority = "bulk" if claim.priority == PRIORITY_BULK else "interactive"
        try:
            trigger(claim.job_id, organization, priority, claim.payload)
        except Exception as error:  # noqa: BLE001 - the payload never reaches a log
            _QUEUE.release_claims([claim.job_id], _WORKER)
            logger.warning("Ingest cutover stopped after %d job(s): %s", moved, type(error).__name__)
            return moved
        _QUEUE.mark_done(claim.job_id, _WORKER)
        moved += 1
    if moved:
        logger.info("Ingest cutover: %d job(s) moved from %s to Hatchet", moved, TABLE)
    return moved


def main() -> None:
    from . import ingest_hatchet

    logging.basicConfig(level="INFO")
    print(f"moved {redispatch_queued(ingest_hatchet.trigger)} job(s) to Hatchet")


if __name__ == "__main__":
    main()
