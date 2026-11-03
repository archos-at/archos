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

API pods still on the old release keep writing that table while the rollout
lasts, so the ingest worker does not run this once: every minute it asks
``live_rows`` and, while there are any, hands over a batch of ``BATCH``
(``agent_host.jobs.ingest_worker``), until the table has held nothing for a
while. An operator can run it by hand: ``python -m agent.knowledge.ingest_cutover``.
The runbook: apply the platform, deploy, let the ingest workers run it, and
watch ``ingest_job_queue`` empty. A claim younger than ``_STALE_SECONDS``
belongs to an old worker that may still be draining; it is moved on a later run.

The claim, row by row, is ``agent.common.claim_queue``'s own (``FOR UPDATE SKIP
LOCKED``, an owner per process), so two workers never hand one job over twice;
``trigger`` is idempotent on the job id besides. Only ciphertext is handed
over: a plaintext payload is refused and left in the table (``_sealed``).
"""

from __future__ import annotations

import logging
import os
import socket
from collections.abc import Callable

from sqlalchemy import inspect
from sqlalchemy import text

from agent.common import claim_queue
from agent.common.claim_queue import PRIORITY_BULK

from . import ingest_run_hold
from .document_metadata_store import DocumentMetadataStore
from .ingest_scheduler import PLATFORM_LANE
from .ingest_status_store import _db_url

logger = logging.getLogger(__name__)

TABLE = "ingest_job_queue"
_WORKER = "hatchet-cutover"
#: The old workers' stale window (``INGEST_CLAIM_STALE_SECONDS``' default).
_STALE_SECONDS = 180
#: Jobs one pass hands over at most; the next pass, a minute later, takes the rest.
BATCH = 500
#: How a payload ``payload_crypto`` encrypted begins.
_ENCRYPTED = "enc:"

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


def live_rows() -> int:
    """Jobs ``ingest_job_queue`` still holds (queued or claimed); 0 without a database or the table.

    The cheap check the ingest worker runs every minute before a batch.
    """
    url = _db_url()
    if not url or not _table_exists(url):
        return 0
    with _engine(url).connect() as conn:
        # Only the module constant is interpolated.
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        query = text(f"SELECT COUNT(*) FROM {TABLE} WHERE status IN ('queued', 'claimed')")
        return int(conn.execute(query).scalar_one())


def _worker() -> str:
    """This process's claim owner: a claim another worker holds is never this one's to release or delete."""
    return f"{_WORKER}-{socket.gethostname()}-{os.getpid()}"


def redispatch_queued(trigger: Trigger, *, limit: int = BATCH) -> int:
    """Hand up to ``limit`` jobs still waiting in ``ingest_job_queue`` to Hatchet; how many were handed over.

    The rows found are held first (``ingest_run_hold.hold_cutover_rows``), so a
    job an old API pod queued a moment ago does not read as interrupted while it
    waits for this. A trigger that fails gives the job back to the table,
    unspent, and ends the run: Hatchet is not there, and the next run tries
    again. A payload that is not ciphertext is never handed over (``_sealed``).
    """
    url = _db_url()
    if not url or not _table_exists(url):
        return 0
    ingest_run_hold.hold_cutover_rows()
    worker = _worker()
    moved = 0
    for _ in range(limit):
        claim = _QUEUE.claim_next(worker, stale_seconds=_STALE_SECONDS, max_attempts=1_000_000)
        if claim is None:
            break
        if not _sealed(claim.job_id, claim.payload):
            continue
        organization = None if claim.lane == PLATFORM_LANE else claim.lane
        priority = "bulk" if claim.priority == PRIORITY_BULK else "interactive"
        try:
            trigger(claim.job_id, organization, priority, claim.payload)
        except Exception as error:  # noqa: BLE001 - the payload never reaches a log
            _QUEUE.release_claims([claim.job_id], worker)
            logger.warning("Ingest cutover stopped after %d job(s): %s", moved, type(error).__name__)
            return moved
        _QUEUE.mark_done(claim.job_id, worker)
        moved += 1
    if moved:
        logger.info("Ingest cutover: %d job(s) moved from %s to Hatchet", moved, TABLE)
    return moved


def _sealed(job_id: str, payload: str) -> bool:
    """Whether the payload is ciphertext Hatchet may hold; a plaintext one is refused and left in the table.

    An old API pod without ``JOB_PAYLOAD_KEK`` (allowed on develop) wrote its
    payload as ``json:`` base64 or raw JSON, which would reach Hatchet's
    database in the clear. It is not encrypted here either: with a KEK set,
    ``payload_crypto`` refuses to read plaintext at all, because a row in the
    clear may as well be forged (``requeue_legacy`` leaves such rows the same
    way). The row stays claimed, so this pass does not meet it again; it is
    seen once more after the stale window, for an operator to settle.
    """
    if payload.startswith(_ENCRYPTED):
        return True
    logger.error("Ingest cutover: job %s carries a payload that is not encrypted; left in %s", job_id, TABLE)
    return False


def main() -> None:
    from . import ingest_hatchet

    logging.basicConfig(level="INFO")
    moved = 0
    while (handed := redispatch_queued(ingest_hatchet.trigger)) > 0:
        moved += handed
    print(f"moved {moved} job(s) to Hatchet; {live_rows()} left in {TABLE}")


if __name__ == "__main__":
    main()
