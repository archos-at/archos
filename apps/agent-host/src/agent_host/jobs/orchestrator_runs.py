"""Which Hatchet run a research job is, and how many of an organization's jobs wait (ADR-0150).

Two things the old ``research_job_queue`` row answered live here now:

* The Hatchet run id, which the cancel route needs to cancel the run. It lives
  in ``research_orchestrator_runs`` (job id, run id), a table of this tier's own
  created on first use like the queue's, because neither ``job_info`` (the agent
  runtime's) nor ``job_access`` has a column for it. A row is written at submit
  and deleted once the run is terminal.
* How many of an organization's jobs are waiting, for the
  ``MAX_QUEUED_JOBS_PER_ORG`` bound. A job that waits on Hatchet is
  ``submitted`` in ``job_info``, and its organization is on its ``job_access``
  row, so the count reads our own store and never asks the orchestrator.

Nothing here imports ``hatchet_sdk``: an id is a string, whichever engine minted it.
"""

from __future__ import annotations

import logging
import os
import threading

from agent.common.db_utils import ensure_schema

logger = logging.getLogger(__name__)

TABLE = "research_orchestrator_runs"

_ensured: set[str] = set()
_ensured_lock = threading.Lock()


def _engine(db_url: str):
    from .event_store import EventStore

    return EventStore._get_or_create_sync_engine(db_url)


def _create_table(conn) -> None:
    from sqlalchemy import text

    # Only the module constant is interpolated.
    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
    conn.execute(text(f"CREATE TABLE IF NOT EXISTS {TABLE} (job_id VARCHAR PRIMARY KEY, run_id VARCHAR NOT NULL)"))


def ensure_table(db_url: str) -> None:
    """Create the run-id table once per process and database."""
    with _ensured_lock:
        if db_url in _ensured:
            return
        ensure_schema(_engine(db_url), TABLE, _create_table)
        _ensured.add(db_url)


def record(db_url: str, job_id: str, run_id: str) -> None:
    """Remember that ``job_id`` runs as orchestrator run ``run_id``."""
    from sqlalchemy import text

    ensure_table(db_url)
    with _engine(db_url).begin() as conn:
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        conn.execute(text(f"DELETE FROM {TABLE} WHERE job_id = :job_id"), {"job_id": job_id})
        conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(f"INSERT INTO {TABLE} (job_id, run_id) VALUES (:job_id, :run_id)"),
            {"job_id": job_id, "run_id": run_id},
        )


def run_id_for(db_url: str, job_id: str) -> str | None:
    """The orchestrator run of ``job_id``, or None when none was recorded (or it already ended)."""
    from sqlalchemy import text

    ensure_table(db_url)
    with _engine(db_url).connect() as conn:
        row = conn.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            text(f"SELECT run_id FROM {TABLE} WHERE job_id = :job_id"),
            {"job_id": job_id},
        ).first()
    return row[0] if row else None


def forget(db_url: str, job_id: str) -> None:
    """Drop the run id of a job whose run is terminal. Best effort: a leftover row cancels nothing live."""
    from sqlalchemy import text

    try:
        ensure_table(db_url)
        with _engine(db_url).begin() as conn:
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            conn.execute(text(f"DELETE FROM {TABLE} WHERE job_id = :job_id"), {"job_id": job_id})
    except Exception:
        logger.warning("Could not drop the orchestrator run id of job %s (non-fatal)", job_id, exc_info=True)


# @environment_variable MAX_QUEUED_JOBS_PER_ORG
# @category Server
# @type int
# @default 50
# @required false
# Research jobs one organization may have WAITING to start. Past it a submit is
# refused with 429: abuse protection against a runaway caller, not capacity
# management, because capacity makes a job wait, never fail. 0 or negative
# disables the bound.
def max_queued_per_org() -> int:
    """Research jobs an organization may have waiting; 0 or less is no bound."""
    try:
        return int(os.environ.get("MAX_QUEUED_JOBS_PER_ORG", ""))
    except ValueError:
        return 50


def waiting_for_org(db_url: str, organization_id: str | None) -> int:
    """Research jobs of one organization that no run has started yet (``submitted`` in ``job_info``)."""
    from sqlalchemy import inspect
    from sqlalchemy import text

    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

    engine = _engine(db_url)
    if not inspect(engine).has_table("job_info") or not inspect(engine).has_table("job_access"):
        return 0
    org_clause = "a.organization_id = :org" if organization_id else "a.organization_id IS NULL"
    query = text(
        # Only a literal clause chosen above is interpolated; every value is bound.
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        "SELECT COUNT(*) FROM job_info i JOIN job_access a ON a.job_id = i.job_id "
        f"WHERE i.status = :submitted AND {org_clause}"
    )
    with engine.connect() as conn:
        return int(conn.execute(query, {"submitted": JobStatus.SUBMITTED.value, "org": organization_id}).scalar() or 0)
