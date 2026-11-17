"""A job's events as a Server-Sent Events stream: LISTEN/NOTIFY on PostgreSQL, polling elsewhere, with keepalives."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time

from agent.common.db_utils import redact_db_url

logger = logging.getLogger(__name__)


async def sse_generator(job_store, job_id: str, db_url: str, start_event_id: int = 0):
    """
    Route to appropriate SSE generator based on database type.

    PostgreSQL: Uses LISTEN/NOTIFY for real-time push-based events (sub-10ms latency).
    SQLite: Uses polling (0.5s interval) since SQLite doesn't support pub-sub.
    """
    from ..jobs.event_store import EventStore

    if EventStore.is_postgres(db_url):
        progress = {"last_event_id": start_event_id}
        try:
            async for event in _sse_generator_postgres(job_store, job_id, db_url, start_event_id, progress):
                yield event
        except Exception as e:
            logger.warning("Pub-sub failed, falling back to polling: %s", e)
            async for event in _sse_generator_polling(job_store, job_id, db_url, progress["last_event_id"]):
                yield event
    else:
        async for event in _sse_generator_polling(job_store, job_id, db_url, start_event_id):
            yield event


SSE_KEEPALIVE_SECONDS = 20.0


SSE_KEEPALIVE_FRAME = ": keepalive\n\n"


class _PubSubStream:
    """One pub-sub SSE stream's cursor and status, and the frames it yields (``_sse_generator_postgres``)."""

    def __init__(self, job_store, job_id: str, db_url: str, start_event_id: int, progress: dict[str, int] | None):
        from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

        from ..jobs.connection_manager import get_connection_manager

        self.job_store = job_store
        self.job_id = job_id
        self.db_url = db_url
        self.progress = progress
        self.connection_manager = get_connection_manager()
        self.last_status = None
        self.last_event_id = start_event_id
        self.sequence_id = start_event_id
        self.terminal_statuses = {JobStatus.SUCCESS.value, JobStatus.FAILURE.value, JobStatus.INTERRUPTED.value}
        self.is_reconnect = start_event_id > 0
        self.last_sent = time.monotonic()

    def advance_cursor(self, event_id: int) -> None:
        self.last_event_id = event_id
        if self.progress is not None:
            self.progress["last_event_id"] = event_id

    def format_sse(self, event_type: str, data: dict, event_id: int | None = None) -> str:
        if event_id is not None:
            self.sequence_id = event_id
        return f"id: {self.sequence_id}\nevent: {event_type}\ndata: {json.dumps(data)}\n\n"

    def frames(self, events: list[dict]):
        """Stored events as frames, the cursor moved past each one."""
        for event in events:
            db_event_id = event.pop("_id", None)
            if db_event_id:
                self.advance_cursor(db_event_id)
            event_type = event.pop("type", "event")
            yield self.format_sse(event_type, event, db_event_id)

    def status_frame(self, job) -> str:
        data = {"status": job.status}
        if job.error:
            data["error"] = job.error
        if self.is_reconnect:
            data["reconnected"] = True
        return self.format_sse("job.status", data)

    async def events_after_cursor(self, limit: int) -> list[dict]:
        from ..jobs.event_store import EventStore

        return await EventStore.get_events_async(self.db_url, self.job_id, self.last_event_id, limit)

    async def run(self, channel: str, notification_queue: asyncio.Queue):
        """The history, the stream mode, a reconciliation fetch, then live events until the job ends."""
        job = await self.job_store.get_job(self.job_id)
        if not job:
            logger.warning(f"SSE pub-sub: Job {self.job_id} not found")
            yield self.format_sse("job.error", {"error": "Job not found"})
            return
        job_already_complete = job.status in self.terminal_statuses
        events = await self.events_after_cursor(10000)
        logger.info(
            "SSE pub-sub: Fetched %d historical events for job %s (after_id=%s)",
            len(events),
            self.job_id,
            self.last_event_id,
        )
        for frame in self.frames(events):
            yield frame
        yield self.format_sse("stream.mode", {"mode": "pubsub", "channel": channel})
        reconcile_events = await self.events_after_cursor(1000)
        if reconcile_events:
            logger.info(f"SSE pub-sub: Reconciliation fetched {len(reconcile_events)} events for job {self.job_id}")
            for frame in self.frames(reconcile_events):
                yield frame
        if job_already_complete:
            self.last_status = job.status
            yield self.status_frame(job)
            logger.info(f"SSE pub-sub: Job {self.job_id} already complete, sent {len(events)} events")
            return
        async for frame in self.live(notification_queue):
            yield frame

    async def live(self, notification_queue: asyncio.Queue):
        """Notified events as they land, the job's status as it changes, and a terminal drain."""
        self.last_sent = time.monotonic()
        keepalive_cursor = self.last_event_id
        while True:
            if self.connection_manager.is_shutting_down:
                logger.info("SSE pub-sub stream closing for job %s due to server shutdown", self.job_id)
                yield self.format_sse("job.shutdown", {"message": "Server shutting down"})
                break
            if self.last_event_id != keepalive_cursor:
                keepalive_cursor = self.last_event_id
                self.last_sent = time.monotonic()
            try:
                async for frame in self._received(notification_queue):
                    yield frame
                job = await self.job_store.get_job(self.job_id)
                if not job:
                    logger.warning(f"SSE pub-sub: Job {self.job_id} not found")
                    yield self.format_sse("job.error", {"error": "Job not found"})
                    break
                if job.status != self.last_status:
                    self.last_status = job.status
                    logger.info(f"SSE pub-sub: Job {self.job_id} status changed to {job.status}")
                    yield self.status_frame(job)
                    self.is_reconnect = False
                if job.status in self.terminal_statuses:
                    await asyncio.sleep(0.5)
                    for frame in self.frames(await self.events_after_cursor(10000)):
                        yield frame
                    break
            except asyncio.CancelledError:
                logger.info("SSE pub-sub stream cancelled for job %s", self.job_id)
                break
            except Exception as e:
                logger.exception("SSE pub-sub stream error for job %s: %s", self.job_id, e)
                yield self.format_sse("job.error", {"error": "Internal server error"})
                break

    async def _received(self, notification_queue: asyncio.Queue):
        """The events a notification announces, or after five quiet seconds a fallback poll and a keepalive."""
        try:
            payload = await asyncio.wait_for(notification_queue.get(), timeout=5.0)
            event_id = json.loads(payload).get("id")
            if event_id and event_id > self.last_event_id:
                for frame in self.frames(await self.events_after_cursor(1000)):
                    yield frame
        except TimeoutError:
            fallback_events = await self.events_after_cursor(100)
            for frame in self.frames(fallback_events):
                yield frame
            if not fallback_events and time.monotonic() - self.last_sent >= SSE_KEEPALIVE_SECONDS:
                self.last_sent = time.monotonic()
                yield SSE_KEEPALIVE_FRAME


