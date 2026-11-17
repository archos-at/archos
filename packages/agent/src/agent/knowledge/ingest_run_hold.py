from __future__ import annotations

import logging
import time

from sqlalchemy import text

from . import ingest_status_store as store
from .document_metadata_store import DocumentMetadataStore

logger = logging.getLogger(__name__)

_HOLD = "UPDATE ingest_jobs SET held_until = {until}, run_id = COALESCE(:run_id, run_id) WHERE job_id = :job_id"
_RELEASE = "UPDATE ingest_jobs SET held_until = NULL WHERE job_id = :job_id"
STOPPED_BY_PERSON = "person:"
_MARK_STOPPED = (
    "UPDATE ingest_jobs SET run_id = :prefix || run_id "
    "WHERE job_id = :job_id AND run_id IS NOT NULL AND run_id NOT LIKE 'person:%'"
)


_HOLD_RETRY_WAITS = (0.25, 0.75)


def _update(statement: str, params: dict, seconds: int = 0) -> bool:
    return bool(_try_update(statement, params, seconds))


def _try_update(statement: str, params: dict, seconds: int = 0) -> bool | None:
    url = store._db_url()
    if not url:
        return False
    try:
        store._ensure_table(url)
        with DocumentMetadataStore._get_or_create_sync_engine(url).connect() as conn:
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            matched = conn.execute(text(statement.format(until=store._from_now(url, seconds))), params)
            conn.commit()
            return matched.rowcount > 0
    except Exception:
        logger.warning("Could not update the hold on ingest job %s (continuing)", params.get("job_id"), exc_info=True)
        return None


def hold(job_id: str, run_id: str | None, seconds: int) -> bool:
    params = {"job_id": job_id, "run_id": run_id}
    for wait in (*_HOLD_RETRY_WAITS, None):
        held = _try_update(_HOLD, params, max(0, int(seconds)))
        if held is not None or wait is None:
            return bool(held)
        time.sleep(wait)
    return False


def release(job_id: str) -> bool:
    return _update(_RELEASE, {"job_id": job_id})


def hold_cutover_rows() -> int:
    url = store._db_url()
    if not url:
        return 0
    statement = store._HOLD_QUEUED_AT_CUTOVER.format(
        until=store._from_now(url, store._CUTOVER_HOLD_SECONDS), now=store._now(url)
    )
    try:
        store._ensure_table(url)
        with DocumentMetadataStore._get_or_create_sync_engine(url).begin() as conn:
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
            return conn.execute(text(statement)).rowcount or 0
    except Exception:
        logger.warning("Could not hold the jobs the retired ingest queue carries (continuing)", exc_info=True)
        return 0


def mark_stopped_by_person(job_id: str) -> bool:
    return _update(_MARK_STOPPED, {"job_id": job_id, "prefix": STOPPED_BY_PERSON})


def stopped_by_person(job_id: str) -> bool:
    return (_stored_run_id(job_id) or "").startswith(STOPPED_BY_PERSON)


def run_id_of(job_id: str) -> str | None:
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
