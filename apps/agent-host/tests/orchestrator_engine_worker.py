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
import os
import time
from pathlib import Path

from agent_host.jobs import research_workflow
from agent_host.jobs import run_ownership
from agent_host.jobs import worker
from agent_host.jobs.event_store import EventStore
from agent_host.jobs.runner import _update_status_if_not_terminal


async def stand_in_agent(*, job_id: str, db_url: str, input_text: str, **_payload) -> None:
    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus
    from nat.front_ends.fastapi.async_jobs.job_store import JobStore

    events = EventStore(db_url, job_id)
    events.store({"type": "test.started", "data": {"pid": os.getpid(), "at": time.time()}})
    mode, _, arg = input_text.partition(":")
    if mode == "exit-once" and not Path(arg).exists():
        Path(arg).write_text("first attempt died here")
        os._exit(1)
    if mode == "sleep":
        try:
            await asyncio.sleep(float(arg))
        except asyncio.CancelledError:
            events.store({"type": "test.cancelled", "data": {"at": time.time()}})
            raise
    store = JobStore(scheduler_address="", db_url=db_url)
    await _update_status_if_not_terminal(store, job_id, JobStatus.SUCCESS, output="done")
    events.store({"type": "test.finished", "data": {"at": time.time()}})


if __name__ == "__main__":
    worker.run_agent_job = stand_in_agent
    # The stand-in emits no heartbeats, and a test cannot wait the production
    # window (the ghost reaper's 300 s) for a dead attempt to age out.
    run_ownership.STALE_SECONDS = 10
    run_ownership.WAIT_SECONDS = 40
    run_ownership._POLL_SECONDS = 2
    research_workflow.run_worker()
