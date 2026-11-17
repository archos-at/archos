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
_STALE_SECONDS = 180
BATCH = 500
_ENCRYPTED = "enc:"

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
    url = _db_url()
    if not url or not _table_exists(url):
        return 0
    with _engine(url).connect() as conn:
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        query = text(f"SELECT COUNT(*) FROM {TABLE} WHERE status IN ('queued', 'claimed')")
        return int(conn.execute(query).scalar_one())


def _worker() -> str:
    return f"{_WORKER}-{socket.gethostname()}-{os.getpid()}"


def redispatch_queued(trigger: Trigger, *, limit: int = BATCH) -> int:
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
    if payload.startswith(_ENCRYPTED):
        return True
    logger.error("Ingest cutover: job %s carries a payload that is not encrypted; left in %s", job_id, TABLE)
    return False


def main() -> None:
    from . import ingest_workflow

    logging.basicConfig(level="INFO")
    moved = 0
    while (handed := redispatch_queued(ingest_workflow.trigger)) > 0:
        moved += handed
    print(f"moved {moved} job(s) to Hatchet; {live_rows()} left in {TABLE}")


if __name__ == "__main__":
    main()