def _asyncpg_url(listen_db_url: str) -> str:
    """The direct DSN as asyncpg reads it.

    Strip +psycopg2 before +psycopg (it's a prefix of the former): this
    codebase standardizes on postgresql+psycopg:// URLs, which asyncpg rejects,
    and a leftover driver suffix silently degrades every SSE stream to polling
    ("Pub-sub failed, falling back to polling").
    """
    return (
        listen_db_url.replace("+psycopg2", "")
        .replace("+psycopg", "")
        .replace("+asyncpg", "")
        .replace("postgresql://", "postgres://")
    )


async def _sse_generator_postgres(
    job_store, job_id: str, db_url: str, start_event_id: int = 0, progress: dict[str, int] | None = None
):
    """
    PostgreSQL pub-sub based SSE generator - near-instant event delivery.

    Uses asyncpg LISTEN/NOTIFY for real-time push-based events.
    Achieves sub-10ms latency compared to 500ms polling interval.

    When ``progress`` is provided, its ``last_event_id`` entry is kept in sync
    with the cursor of the last real event yielded, so the caller can resume a
    polling fallback from there after a mid-stream failure.
    """
    import asyncpg

    stream = _PubSubStream(job_store, job_id, db_url, start_event_id, progress)
    asyncpg_url = _asyncpg_url(os.environ["LISTEN_DB_URL"])
    channel = f"job_events_{job_id.replace('-', '_')}"
    logger.info(f"SSE pub-sub stream starting for job_id={job_id}, channel={channel}")
    conn = None
    notification_queue: asyncio.Queue = asyncio.Queue()

    def notification_handler(connection, pid, channel_name, payload):
        try:
            notification_queue.put_nowait(payload)
        except asyncio.QueueFull:
            logger.warning("Notification queue full for job %s", job_id)

    try:
        conn = await asyncpg.connect(asyncpg_url)
        await conn.add_listener(channel, notification_handler)
        logger.info(f"SSE: Listening on channel {channel}")
        async with stream.connection_manager.track_connection():
            async for frame in stream.run(channel, notification_queue):
                yield frame
    finally:
        if conn:
            try:
                await conn.remove_listener(channel, notification_handler)
                await conn.close()
                logger.info(f"SSE pub-sub: Closed connection for job {job_id}")
            except Exception as e:
                logger.warning(f"SSE pub-sub: Error closing connection for job {job_id}: {e}")


