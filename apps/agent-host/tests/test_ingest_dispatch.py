"""A job ``/v1/ingest`` accepts runs on Hatchet, and only as it was accepted.

The workflow itself (its declaration, its steps, an attempt's end) is
``packages/agent/tests/knowledge/test_ingest_hatchet.py``; these pin the half
that lives here: what the payload carries, that a worker reads back nothing the
route would have refused, that a job Hatchet cannot take still runs, and cancel.
"""

from __future__ import annotations

import base64
import os
from datetime import datetime

import pytest
from agent_testing import hatchet_fake

from agent.common import hatchet_client
from agent.knowledge import ingest_hatchet
from agent.knowledge import ingest_run_hold
from agent.knowledge import ingest_status_store
from agent.knowledge.base import PreparedIngestJob
from agent.knowledge.ingest_scheduler import PLATFORM_LANE
from agent.knowledge.schema import IngestionJobStatus
from agent.knowledge.schema import JobState
from agent_host.jobs import ingest_dispatch
from agent_host.routes.ingest import DeferredObjectDownload

_ORIGINAL = "http://seaweedfs.test/bucket/doc/plan.pdf?X-Amz-Signature=secret-original"
_RENDITION = "http://seaweedfs.test/bucket/doc/plan.rendition.pdf?X-Amz-Signature=secret-rendition"
_THUMBNAIL = "http://seaweedfs.test/bucket/doc/thumb.png?X-Amz-Signature=secret-put"


@pytest.fixture(autouse=True)
def object_store(monkeypatch):
    monkeypatch.setenv("SEAWEED_ENDPOINT", "http://seaweedfs.test")
    monkeypatch.setenv("SEAWEED_PUBLIC_ENDPOINT", "http://seaweedfs.test")
    monkeypatch.delenv("JOB_PAYLOAD_KEK", raising=False)


@pytest.fixture
def hatchet():
    fake = hatchet_fake.install()
    yield fake
    hatchet_client.reset_for_tests(None)


@pytest.fixture
def kek(monkeypatch):
    monkeypatch.setenv("JOB_PAYLOAD_KEK", base64.b64encode(os.urandom(32)).decode())


