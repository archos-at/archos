from __future__ import annotations

import asyncio
import logging
import os
import time
from pathlib import Path

from agent_host.jobs import research_workflow
from agent_host.jobs import run_ownership
from agent_host.jobs import worker
from agent_host.jobs.event_store import EventStore
from agent_host.jobs.job_status import _update_status_if_not_terminal


async def _record(events: EventStore, event: dict) -> None:
    for _ in range(4):
        await asyncio.to_thread(events.store, event)
        for _ in range(20):
            stored = await asyncio.to_thread(
                EventStore.get_events, events.db_url, events.job_id, event_types=[event["type"]]
            )
            if any((row["type"], row["data"]) == (event["type"], event["data"]) for row in stored):
                return
            await asyncio.sleep(0.25)
    raise RuntimeError(f"could not record {event['type']} for {events.job_id}")


async def stand_in_agent(*, job_id: str, db_url: str, input_text: str, **_payload) -> None:
    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus
    from nat.front_ends.fastapi.async_jobs.job_store import JobStore

    events = EventStore(db_url, job_id)
    await _record(events, {"type": "test.started", "data": {"pid": os.getpid(), "at": time.time()}})
    mode, _, arg = input_text.partition(":")
    if mode == "exit-once" and not Path(arg).exists():
        Path(arg).write_text("first attempt died here")
        os._exit(1)
    if mode == "sleep":
        try:
            await asyncio.sleep(float(arg))
        except asyncio.CancelledError:
            await _record(events, {"type": "test.cancelled", "data": {"at": time.time()}})
            raise
    store = JobStore(scheduler_address="", db_url=db_url)
    await _update_status_if_not_terminal(store, job_id, JobStatus.SUCCESS, output="done")
    await _record(events, {"type": "test.finished", "data": {"at": time.time()}})


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    worker.run_agent_job = stand_in_agent
    run_ownership.STALE_SECONDS = 10
    run_ownership.WAIT_SECONDS = 40
    run_ownership._POLL_SECONDS = 2
    research_workflow.run_worker()