async def _sse_generator_polling(job_store, job_id: str, db_url: str, start_event_id: int = 0):
    """
    Polling-based SSE generator for SQLite and fallback scenarios.

    Replays historical events as fast as possible, then switches to live polling mode.
    Live mode uses a 0.5s polling interval and is suitable for local development with SQLite.
    Supports reconnection via start_event_id - replays events after that ID without delay.
    Supports graceful shutdown via the SSE connection manager.
    """
    import asyncio

    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

    from ..jobs.connection_manager import get_connection_manager
    from ..jobs.event_store import EventStore

    connection_manager = get_connection_manager()
    last_status = None
    last_event_id = start_event_id
    sequence_id = start_event_id
    terminal_statuses = {JobStatus.SUCCESS.value, JobStatus.FAILURE.value, JobStatus.INTERRUPTED.value}
    is_reconnect = start_event_id > 0
    in_replay_mode = True
    replay_mode_announced = False
    last_sent = time.monotonic()
    keepalive_cursor = start_event_id

    def format_sse(event_type: str, data: dict, event_id: int | None = None) -> str:
        nonlocal sequence_id
        if event_id is not None:
            sequence_id = event_id
        return f"id: {sequence_id}\nevent: {event_type}\ndata: {json.dumps(data)}\n\n"

    logger.info(
        "SSE polling stream starting for job_id=%s, start_event_id=%s, db_url=%s",
        job_id,
        start_event_id,
        redact_db_url(db_url),
    )

    async with connection_manager.track_connection():
        yield format_sse("stream.mode", {"mode": "polling", "interval_ms": 500})

        while True:
            if connection_manager.is_shutting_down:
                logger.info("SSE stream closing for job %s due to server shutdown", job_id)
                yield format_sse("job.shutdown", {"message": "Server shutting down"})
                break

            try:
                job = await job_store.get_job(job_id)
                if not job:
                    logger.warning(f"SSE: Job {job_id} not found")
                    yield format_sse("job.error", {"error": "Job not found"})
                    break

                if in_replay_mode:
                    limit = 10000 if job.status in terminal_statuses else 1000
                else:
                    limit = 10000 if job.status in terminal_statuses else 100
                events = await EventStore.get_events_async(db_url, job_id, last_event_id, limit)

                if events:
                    logger.info(f"SSE: Fetched {len(events)} events for job {job_id} (after_id={last_event_id})")
                elif job.status in terminal_statuses:
                    logger.warning(f"SSE: No events found for completed job {job_id} (after_id={last_event_id})")

                for i, event in enumerate(events):
                    if connection_manager.is_shutting_down:
                        logger.info("SSE stream closing for job %s due to server shutdown (mid-batch)", job_id)
                        yield format_sse("job.shutdown", {"message": "Server shutting down"})
                        return

                    try:
                        db_event_id = event.pop("_id", None)
                        if db_event_id:
                            last_event_id = db_event_id
                        event_type = event.pop("type", "event")
                        sse_output = format_sse(event_type, event, db_event_id)
                        yield sse_output
                    except Exception as e:
                        logger.error(f"SSE: Failed to yield event {i} (id={db_event_id}): {e}", exc_info=True)

                if in_replay_mode and (not events or len(events) < limit):
                    in_replay_mode = False
                    replay_mode_announced = True
                    logger.info(
                        "SSE: Replay complete for job %s at event_id=%s; switching to live mode", job_id, last_event_id
                    )
                    yield format_sse("stream.mode", {"mode": "live"})

                if job.status != last_status:
                    last_status = job.status
                    logger.info(f"SSE: Job {job_id} status changed to {job.status}")
                    data = {"status": job.status}
                    if job.error:
                        data["error"] = job.error
                    if is_reconnect:
                        data["reconnected"] = True
                        is_reconnect = False
                    yield format_sse("job.status", data)

                if job.status in terminal_statuses:
                    break

                if in_replay_mode:
                    continue

                if not in_replay_mode and not replay_mode_announced:
                    replay_mode_announced = True
                    yield format_sse("stream.mode", {"mode": "live"})

                if last_event_id != keepalive_cursor:
                    keepalive_cursor = last_event_id
                    last_sent = time.monotonic()
                elif time.monotonic() - last_sent >= SSE_KEEPALIVE_SECONDS:
                    last_sent = time.monotonic()
                    yield SSE_KEEPALIVE_FRAME

                shutdown_signaled = await connection_manager.wait_or_shutdown(0.5)
                if shutdown_signaled:
                    logger.info("SSE stream closing for job %s due to server shutdown (during wait)", job_id)
                    yield format_sse("job.shutdown", {"message": "Server shutting down"})
                    break

            except asyncio.CancelledError:
                logger.info("SSE stream cancelled for job %s", job_id)
                break
            except Exception as e:
                logger.exception("SSE stream error for job %s: %s", job_id, e)
                yield format_sse("job.error", {"error": "Internal server error"})
                break