@pytest.fixture
def db(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/jobs.db"
    monkeypatch.setenv("SUMMARY_DB", url)
    yield url
    ingest_status_store._initialized.discard(url)


def _prepared(job_id: str = "job-1", *, files=None, org: str | None = "org-1") -> PreparedIngestJob:
    config = {
        "original_filenames": ["plan.pdf"],
        "document_id": "doc-1",
        "thumbnail_upload_url": _THUMBNAIL,
        "extraction_paths": [DeferredObjectDownload(_RENDITION, suffix=".pdf")],
    }
    if org:
        config["organization_id"] = org
    return PreparedIngestJob(
        job_id=job_id,
        status=IngestionJobStatus(
            job_id=job_id,
            status=JobState.PENDING,
            submitted_at=datetime(2026, 9, 30, 10, 0, 0),
            total_files=1,
            collection_name="proj_1",
            backend="llamaindex",
        ),
        file_paths=files if files is not None else [DeferredObjectDownload(_ORIGINAL)],
        collection_name="proj_1",
        config=config,
    )


class FakeIngestor:
    supports_durable_jobs = True

    def __init__(self) -> None:
        self.local: list[PreparedIngestJob] = []
        self.ran: list[PreparedIngestJob] = []

    def submit_prepared(self, prepared: PreparedIngestJob) -> None:
        self.local.append(prepared)

    def run_prepared(self, prepared: PreparedIngestJob, still_owner=None) -> None:
        self.ran.append(prepared)
        self.still_owner = still_owner


def test_the_payload_round_trips_with_its_downloads():
    decoded = ingest_dispatch.decode(ingest_dispatch.encode(_prepared()))

    assert decoded.job_id == "job-1"
    assert decoded.organization_id == "org-1"
    assert decoded.status.status == JobState.PENDING
    assert [d.to_payload() for d in decoded.file_paths] == [{"url": _ORIGINAL, "suffix": None}]
    assert decoded.config["extraction_paths"][0].to_payload() == {"url": _RENDITION, "suffix": ".pdf"}
    assert decoded.config["thumbnail_upload_url"] == _THUMBNAIL


def test_the_stored_payload_is_encrypted_when_a_key_is_set(monkeypatch):
    monkeypatch.setenv("JOB_PAYLOAD_KEK", base64.b64encode(os.urandom(32)).decode())

    stored = ingest_dispatch.encode(_prepared())

    assert stored.startswith("enc:")
    assert "secret-original" not in stored
    assert ingest_dispatch.decode(stored).job_id == "job-1"


@pytest.mark.parametrize(
    "forged",
    [
        {"file_paths": [{"__object_download__": {"url": "http://169.254.169.254/latest/meta-data", "suffix": None}}]},
        {"file_paths": ["/etc/passwd"]},
        {"thumbnail_upload_url": "http://internal-admin.test/upload"},
    ],
)
def test_a_worker_refuses_what_the_route_would_have_refused(forged):
    """Without a KEK a row is plaintext anyone who can write the table can forge."""
    import json

    from agent_host.jobs import payload_crypto

    data = payload_crypto.deserialize(ingest_dispatch.encode(_prepared()))
    if "thumbnail_upload_url" in forged:
        data["config"].update(forged)
    else:
        data.update(forged)
    stored = "json:" + base64.b64encode(json.dumps(data).encode()).decode()

    with pytest.raises(Exception):  # noqa: B017 - the gate's HTTPException or the shape check
        ingest_dispatch.decode(stored)


def _held(db) -> dict[str, tuple]:
    from sqlalchemy import text

    from agent.knowledge.document_metadata_store import DocumentMetadataStore

    with DocumentMetadataStore._get_or_create_sync_engine(db).connect() as conn:
        rows = conn.execute(text("SELECT job_id, run_id, held_until IS NOT NULL FROM ingest_jobs")).all()
    return {row[0]: (row[1], bool(row[2])) for row in rows}


def _workflow():
    return ingest_hatchet.ingest_workflow()


def test_an_accepted_job_starts_its_run_with_ids_and_the_encrypted_payload_only(db, hatchet, kek):
    ingestor = FakeIngestor()
    ingest_status_store.put(_prepared().status)

    ingest_dispatch.dispatch(ingestor, _prepared())

    assert ingestor.local == []
    (run,) = hatchet.workflow_runs
    assert run.input.job_id == "job-1"
    assert run.input.organization_id == "org-1"
    assert run.input.priority == "interactive"
    assert run.input.payload.startswith("enc:")
    # No tenant content in Hatchet's database: no URL, no file name.
    dumped = run.input.model_dump_json()
    assert "secret-original" not in dumped
    assert "plan.pdf" not in dumped
    assert run.additional_metadata == {"job_id": "job-1"}
    assert ingest_dispatch.decode(run.input.payload).job_id == "job-1"
    # The row is held for the run, and knows which run it is.
    assert _held(db)["job-1"] == ("run-1", True)


def test_interactive_runs_above_bulk(db, hatchet, kek):
    from hatchet_sdk import Priority

    bulk = _prepared("bulk-1")
    bulk.config["priority"] = "bulk"
    ingest_dispatch.dispatch(FakeIngestor(), bulk)
    ingest_dispatch.dispatch(FakeIngestor(), _prepared("upload-1"))

    priorities = {run.input.job_id: run.priority for run in hatchet.workflow_runs}
    assert priorities == {"bulk-1": Priority.LOW, "upload-1": Priority.HIGH}
    assert Priority.HIGH > Priority.LOW


def test_a_job_with_a_local_file_runs_where_the_file_is(db, hatchet, kek, tmp_path):
    ingestor = FakeIngestor()
    local = _prepared(files=[str(tmp_path / "upload.pdf")])

    ingest_dispatch.dispatch(ingestor, local)

    assert ingestor.local == [local]
    assert hatchet.workflow_runs == []


def test_without_a_key_nothing_leaves_this_tier_in_plaintext(db, hatchet):
    ingestor = FakeIngestor()

    ingest_dispatch.dispatch(ingestor, _prepared())

    assert hatchet.workflow_runs == []
    assert len(ingestor.local) == 1


def test_a_job_hatchet_cannot_take_still_runs(db, hatchet, kek):
    _workflow().refuse_with = ConnectionError("engine restarting")
    ingestor = FakeIngestor()

    ingest_dispatch.dispatch(ingestor, _prepared())

    assert len(ingestor.local) == 1


def test_a_job_that_was_not_accepted_goes_nowhere(db, hatchet, kek):
    rejected = _prepared()
    rejected.status.status = JobState.FAILED
    ingestor = FakeIngestor()

    ingest_dispatch.dispatch(ingestor, rejected)

    assert ingestor.local == []
    assert hatchet.workflow_runs == []


def test_a_job_with_no_stated_priority_is_interactive():
    assert _prepared().priority == "interactive"
    bulk = _prepared()
    bulk.config["priority"] = "bulk"
    assert bulk.priority == "bulk"
    bulk.config["priority"] = "whenever"
    assert bulk.priority == "interactive"


def _corpus_job(job_id: str = "oib-1") -> PreparedIngestJob:
    from agent.corpus_store import CorpusObjectDownload

    prepared = _prepared(job_id, files=[CorpusObjectDownload("base-corpus/plan.pdf", "ab" * 32)], org=None)
    prepared.config.pop("extraction_paths")
    prepared.config.pop("thumbnail_upload_url")
    prepared.config["priority"] = "bulk"
    return prepared


def test_a_corpus_object_download_is_a_durable_file_and_round_trips_without_a_url():
    prepared = _corpus_job()

    assert ingest_dispatch.durable(prepared) is True
    decoded = ingest_dispatch.decode(ingest_dispatch.encode(prepared))

    (download,) = decoded.file_paths
    assert download.to_payload() == {"storage_key": "base-corpus/plan.pdf", "sha256": "ab" * 32}
    assert "http" not in ingest_dispatch.encode(prepared)


def test_a_worker_refuses_a_corpus_download_for_something_that_is_not_a_corpus_object(db):
    from agent_host.jobs import payload_crypto

    data = payload_crypto.deserialize(ingest_dispatch.encode(_corpus_job()))
    data["file_paths"][0]["__corpus_object__"]["storage_key"] = "elsewhere/plan.pdf"
    forged = payload_crypto.serialize(data)

    with pytest.raises(Exception, match="not a corpus object key"):
        ingest_dispatch.decode(forged)


def test_enqueue_only_starts_a_corpus_job_as_bulk_in_the_platform_lane(db, hatchet, kek):
    assert ingest_dispatch.enqueue_only(_corpus_job()) is True

    (run,) = hatchet.workflow_runs
    assert run.input.job_id == "oib-1"
    assert run.input.organization_id == PLATFORM_LANE  # a job with no organisation
    assert run.input.priority == "bulk"


def test_enqueue_only_starts_one_run_for_one_live_id(db, hatchet, kek):
    from hatchet_sdk import IdempotencyCollisionError

    ingest_status_store.put(_corpus_job().status)
    assert ingest_dispatch.enqueue_only(_corpus_job()) is True
    _workflow().refuse_with = IdempotencyCollisionError("run-1")

    assert ingest_dispatch.enqueue_only(_corpus_job()) is False
    assert _held(db)["oib-1"] == ("run-1", True)


def test_enqueue_only_never_falls_back_to_running_the_job_here(db, hatchet, kek):
    _workflow().refuse_with = ConnectionError("engine gone")

    with pytest.raises(ingest_dispatch.QueueUnavailable, match="ConnectionError"):
        ingest_dispatch.enqueue_only(_corpus_job())


def test_enqueue_only_without_a_key_raises(db, hatchet):
    with pytest.raises(ingest_dispatch.QueueUnavailable, match="JOB_PAYLOAD_KEK"):
        ingest_dispatch.enqueue_only(_corpus_job())
    assert hatchet.workflow_runs == []


def test_enqueue_only_refuses_a_job_with_a_local_file(db, hatchet, kek, tmp_path):
    local = _prepared("oib-local", files=[str(tmp_path / "upload.pdf")])

    with pytest.raises(ingest_dispatch.QueueUnavailable, match="cannot run in another process"):
        ingest_dispatch.enqueue_only(local)
    assert hatchet.workflow_runs == []


def test_enqueue_only_refuses_a_job_that_was_not_accepted(db):
    rejected = _corpus_job()
    rejected.status.status = JobState.FAILED
    rejected.status.error_message = "No valid file paths provided"

    with pytest.raises(ingest_dispatch.QueueUnavailable, match="No valid file paths"):
        ingest_dispatch.enqueue_only(rejected)


def test_a_hatchet_error_does_not_leak_the_payload(db, hatchet, kek):
    _workflow().refuse_with = ConnectionError("could not send http://seaweedfs.test/x?X-Amz-Signature=secret")

    with pytest.raises(ingest_dispatch.QueueUnavailable) as raised:
        ingest_dispatch.enqueue_only(_corpus_job())

    assert "secret" not in str(raised.value)


# ------------------------------------------------------------------- cancel


def _dispatched() -> None:
    ingest_status_store.put(_prepared().status)
    ingest_dispatch.dispatch(FakeIngestor(), _prepared())


def test_cancelling_a_job_cancels_its_run_by_id_and_settles_it_cancelled(db, hatchet, kek, monkeypatch):
    pushed: list[list[str]] = []
    monkeypatch.setattr(ingest_status_store.ingest_settle_push, "notify_settled", pushed.append)
    _dispatched()

    assert ingest_dispatch.cancel("job-1") == ingest_dispatch.CANCEL_STOPPED

    assert hatchet.runs.cancelled == ["run-1"]
    settled = ingest_status_store.get("job-1")
    assert settled.status == JobState.CANCELLED
    assert settled.error_message.startswith("cancelled:")
    assert pushed == [["job-1"]]


def test_a_cancel_reports_finished_when_the_job_is_no_longer_live(db, hatchet, kek):
    assert ingest_dispatch.cancel("never-dispatched") == ingest_dispatch.CANCEL_FINISHED

    _dispatched()
    done = _prepared().status
    done.status = JobState.COMPLETED
    ingest_status_store.put(done)

    assert ingest_dispatch.cancel("job-1") == ingest_dispatch.CANCEL_FINISHED
    assert hatchet.runs.cancelled == []


def test_a_job_with_no_run_cannot_be_cancelled_from_here(db, hatchet):
    """A job in another process's own pool has no run: that process is out of reach."""
    ingest_status_store.put(_prepared().status)

    assert ingest_dispatch.cancel("job-1") == ingest_dispatch.CANCEL_UNAVAILABLE
    assert ingest_status_store.get("job-1").status == JobState.PENDING


def test_a_cancel_hatchet_refuses_leaves_the_job_as_it_was(db, hatchet, kek):
    _dispatched()
    hatchet.runs.refuse_with = ConnectionError("engine gone")

    assert ingest_dispatch.cancel("job-1") == ingest_dispatch.CANCEL_UNAVAILABLE
    assert ingest_status_store.get("job-1").status == JobState.PENDING


def test_the_run_id_is_kept_across_later_status_writes(db, hatchet, kek):
    _dispatched()
    assert ingest_run_hold.run_id_of("job-1") == "run-1"

    ingest_status_store.put(_prepared().status)

    assert ingest_run_hold.run_id_of("job-1") == "run-1"


def test_a_waiting_status_clears_a_count_from_the_claim_queue():
    statuses = {
        "job-1": {"status": "pending", "metadata": {"queue_ahead": 3}},
        "job-2": {"status": "pending"},
        "done": {"status": "completed", "metadata": {}},
        "unknown": None,
    }

    ingest_dispatch.stamp_queue_ahead(statuses)

    assert statuses["job-1"]["metadata"] == {"queue_ahead": None}
    assert statuses["job-2"]["metadata"] == {"queue_ahead": None}
    assert statuses["done"]["metadata"] == {}
