"""The job event retention sweep: expired events, job rows and chat checkpoints deleted in one pass."""

from __future__ import annotations

import asyncio
import logging

from .job_reaper import PG_ADVISORY_LOCK_ID

logger = logging.getLogger(__name__)


async def run_event_cleanup(
    db_url: str,
    retention_seconds: int,
    is_postgres: bool,
    delete_grace_seconds: int = 604800,
) -> dict[str, int]:
    """
    Execute one cleanup cycle: time-based event pruning + removal of events for expired jobs.

    Returns what the cycle removed; all zeros when another pod held the lock.

    On PostgreSQL, acquires a transaction-level advisory lock (pg_try_advisory_xact_lock)
    so concurrent pods skip the cycle rather than doing redundant work. The lock is
    automatically released on commit/rollback, avoiding leak risks.
    """
    from ..jobs.access import cleanup_job_access
    from ..jobs.access import ensure_job_access_table
    from ..jobs.access import expire_terminal_jobs
    from ..jobs.event_store import EventStore

    loop = asyncio.get_running_loop()

    def _do_cleanup() -> tuple[int, int, int, int, int]:
        from sqlalchemy import text

        engine = EventStore._get_or_create_sync_engine(db_url)
        ensure_job_access_table(db_url)

        with engine.connect() as conn:
            if is_postgres:
                locked = conn.execute(
                    text("SELECT pg_try_advisory_xact_lock(:lock_id)"),
                    {"lock_id": PG_ADVISORY_LOCK_ID},
                ).scalar()
                if not locked:
                    return (0, 0, 0, 0, 0)

            job_marked, job_deleted = expire_terminal_jobs(db_url, delete_grace_seconds, conn=conn)

            if is_postgres:
                result = conn.execute(
                    text("DELETE FROM job_events WHERE created_at < NOW() - :seconds * INTERVAL '1 second'"),
                    {"seconds": retention_seconds},
                )
            else:
                result = conn.execute(
                    text("DELETE FROM job_events WHERE created_at < datetime('now', :interval)"),
                    {"interval": f"-{retention_seconds} seconds"},
                )
            time_deleted = result.rowcount

            expired_result = conn.execute(
                text("DELETE FROM job_events WHERE job_id IN (SELECT job_id FROM job_info WHERE is_expired = true)")
            )
            expired_deleted = expired_result.rowcount
            access_deleted = cleanup_job_access(db_url, conn=conn)

            conn.commit()
            return (time_deleted, expired_deleted, access_deleted, job_marked, job_deleted)

    counts = await loop.run_in_executor(None, _do_cleanup)
    time_deleted, expired_deleted, access_deleted, job_marked, job_deleted = counts

    if time_deleted > 0 or expired_deleted > 0 or access_deleted > 0 or job_marked > 0 or job_deleted > 0:
        logger.info(
            "Event cleanup: %d old events removed, %d events for expired jobs removed, %d access rows removed, "
            "%d job_info marked expired, %d job_info rows deleted",
            time_deleted,
            expired_deleted,
            access_deleted,
            job_marked,
            job_deleted,
        )
    return dict(
        zip(
            ("old_events", "expired_job_events", "access_rows", "job_info_expired", "job_info_deleted"),
            counts,
            strict=True,
        )
    )
