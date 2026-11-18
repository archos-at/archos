from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import UTC
from datetime import datetime

from agent_testing.orchestrator_fake import take_run
from sqlalchemy import text

from agent.knowledge import ingest_run_hold
from agent.knowledge import ingest_status_store
from agent.knowledge.base import PreparedIngestJob
from agent.knowledge.document_metadata_store import DocumentMetadataStore
from agent.knowledge.schema import FileProgress
from agent.knowledge.schema import FileStatus
from agent.knowledge.schema import IngestionJobStatus
from agent.knowledge.schema import JobState
from agent_host.jobs import ingest_dispatch


@dataclass
class FakeCollection:
    chunk_count: int = 1
    file_count: int = 1


class FakeIngestor:
    supports_durable_jobs = True
    backend_name = "fake"

    def __init__(self) -> None:
        self.prepared: list[PreparedIngestJob] = []
        self.deleted: list[str] = []
        self.indexed: set[str] = set()
        self.collection: FakeCollection | None = FakeCollection()

    def prepare_job(self, file_paths, collection_name, config=None, job_id=None) -> PreparedIngestJob:
        config = dict(config or {})
        status = IngestionJobStatus(
            job_id=job_id,
            status=JobState.PENDING,
            submitted_at=datetime.now(UTC).replace(tzinfo=None),
            total_files=len(file_paths),
            collection_name=collection_name,
            backend=self.backend_name,
            file_details=[
                FileProgress(file_id=f"{job_id}-{i}", file_name=name, status=FileStatus.UPLOADING)
                for i, name in enumerate(config["original_filenames"])
            ],
        )
        ingest_status_store.put(status)
        prepared = PreparedIngestJob(job_id, status, list(file_paths), collection_name, config)
        self.prepared.append(prepared)
        return prepared

    def upload_file(self, *_args, **_kwargs):
        raise AssertionError("the base corpus must not be ingested in this process")

    submit_job = submit_prepared = run_prepared = upload_file

    def get_collection(self, _name: str):
        return self.collection

    def create_collection(self, name: str, description: str = "") -> None:
        self.collection = FakeCollection()

    def list_files(self, _collection: str):
        return [type("Info", (), {"file_name": name})() for name in sorted(self.indexed)]

    def delete_file(self, name: str, _collection: str) -> bool:
        self.deleted.append(name)
        self.indexed.discard(name)
        return True


def _engine():
    return DocumentMetadataStore._get_or_create_sync_engine(ingest_status_store._db_url())


def run_worker(*, succeed: bool = True, downloaded: list[bytes] | None = None) -> list[PreparedIngestJob]:
    ran: list[PreparedIngestJob] = []
    while run := take_run():
        ran.append(finish(ingest_dispatch.decode(run.input.payload), succeed=succeed, downloaded=downloaded))
    return ran


def finish(
    prepared: PreparedIngestJob, *, succeed: bool = True, downloaded: list[bytes] | None = None
) -> PreparedIngestJob:
    path = prepared.file_paths[0]()  # the job's own download, for real
    if downloaded is not None:
        with open(path, "rb") as handle:
            downloaded.append(handle.read())
    os.unlink(path)
    status = prepared.status.model_copy(deep=True)
    status.status = JobState.COMPLETED if succeed else JobState.FAILED
    for detail in status.file_details:
        detail.status = FileStatus.SUCCESS if succeed else FileStatus.FAILED
    ingest_status_store.put(status)
    return prepared


def lose_the_workers_for(job_id: str) -> None:
    while take_run(job_id) is not None:
        pass
    ingest_run_hold.release(job_id)
    with _engine().begin() as conn:
        conn.execute(
            text("UPDATE ingest_jobs SET heartbeat_at = :old WHERE job_id = :id"),
            {"old": datetime(2020, 1, 1), "id": job_id},
        )
