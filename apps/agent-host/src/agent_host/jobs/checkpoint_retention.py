from __future__ import annotations

import logging
from datetime import UTC
from datetime import datetime
from datetime import timedelta

logger = logging.getLogger(__name__)

_CHECKPOINT_TABLES = ("checkpoint_writes", "checkpoint_blobs", "checkpoints")

_PG_CHECKPOINT_LOCK_ID = 0x41495143_4B505400


def _is_postgres(dsn: str) -> bool:
    return dsn.startswith("postgres")


def _cutoff_iso(retention_seconds: int, now: datetime | None = None) -> str:
    now = now or datetime.now(UTC)
    return (now - timedelta(seconds=retention_seconds)).isoformat()


def reap_idle_threads(dsn: str | None, retention_seconds: int, now: datetime | None = None) -> int:
    if not dsn or retention_seconds <= 0:
        return 0
    try:
        from sqlalchemy import bindparam
        from sqlalchemy import inspect
        from sqlalchemy import text

        from .event_store import EventStore

        engine = EventStore._get_or_create_sync_engine(dsn)
        if not inspect(engine).has_table("checkpoints"):
            return 0

        is_pg = _is_postgres(dsn)
        ts_expr = "checkpoint->>'ts'" if is_pg else "json_extract(checkpoint, '$.ts')"
        cutoff = _cutoff_iso(retention_seconds, now)

        with engine.connect() as conn:
            if is_pg:
                locked = conn.execute(
                    text("SELECT pg_try_advisory_xact_lock(:id)"), {"id": _PG_CHECKPOINT_LOCK_ID}
                ).scalar()
                if not locked:
                    return 0
            stale_ids = list(
                conn.execute(
                    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                    text(f"SELECT thread_id FROM checkpoints GROUP BY thread_id HAVING MAX({ts_expr}) < :cutoff"),
                    {"cutoff": cutoff},
                ).scalars()
            )
            if not stale_ids:
                return 0
            for table in _CHECKPOINT_TABLES:
                conn.execute(
                    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                    text(f"DELETE FROM {table} WHERE thread_id IN :ids").bindparams(  # noqa: S608
                        bindparam("ids", expanding=True)
                    ),
                    {"ids": stale_ids},
                )
            conn.commit()
            logger.info(
                "Chat checkpoint reaper: dropped %d idle thread(s) (idle > %ds)",
                len(stale_ids),
                retention_seconds,
            )
            return len(stale_ids)
    except Exception:
        logger.warning("Chat checkpoint reaper cycle failed", exc_info=True)
        return 0
