from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from typing import Any

from agent.common.plan_documents import PlanDocument
from agent.common.plan_documents import sanitize_plan_documents

from .event_store import BatchingEventStore
from .event_store import EventStore

logger = logging.getLogger(__name__)

WRITE_NOW_EVENT_TYPE = "job.write_now_requested"
DOCUMENT_ADDED_EVENT_TYPE = "job.document_added"
CONTROL_EVENT_TYPES = (WRITE_NOW_EVENT_TYPE, DOCUMENT_ADDED_EVENT_TYPE)


class CancellationMonitor:
    def __init__(
        self,
        db_url: str,
        job_id: str,
        poll_interval: float = 1.0,
    ):
        self.db_url = db_url
        self.job_id = job_id
        self.poll_interval = poll_interval
        self._cancelled = asyncio.Event()
        self.write_now = asyncio.Event()
        self.added_documents: list[PlanDocument] = []
        self.on_document_added: Callable[[PlanDocument], None] | None = None
        self._last_event_id = 0
        self._monitor_task: asyncio.Task | None = None

    @property
    def is_cancelled(self) -> bool:
        return self._cancelled.is_set()

    async def _poll_job_status(self) -> None:
        from nat.front_ends.fastapi.async_jobs.job_store import JobStatus
        from nat.front_ends.fastapi.async_jobs.job_store import JobStore

        job_store = JobStore(scheduler_address="", db_url=self.db_url)

        stop_statuses = (JobStatus.INTERRUPTED.value, JobStatus.FAILURE.value)

        while not self._cancelled.is_set():
            if await self._poll_safely(job_store, stop_statuses):
                break

            await asyncio.sleep(self.poll_interval)

    async def _poll_safely(self, job_store: Any, stop_statuses: tuple[str, ...]) -> bool:
        try:
            return await self._poll_once(job_store, stop_statuses)
        except Exception as e:
            logger.warning("Error checking job status for %s: %s", self.job_id, e)
            return False

    async def _poll_once(self, job_store: Any, stop_statuses: tuple[str, ...]) -> bool:
        job = await job_store.get_job(self.job_id)
        if job and job.status in stop_statuses:
            logger.info("Cancellation detected for job %s (status: %s)", self.job_id, job.status)
            self._cancelled.set()
            return True
        events = await EventStore.get_events_async(
            self.db_url, self.job_id, after_id=self._last_event_id, event_types=CONTROL_EVENT_TYPES
        )
        self._note_control_events(events)
        return False

    def _note_control_events(self, events: list[dict]) -> None:
        for event in events:
            event_id = event.get("_id")
            if isinstance(event_id, int) and event_id > self._last_event_id:
                self._last_event_id = event_id
            if event.get("type") == WRITE_NOW_EVENT_TYPE:
                logger.info("Write-now requested for job %s", self.job_id)
                self.write_now.set()
            elif event.get("type") == DOCUMENT_ADDED_EVENT_TYPE:
                self._note_added_document(event.get("data"))

    def _note_added_document(self, data: Any) -> None:
        docs = sanitize_plan_documents({"basis": [data]}) if isinstance(data, dict) else None
        if docs is None:
            return
        doc = docs.basis[0]
        if any(d.name.casefold() == doc.name.casefold() for d in self.added_documents):
            return
        logger.info("Document added to the Grundlage of job %s: %s", self.job_id, doc.name)
        self.added_documents.append(doc)
        if self.on_document_added is not None:
            self.on_document_added(doc)

    def start(self) -> None:
        if self._monitor_task is None:
            self._monitor_task = asyncio.create_task(self._poll_job_status())
            logger.debug("Started cancellation monitor for job %s", self.job_id)

    def stop(self) -> None:
        if self._monitor_task and not self._monitor_task.done():
            self._monitor_task.cancel()
            self._monitor_task = None
            logger.debug("Stopped cancellation monitor for job %s", self.job_id)

    def check(self) -> None:
        if self._cancelled.is_set():
            raise asyncio.CancelledError("Job cancelled by user")


HEARTBEAT_INTERVAL_SECONDS = 30


async def _cancel(task: asyncio.Task) -> None:
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


def _beat(event_store: EventStore | BatchingEventStore | None, start_time: float, last_heartbeat: float) -> float:
    now = time.monotonic()
    if not event_store or (now - last_heartbeat) < HEARTBEAT_INTERVAL_SECONDS:
        return last_heartbeat
    event_store.store(
        {
            "type": "job.heartbeat",
            "data": {"uptime_seconds": int(now - start_time)},
        }
    )
    return now


async def run_with_cancellation(
    coro,
    monitor: CancellationMonitor,
    event_store: EventStore | BatchingEventStore | None = None,
) -> Any:
    task = asyncio.create_task(coro)
    monitor.start()
    try:
        await _watch(task, monitor, event_store)
        return task.result()
    finally:
        monitor.stop()


async def _watch(
    task: asyncio.Task, monitor: CancellationMonitor, event_store: EventStore | BatchingEventStore | None
) -> None:
    start_time = time.monotonic()
    last_heartbeat = start_time
    while not task.done():
        if monitor.is_cancelled:
            await _cancel(task)
            raise asyncio.CancelledError("Job cancelled by user")

        last_heartbeat = _beat(event_store, start_time, last_heartbeat)

        await asyncio.sleep(0.1)
