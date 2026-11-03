"""The cutover's one-shot: start on Hatchet every research job the old claim queue still holds (ADR-0150).

A deployment that ran research on ``research_job_queue`` may hold rows when
the Hatchet release goes out: jobs still waiting (``queued``), and jobs whose
worker the deploy stopped (``claimed``). No worker claims them any more. Run
this once after the deploy, from any backend pod with the job database and the
Hatchet connection:

    python -m agent_host.jobs.requeue_legacy

Each row's payload is decrypted, started as a ``research-run`` with the row's
organization and priority, and the row deleted. A job already terminal in
``job_info`` (cancelled or reaped while it waited) is not started, only
deleted. A job that already has a Hatchet run is skipped, so running this
twice starts nothing twice. A payload that cannot be read is left in place
and named in the output. The old payload's ``claim_owner`` key is dropped at
replay (``worker.RETIRED_PAYLOAD_KEYS``). The table itself stays until a later
migration drops it.
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from dataclasses import field

from . import orchestrator_runs
from . import research_hatchet
from .worker import decode_payload

logger = logging.getLogger(__name__)

TABLE = "research_job_queue"
#: The claim queue's lane for a job of no organization, and for a row written before lanes.
_NO_ORGANIZATION_LANES = ("", research_hatchet.PLATFORM_LANE)
#: The claim queue's stored priority ranks.
_PRIORITY_NAMES = {0: "interactive", 1: "bulk"}
_TERMINAL = ("success", "failure", "interrupted")


@dataclass
class Requeued:
    started: list[str] = field(default_factory=list)
    already_terminal: list[str] = field(default_factory=list)
    already_on_hatchet: list[str] = field(default_factory=list)
    unreadable: list[str] = field(default_factory=list)


def _engine(db_url: str):
    from .event_store import EventStore

    return EventStore._get_or_create_sync_engine(db_url)


def _waiting_rows(db_url: str) -> list[tuple[str, str, str, int, str | None]]:
    """``(job_id, lane, payload, priority, job_info status)`` of every live row, oldest first."""
    from sqlalchemy import inspect
    from sqlalchemy import text

    engine = _engine(db_url)
    if not inspect(engine).has_table(TABLE):
        return []
    query = text(
        # Only the module constant is interpolated.
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        f"SELECT q.job_id, q.lane, q.payload, q.priority, i.status FROM {TABLE} q "
        "LEFT JOIN job_info i ON i.job_id = q.job_id "
        "WHERE q.status IN ('queued', 'claimed') ORDER BY q.created_at, q.job_id"
    )
    with engine.connect() as conn:
        return [tuple(row) for row in conn.execute(query)]


def _delete_row(db_url: str, job_id: str) -> None:
    from sqlalchemy import text

    with _engine(db_url).begin() as conn:
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        conn.execute(text(f"DELETE FROM {TABLE} WHERE job_id = :job_id"), {"job_id": job_id})


async def _requeue_one(db_url: str, row: tuple, result: Requeued) -> None:
    job_id, lane, stored, priority, status = row
    if status in _TERMINAL:
        result.already_terminal.append(job_id)
    elif await asyncio.to_thread(orchestrator_runs.run_id_for, db_url, job_id):
        result.already_on_hatchet.append(job_id)
    else:
        try:
            payload = decode_payload(stored)
        except Exception:
            logger.error("Job %s: its queued payload cannot be read; left in place", job_id, exc_info=True)
            result.unreadable.append(job_id)
            return
        organization_id = None if lane in _NO_ORGANIZATION_LANES else lane
        await research_hatchet.start(db_url, job_id, payload, organization_id, _PRIORITY_NAMES.get(priority))
        result.started.append(job_id)
    await asyncio.to_thread(_delete_row, db_url, job_id)


async def requeue(db_url: str) -> Requeued:
    """Start every live row of the old queue on Hatchet and delete it; what happened to each."""
    result = Requeued()
    for row in await asyncio.to_thread(_waiting_rows, db_url):
        await _requeue_one(db_url, row, result)
    return result


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
    db_url = os.environ.get("NAT_JOB_STORE_DB_URL", "sqlite:///./data/jobs.db")
    result = asyncio.run(requeue(db_url))
    print(
        f"started {len(result.started)}, already terminal {len(result.already_terminal)}, "
        f"already on Hatchet {len(result.already_on_hatchet)}, unreadable {len(result.unreadable)}"
        + (f": {', '.join(result.unreadable)}" if result.unreadable else "")
    )


if __name__ == "__main__":
    main()
