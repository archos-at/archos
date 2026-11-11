"""An ingest worker for the folder cards' real-engine tests: our tasks, served with a scripted builder.

``python -m agent_testing.folder_cards_engine_worker <dir>`` serves what the standard
ingest worker serves (``ingest_workflow.serve`` with ``folder_cards.workflow.workflows()``)
against the engine the ``HATCHET_CLIENT_*`` variables name. The dirty set, the sweep, the
run over a collection and everything between Hatchet and them is the production code.
Only one folder's build is a stand-in, because it needs a model, the BFF and Qdrant.

The folder's own name (its last segment) says how its build ends:

* ``ok-…``: built at once.
* ``slow-…``: built after ``SLOW_SECONDS``.
* ``flaky-…``: fails on its first attempt, built on the next.
* ``bad-…``: fails on every attempt.

Each build's start and end is a line in ``<dir>/events.log``:
``<event> <collection> <folder path> <attempt> <monotonic seconds>``, read by the tests.
No debounce, and two seconds of backoff, so a test waits seconds where production waits minutes.
"""

from __future__ import annotations

import asyncio
import contextlib
import sys
import time
from pathlib import Path

from agent.knowledge import ingest_workflow
from agent.knowledge.folder_cards import gate
from agent.knowledge.folder_cards import queue
from agent.knowledge.folder_cards import worker
from agent.knowledge.folder_cards import workflow
from agent_testing.orchestrator_engine_worker import ScriptedIngestor
from agent_testing.orchestrator_engine_worker import decode

SLOW_SECONDS = 6.0
BACKOFF_FACTOR = 2.0


class ScriptedBuilder:
    def __init__(self, events: Path) -> None:
        self.events = events

    def _log(self, event: str, folder: queue.Due, attempt: int) -> None:
        with self.events.open("a") as handle:
            handle.write(f"{event}\t{folder.collection}\t{folder.folder_path}\t{attempt}\t{time.monotonic():.3f}\n")

    def _attempt(self, folder: queue.Due) -> int:
        if not self.events.exists():
            return 1
        lines = [line.split("\t") for line in self.events.read_text().splitlines()]
        return 1 + sum(1 for line in lines if line[:3] == ["start", folder.collection, folder.folder_path])

    async def build(self, folder: queue.Due, context, llm, report) -> str:
        attempt = self._attempt(folder)
        name = folder.folder_path.rsplit("/", 1)[-1]
        self._log("start", folder, attempt)
        try:
            if name.startswith("slow-"):
                await asyncio.sleep(SLOW_SECONDS)
            if name.startswith("bad-") or (name.startswith("flaky-") and attempt == 1):
                raise RuntimeError(f"scripted failure of {folder.folder_path}")
            return "fresh"
        finally:
            self._log("end", folder, attempt)


def script(events: Path) -> None:
    """Replace one folder's build, and what it would read, with the script; keep everything around it."""
    queue.QUIET_SECONDS = 0
    workflow.BACKOFF_FACTOR = BACKOFF_FACTOR
    gate._fetch = lambda organization_id: True
    worker.summary_llm = lambda: object()
    worker._load = lambda collection, organization_id: worker._Collection(organization_id, [], {})
    worker._build = ScriptedBuilder(events).build


def main(directory: str) -> None:
    events = Path(directory) / "events.log"
    script(events)

    @contextlib.asynccontextmanager
    async def lifespan():
        yield ScriptedIngestor(Path(directory) / "ingest-events.log")

    ingest_workflow.serve(lifespan, decode, slots=1, also=workflow.workflows(), durable_slots=workflow.WORKER_SLOTS)


if __name__ == "__main__":
    main(sys.argv[1])
