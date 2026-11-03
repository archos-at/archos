"""The research worker the engine tests start in a subprocess: the real Hatchet worker, a stand-in agent.

Everything up to the agent is production code: ``research_workflow.run_worker``
registers ``research-run`` on the engine, and a run goes through
``worker.run_stored_job`` (decrypt, retired keys, failure mapping). Only
``run_agent_job`` is replaced, because the real one needs the workflow config
and live models. The stand-in writes to the event store the way a run does, and
its ``input_text`` says what to do:

* ``ok`` finishes at once;
* ``sleep:<seconds>`` runs that long (a cancel lands here);
* ``exit-once:<marker path>`` kills its worker process on the first attempt, so
  Hatchet must run the job again on another worker, which takes the job over
  once the dead attempt has been silent past ``run_ownership.STALE_SECONDS``.
"""

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
from agent_host.jobs.runner import _update_status_if_not_terminal


async def _record(events: EventStore, event: dict) -> None:
    """Write one of the stand-in's events off the event loop, and see it stored.

    ``EventStore.store`` is a blocking SQLite write. Called on the worker's
    event loop it froze that loop while it waited for the write lock, and the
    lock was held by another run's async transaction in the same process
    (``RESEARCH_WORKERS=4``), which needed that very loop to commit: the write
    timed out on "database is locked" and the store, best effort by design,
    dropped it (PR 1477's runs 41722028227, 41723843561, 41725971708). In a
    thread the loop keeps running and the other transaction commits. The read
    back stays as a check, because these events are what the engine tests
    measure.
    """
    for _ in range(40):
        await asyncio.to_thread(events.store, event)
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
    # Warnings reach the job log: a dropped event write (`EventStore.store`) is otherwise silent.
    logging.basicConfig(level=logging.WARNING)
    worker.run_agent_job = stand_in_agent
    # The stand-in emits no heartbeats, and a test cannot wait the production
    # window (the ghost reaper's 300 s) for a dead attempt to age out.
    run_ownership.STALE_SECONDS = 10
    run_ownership.WAIT_SECONDS = 40
    run_ownership._POLL_SECONDS = 2
    research_workflow.run_worker()
