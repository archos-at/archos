from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections.abc import Sequence
from typing import Any

from agent.common.db_utils import ensure_schema
from agent.common.db_utils import lock_schema
from agent.common.db_utils import normalize_db_url as _normalize_db_url
from agent.common.db_utils import redact_db_url

logger = logging.getLogger(__name__)


class SQLAlchemyPoolFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if record.levelno >= logging.ERROR:
            msg = str(record.getMessage())
            if "CancelledError" in msg or "Exception terminating connection" in msg:
                return False
        return True


def configure_sqlalchemy_logging():
    pool_logger = logging.getLogger("sqlalchemy.pool")
    pool_logger.addFilter(SQLAlchemyPoolFilter())


configure_sqlalchemy_logging()

ENGINE_CACHE_TTL_SECONDS = 3600
ENGINE_CACHE_MAX_SIZE = 10


def _create_job_events_table(conn) -> None:
    from sqlalchemy import Column
    from sqlalchemy import DateTime
    from sqlalchemy import Index
    from sqlalchemy import Integer
    from sqlalchemy import MetaData
    from sqlalchemy import String
    from sqlalchemy import Table
    from sqlalchemy import Text
    from sqlalchemy.sql import func

    metadata = MetaData()
    Table(
        "job_events",
        metadata,
        Column("id", Integer, primary_key=True, autoincrement=True),
        Column("job_id", String(64), nullable=False, index=True),
        Column("event_type", String(64), nullable=False),
        Column("event_data", Text, nullable=True),
        Column("created_at", DateTime, server_default=func.now()),
        Index("idx_job_events_job_id_id", "job_id", "id"),
        Index("idx_job_events_created_at", "created_at"),
    )
    metadata.create_all(conn)


def _events_query(
    job_id: str, after_id: int, limit: int, event_types: Sequence[str] | None
) -> tuple[Any, dict[str, Any]]:
    from sqlalchemy import bindparam
    from sqlalchemy import text

    params: dict[str, Any] = {"job_id": job_id, "after_id": after_id, "limit": limit}
    if event_types is None:
        return (
            text(
                "SELECT id, event_data FROM job_events "
                "WHERE job_id = :job_id AND id > :after_id "
                "ORDER BY id LIMIT :limit"
            ),
            params,
        )
    params["event_types"] = list(event_types)
    statement = text(
        "SELECT id, event_data FROM job_events "
        "WHERE job_id = :job_id AND id > :after_id AND event_type IN :event_types "
        "ORDER BY id LIMIT :limit"
    ).bindparams(bindparam("event_types", expanding=True))
    return statement, params


