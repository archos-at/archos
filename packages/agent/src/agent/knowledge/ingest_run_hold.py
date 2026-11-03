"""The status store's vouching for a job Hatchet holds, and the run that job is.

A job handed to Hatchet (``ingest_workflow``) waits there with nobody beating for
its ``ingest_jobs`` row: the replica that accepted it may be gone, and no worker
has it yet. Without a word the row would read as lost after
``ingest_status_store.STALE_AFTER_SECONDS`` and settle ``interrupted`` while the
job waits its turn. So the dispatch holds the row for as long as the run may
wait and retry (``held_until``, read by ``ingest_status_store._stale_predicate``),
and the run's last attempt releases it, from when on the row lives only while
its worker beats, as every running job's does.

``run_id`` is the Hatchet run the job is, for a person's cancel
(``agent_host.jobs.ingest_dispatch.cancel``): stored once, never sent to the BFF.
A person's cancel also marks it (``mark_stopped_by_person``), so a run that sees
itself cancelled can tell that cancel from the engine's own: a timeout, or a
newer upload of the same document superseding it (``ingest_workflow._stopped``).

Best effort and fail-open, like the store: no database, no hold.
"""

from __future__ import annotations

import logging

from sqlalchemy import text

from . import ingest_status_store as store
from .document_metadata_store import DocumentMetadataStore

logger = logging.getLogger(__name__)

_HOLD = "UPDATE ingest_jobs SET held_until = {until}, run_id = COALESCE(:run_id, run_id) WHERE job_id = :job_id"
_RELEASE = "UPDATE ingest_jobs SET held_until = NULL WHERE job_id = :job_id"
#: What a run id begins with once a person stopped its job. In the id rather than
#: a column of its own: the status row is written whole by the run, and only
#: ``run_id`` is written by nobody but the dispatch and this mark.
STOPPED_BY_PERSON = "person:"
_MARK_STOPPED = (
    "UPDATE ingest_jobs SET run_id = :prefix || run_id "
    "WHERE job_id = :job_id AND run_id IS NOT NULL AND run_id NOT LIKE 'person:%'"
)


def _update(statement: str, params: dict, seconds: int = 0) -> bool:
    """Run one constant UPDATE on ``ingest_jobs``; whether it matched a row. Never raises."""
    url = store._db_url()
    if not url:
        return False
    try:
        store._ensure_table(url)
        with DocumentMetadataStore._get_or_create_sync_engine(url).connect() as conn:
            # Built from module constants and dialect literals; values are bound.
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            matched = conn.execute(text(statement.format(until=store._from_now(url, seconds))), params)
            conn.commit()
            return matched.rowcount > 0
    except Exception:
        logger.warning("Could not update the hold on ingest job %s (continuing)", params.get("job_id"), exc_info=True)
        return False


def hold(job_id: str, run_id: str | None, seconds: int) -> bool:
    """Vouch for a job Hatchet holds for ``seconds``, and remember its run; whether its row exists."""
    return _update(_HOLD, {"job_id": job_id, "run_id": run_id}, max(0, int(seconds)))


def release(job_id: str) -> bool:
    """Stop vouching for the job: from now on its row is live only while its worker beats."""
    return _update(_RELEASE, {"job_id": job_id})


def hold_cutover_rows() -> int:
    """Hold the jobs the retired claim queue still carries and nothing holds yet; how many. Never raises.

    Schema init holds the rows present when ``held_until`` arrives; an API pod
    still on the old release queues more while the rollout lasts, and each
    pass of ``ingest_cutover`` holds those before it hands them over.
    """
    url = store._db_url()
    if not url:
        return 0
    statement = store._HOLD_QUEUED_AT_CUTOVER.format(
        until=store._from_now(url, store._CUTOVER_HOLD_SECONDS), now=store._now(url)
    )
    try:
        store._ensure_table(url)
        with DocumentMetadataStore._get_or_create_sync_engine(url).begin() as conn:
            # Built from module constants and dialect literals.
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            return conn.execute(text(statement)).rowcount or 0
    except Exception:
        logger.warning("Could not hold the jobs the retired ingest queue carries (continuing)", exc_info=True)
        return 0


def mark_stopped_by_person(job_id: str) -> bool:
    """Record that a person stopped the job, before its run is cancelled; whether a run was marked."""
    return _update(_MARK_STOPPED, {"job_id": job_id, "prefix": STOPPED_BY_PERSON})


def stopped_by_person(job_id: str) -> bool:
    """Whether a person stopped the job (``mark_stopped_by_person``). Never raises."""
    return (_stored_run_id(job_id) or "").startswith(STOPPED_BY_PERSON)


def run_id_of(job_id: str) -> str | None:
    """The Hatchet run the job is, or None. Never raises."""
    stored = _stored_run_id(job_id)
    return stored.removeprefix(STOPPED_BY_PERSON) if stored else None


def _stored_run_id(job_id: str) -> str | None:
    url = store._db_url()
    if not url:
        return None
    try:
        store._ensure_table(url)
        with DocumentMetadataStore._get_or_create_sync_engine(url).connect() as conn:
            row = conn.execute(
                text("SELECT run_id FROM ingest_jobs WHERE job_id = :job_id"), {"job_id": job_id}
            ).scalar_one_or_none()
    except Exception:
        logger.warning("Could not read the run of ingest job %s", job_id, exc_info=True)
        return None
    return str(row) if row else None
