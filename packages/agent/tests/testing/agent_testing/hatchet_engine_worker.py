"""An ingest worker for the real-engine tests: our workflow, served with a scripted ingestor.

``python -m agent_testing.hatchet_engine_worker <dir>`` serves the real
``ingest-document`` workflow (``agent.knowledge.ingest_hatchet.serve``) against
the engine the ``HATCHET_CLIENT_*`` variables name. Only the ingestor is a
stand-in, because reading a document needs Qdrant, a model and an object store;
everything between Hatchet and the ingestor is the production code.

The job id says how the scripted job ends:

* ``ok-…``: completes at once.
* ``slow-…``: runs ``SLOW_SECONDS``, stopping early when told to (a cancel).
* ``flaky-…``: fails for the moment on its first attempt, completes on the next.
* ``bytes-…``: fails for good (the bytes).

Each attempt's start and end is a line in ``<dir>/events.log``:
``<event> <job id> <attempt> <monotonic seconds>``, read by the tests.
"""

from __future__ import annotations

import contextlib
import json
import sys
import time
from datetime import datetime
from pathlib import Path

from agent.knowledge import ingest_hatchet
from agent.knowledge import ingest_status_store
from agent.knowledge.base import PreparedIngestJob
from agent.knowledge.schema import FileProgress
from agent.knowledge.schema import FileStatus
from agent.knowledge.schema import IngestionJobStatus
from agent.knowledge.schema import JobState

SLOW_SECONDS = 3.0


def status(job_id: str, state: JobState = JobState.PENDING, organization_id: str = "org-a") -> IngestionJobStatus:
    return IngestionJobStatus(
        job_id=job_id,
        status=state,
        submitted_at=datetime(2026, 11, 3, 10, 0, 0),
        total_files=1,
        collection_name=f"proj_{organization_id}",
        backend="scripted",
    )


def payload(job_id: str, organization_id: str) -> str:
    """The test's stand-in for the encrypted payload: ids only."""
    return json.dumps({"job_id": job_id, "organization_id": organization_id})


def decode(stored: str) -> PreparedIngestJob:
    data = json.loads(stored)
    return PreparedIngestJob(
        data["job_id"], status(data["job_id"]), ["<download>"], "proj", {"organization_id": data["organization_id"]}
    )


class ScriptedIngestor:
    supports_durable_jobs = True

    def __init__(self, events: Path) -> None:
        self.events = events

    def _log(self, event: str, job_id: str, attempt: int) -> None:
        with self.events.open("a") as handle:
            handle.write(f"{event} {job_id} {attempt} {time.monotonic():.3f}\n")

    def _attempt(self, job_id: str) -> int:
        if not self.events.exists():
            return 1
        lines = [line.split() for line in self.events.read_text().splitlines()]
        return 1 + sum(1 for line in lines if line[0] == "start" and line[1] == job_id)

    def run_prepared(self, prepared: PreparedIngestJob, still_owner=None) -> None:
        job_id = prepared.job_id
        attempt = self._attempt(job_id)
        self._log("start", job_id, attempt)
        try:
            ingest_status_store.put(status(job_id, JobState.PROCESSING))
            if job_id.startswith("slow-"):
                deadline = time.monotonic() + SLOW_SECONDS
                while time.monotonic() < deadline:
                    if still_owner is not None and not still_owner():
                        return  # stopped: the adapter writes nothing more
                    time.sleep(0.1)
            ingest_status_store.put(self._end(job_id, attempt))
        finally:
            self._log("end", job_id, attempt)

    @staticmethod
    def _end(job_id: str, attempt: int) -> IngestionJobStatus:
        transient = job_id.startswith("flaky-") and attempt == 1
        if not (transient or job_id.startswith("bytes-")):
            return status(job_id, JobState.COMPLETED)
        detail = FileProgress(file_id="f", file_name="f.pdf", status=FileStatus.FAILED)
        detail.error_message = "original_download_failed: storage away" if transient else "no content extracted"
        detail.retryable = transient
        failed = status(job_id, JobState.FAILED)
        failed.file_details = [detail]
        failed.error_message = "1/1 file(s) failed"
        return failed

    def get_job_status(self, job_id: str) -> IngestionJobStatus | None:
        return ingest_status_store.get(job_id)


def main(directory: str) -> None:
    events = Path(directory) / "events.log"

    @contextlib.asynccontextmanager
    async def lifespan():
        yield ScriptedIngestor(events)

    ingest_hatchet.serve(lifespan, decode, slots=4)


if __name__ == "__main__":
    main(sys.argv[1])