class EventStore:
    _async_engine_cache: dict[str, tuple[Any, float]] = {}
    _sync_engine_cache: dict[str, tuple[Any, float]] = {}
    _cache_lock = threading.Lock()
    _tables_initialized: set[str] = set()

    def __init__(self, db_url: str = "sqlite+aiosqlite:///./jobs.db", job_id: str | None = None):
        self.db_url = db_url
        self.job_id = job_id
        self._is_postgres = db_url.startswith("postgres")
        self._sync_engine = self._get_or_create_sync_engine(db_url)
        self._ensure_table_sync()

    @classmethod
    def _get_or_create_sync_engine(cls, db_url: str):
        with cls._cache_lock:
            cls._cleanup_stale_engines(cls._sync_engine_cache)

            if db_url in cls._sync_engine_cache:
                engine, _ = cls._sync_engine_cache[db_url]
                cls._sync_engine_cache[db_url] = (engine, time.monotonic())
                return engine

            from sqlalchemy import create_engine

            normalized_url = _normalize_db_url(db_url, async_mode=False)
            connect_args = {}
            if normalized_url.startswith("sqlite"):
                connect_args = {"check_same_thread": False, "timeout": 30}
            else:
                try:
                    import psycopg  # noqa: F401
                except ImportError as e:
                    raise ImportError(
                        "PostgreSQL support requires psycopg (v3). "
                        "Install with: pip install 'agent-host[postgres]' or pip install 'psycopg[binary]'"
                    ) from e

            engine = create_engine(
                normalized_url,
                pool_pre_ping=True,
                pool_size=5,
                max_overflow=10,
                pool_recycle=1800,
                connect_args=connect_args,
            )
            cls._sync_engine_cache[db_url] = (engine, time.monotonic())
            logger.debug("Created sync engine for %s", redact_db_url(db_url))
            return engine

    @classmethod
    def _get_or_create_async_engine(cls, db_url: str):
        with cls._cache_lock:
            cls._cleanup_stale_engines(cls._async_engine_cache)

            if db_url in cls._async_engine_cache:
                engine, _ = cls._async_engine_cache[db_url]
                cls._async_engine_cache[db_url] = (engine, time.monotonic())
                return engine

            from sqlalchemy.ext.asyncio import create_async_engine

            normalized_url = _normalize_db_url(db_url, async_mode=True)

            engine = create_async_engine(
                normalized_url,
                pool_pre_ping=True,
                pool_size=5,
                max_overflow=10,
                pool_recycle=1800,
            )
            cls._async_engine_cache[db_url] = (engine, time.monotonic())
            logger.debug("Created async engine for %s", redact_db_url(db_url))
            return engine

    @classmethod
    def _cleanup_stale_engines(cls, cache: dict[str, tuple[Any, float]]):
        now = time.monotonic()
        stale_keys = [key for key, (_, last_used) in cache.items() if now - last_used > ENGINE_CACHE_TTL_SECONDS]
        for key in stale_keys:
            engine, _ = cache.pop(key, (None, 0))
            if engine:
                cls._dispose_engine(engine, log_debug_key=key)

        if len(cache) > ENGINE_CACHE_MAX_SIZE:
            sorted_entries = sorted(cache.items(), key=lambda x: x[1][1])
            for key, (engine, _) in sorted_entries[: len(sorted_entries) - ENGINE_CACHE_MAX_SIZE]:
                cache.pop(key, None)
                if engine:
                    cls._dispose_engine(engine, log_debug_key=key)

    @classmethod
    def _dispose_engine(cls, engine: Any, log_debug_key: str | None = None) -> None:
        try:
            dispose_result = engine.dispose()
        except RuntimeError, OSError:
            return
        except Exception:
            logger.exception("Failed to dispose engine")
            return

        if log_debug_key:
            logger.debug("Disposed stale engine for %s", redact_db_url(log_debug_key))

        if asyncio.iscoroutine(dispose_result):
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                try:
                    asyncio.run(dispose_result)
                except RuntimeError, OSError:
                    pass
            else:
                loop.create_task(dispose_result)

    @classmethod
    async def dispose_all_engines_async(cls):
        async_engines: list[Any] = []
        with cls._cache_lock:
            for _, (engine, _) in list(cls._sync_engine_cache.items()):
                try:
                    engine.dispose()
                except RuntimeError, OSError:
                    pass
            cls._sync_engine_cache.clear()

            async_engines = [engine for _, (engine, _) in list(cls._async_engine_cache.items())]
            cls._async_engine_cache.clear()
            cls._tables_initialized.clear()

        for engine in async_engines:
            try:
                await engine.dispose()
            except RuntimeError, OSError:
                pass

    @classmethod
    def dispose_all_engines(cls):
        async_engines: list[Any] = []
        with cls._cache_lock:
            for _, (engine, _) in list(cls._sync_engine_cache.items()):
                try:
                    engine.dispose()
                except RuntimeError, OSError:
                    pass
            cls._sync_engine_cache.clear()

            async_engines = [engine for _, (engine, _) in list(cls._async_engine_cache.items())]
            cls._async_engine_cache.clear()
            cls._tables_initialized.clear()

        if not async_engines:
            return

        for engine in async_engines:
            cls._dispose_engine(engine)

    def _ensure_table_sync(self):
        self._ensure_table_exists(self.db_url)

    @classmethod
    async def _ensure_table_async(cls, db_url: str):
        if db_url in cls._tables_initialized:
            return

        engine = cls._get_or_create_async_engine(db_url)
        async with engine.begin() as conn:
            await conn.run_sync(lock_schema, "job_events")
            await conn.run_sync(_create_job_events_table)

        cls._tables_initialized.add(db_url)
        logger.info("Ensured job_events table (async) in %s", redact_db_url(db_url))

    def store(self, event: dict):
        import json

        from sqlalchemy import text

        event_type = event.get("type", "unknown")
        event_json = json.dumps(event)

        try:
            with self._sync_engine.connect() as conn:
                if self._is_postgres:
                    result = conn.execute(
                        text(
                            "INSERT INTO job_events (job_id, event_type, event_data) "
                            "VALUES (:job_id, :event_type, :event_data) RETURNING id"
                        ),
                        {
                            "job_id": self.job_id,
                            "event_type": event_type,
                            "event_data": event_json,
                        },
                    )
                    event_id = result.scalar()

                    channel = f"job_events_{self.job_id.replace('-', '_')}"
                    payload = json.dumps({"id": event_id, "type": event_type})
                    conn.execute(text("SELECT pg_notify(:channel, :payload)"), {"channel": channel, "payload": payload})
                else:
                    conn.execute(
                        text(
                            "INSERT INTO job_events (job_id, event_type, event_data) "
                            "VALUES (:job_id, :event_type, :event_data)"
                        ),
                        {
                            "job_id": self.job_id,
                            "event_type": event_type,
                            "event_data": event_json,
                        },
                    )

                conn.commit()
                logger.debug("Stored event %s for job %s", event_type, self.job_id)
        except Exception as e:
            logger.warning("Failed to store event %s for job %s: %s", event_type, self.job_id, e)

    def store_batch(self, events: list[dict]):
        if not events:
            return

        import json

        from sqlalchemy import text

        rows = []
        for event in events:
            rows.append(
                {
                    "job_id": self.job_id,
                    "event_type": event.get("type", "unknown"),
                    "event_data": json.dumps(event),
                }
            )

        try:
            with self._sync_engine.connect() as conn:
                if self._is_postgres:
                    channel = f"job_events_{self.job_id.replace('-', '_')}"
                    for row in rows:
                        result = conn.execute(
                            text(
                                "INSERT INTO job_events (job_id, event_type, event_data) "
                                "VALUES (:job_id, :event_type, :event_data) RETURNING id"
                            ),
                            row,
                        )
                        event_id = result.scalar()
                        payload = json.dumps({"id": event_id, "type": row["event_type"]})
                        conn.execute(
                            text("SELECT pg_notify(:channel, :payload)"),
                            {"channel": channel, "payload": payload},
                        )
                else:
                    conn.execute(
                        text(
                            "INSERT INTO job_events (job_id, event_type, event_data) "
                            "VALUES (:job_id, :event_type, :event_data)"
                        ),
                        rows,
                    )

                conn.commit()
                logger.debug("Stored batch of %d events for job %s", len(events), self.job_id)
        except Exception as e:
            logger.warning("Failed to store batch of %d events for job %s: %s", len(events), self.job_id, e)

    @classmethod
    def _ensure_table_exists(cls, db_url: str):
        if db_url in cls._tables_initialized:
            return

        ensure_schema(cls._get_or_create_sync_engine(db_url), "job_events", _create_job_events_table)

        cls._tables_initialized.add(db_url)
        logger.info("Ensured job_events table in %s", redact_db_url(db_url))

    @classmethod
    def get_events(
        cls,
        db_url: str,
        job_id: str,
        after_id: int = 0,
        limit: int = 100,
        event_types: Sequence[str] | None = None,
    ) -> list[dict]:
        import json

        try:
            cls._ensure_table_exists(db_url)
            engine = cls._get_or_create_sync_engine(db_url)
            with engine.connect() as conn:
                statement, params = _events_query(job_id, after_id, limit, event_types)
                result = conn.execute(statement, params)
                events = []
                for row in result:
                    try:
                        event = json.loads(row[1])
                        event["_id"] = row[0]
                        events.append(event)
                    except json.JSONDecodeError:
                        logger.warning("Malformed event data for job %s, event id %d", job_id, row[0])
                return events
        except Exception as e:
            logger.warning("Failed to get events for job %s: %s", job_id, e)
            return []

    @classmethod
    async def get_events_async(
        cls,
        db_url: str,
        job_id: str,
        after_id: int = 0,
        limit: int = 100,
        event_types: Sequence[str] | None = None,
    ) -> list[dict]:
        import json

        try:
            await cls._ensure_table_async(db_url)
            engine = cls._get_or_create_async_engine(db_url)
            async with engine.connect() as conn:
                statement, params = _events_query(job_id, after_id, limit, event_types)
                result = await conn.execute(statement, params)
                events = []
                for row in result:
                    try:
                        event = json.loads(row[1])
                        event["_id"] = row[0]
                        events.append(event)
                    except json.JSONDecodeError:
                        logger.warning("Malformed event data for job %s, event id %d", job_id, row[0])
                return events
        except Exception as e:
            logger.warning("Failed to get events async for job %s: %s", job_id, e)
            return await asyncio.get_running_loop().run_in_executor(
                None, cls.get_events, db_url, job_id, after_id, limit, event_types
            )

    @classmethod
    def get_event_by_id(cls, db_url: str, event_id: int) -> dict | None:
        import json

        from sqlalchemy import text

        try:
            cls._ensure_table_exists(db_url)
            engine = cls._get_or_create_sync_engine(db_url)
            with engine.connect() as conn:
                result = conn.execute(
                    text("SELECT id, event_data FROM job_events WHERE id = :event_id"),
                    {"event_id": event_id},
                )
                row = result.fetchone()
                if row:
                    try:
                        event = json.loads(row[1])
                        event["_id"] = row[0]
                        return event
                    except json.JSONDecodeError:
                        logger.warning("Malformed event data for event id %d", event_id)
                return None
        except Exception as e:
            logger.warning("Failed to get event %d: %s", event_id, e)
            return None

    @classmethod
    async def get_event_by_id_async(cls, db_url: str, event_id: int) -> dict | None:
        import asyncio

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, cls.get_event_by_id, db_url, event_id)

    @classmethod
    def is_postgres(cls, db_url: str) -> bool:
        return db_url.startswith("postgres")

    @classmethod
    def cleanup_job_events(cls, db_url: str, job_id: str) -> int:
        from sqlalchemy import text

        try:
            engine = cls._get_or_create_sync_engine(db_url)
            with engine.connect() as conn:
                result = conn.execute(
                    text("DELETE FROM job_events WHERE job_id = :job_id"),
                    {"job_id": job_id},
                )
                conn.commit()
                return result.rowcount
        except Exception as e:
            logger.warning("Failed to cleanup events for job %s: %s", job_id, e)
            return 0

    @classmethod
    def cleanup_old_events(cls, db_url: str, retention_seconds: int = 86400) -> int:
        from sqlalchemy import text

        try:
            engine = cls._get_or_create_sync_engine(db_url)
            is_postgres = db_url.startswith("postgres")

            with engine.connect() as conn:
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
                conn.commit()
                deleted = result.rowcount
                if deleted > 0:
                    logger.info("Cleaned up %d events older than %d seconds", deleted, retention_seconds)
                return deleted
        except Exception as e:
            logger.warning("Failed to cleanup old events: %s", e)
            return 0

    @classmethod
    async def cleanup_old_events_async(cls, db_url: str, retention_seconds: int = 86400) -> int:
        import asyncio

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, cls.cleanup_old_events, db_url, retention_seconds)


class BatchingEventStore:
    FLUSH_INTERVAL_MS = 200
    MAX_BATCH_SIZE = 10

    def __init__(self, event_store: EventStore):
        self._store = event_store
        self._buffer: list[dict] = []
        self._lock = threading.Lock()
        self._timer: threading.Timer | None = None

    @property
    def job_id(self) -> str | None:
        return self._store.job_id

    def store(self, event: dict):
        with self._lock:
            self._buffer.append(event)
            if len(self._buffer) >= self.MAX_BATCH_SIZE:
                self._flush_locked()
            elif self._timer is None:
                self._timer = threading.Timer(self.FLUSH_INTERVAL_MS / 1000, self._flush)
                self._timer.daemon = True
                self._timer.start()

    def _flush_locked(self):
        if self._timer:
            self._timer.cancel()
            self._timer = None
        if not self._buffer:
            return
        batch = self._buffer[:]
        self._buffer.clear()
        self._store.store_batch(batch)

    def _flush(self):
        with self._lock:
            self._flush_locked()

    def flush(self):
        self._flush()
