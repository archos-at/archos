from __future__ import annotations

import io
from datetime import datetime
from unittest.mock import patch

import pytest
from sqlalchemy import text

from agent.common import bff_http
from agent.knowledge import ingest_execution
from agent.knowledge import ingest_run_hold
from agent.knowledge import ingest_settle_push
from agent.knowledge import ingest_status_store
from agent.knowledge.document_metadata_store import DocumentMetadataStore
from agent.knowledge.schema import FileProgress
from agent.knowledge.schema import FileStatus
from agent.knowledge.schema import IngestionJobStatus
from agent.knowledge.schema import JobState


@pytest.fixture
def db(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/jobs.db"
    monkeypatch.setenv("SUMMARY_DB", url)
    yield url
    ingest_status_store._initialized.discard(url)


def _status(job_id: str = "job-1", state: JobState = JobState.PENDING) -> IngestionJobStatus:
    return IngestionJobStatus(
        job_id=job_id,
        status=state,
        submitted_at=datetime(2026, 11, 3, 10, 0, 0),
        total_files=1,
        collection_name="proj_1",
        backend="llamaindex",
    )


def _age(db: str, job_id: str = "job-1") -> None:
    with DocumentMetadataStore._get_or_create_sync_engine(db).begin() as conn:
        conn.execute(
            text("UPDATE ingest_jobs SET heartbeat_at = DATETIME('now', '-3600 seconds') WHERE job_id = :id"),
            {"id": job_id},
        )


def test_a_held_job_waits_however_long_nobody_beats_for_it(db):
    ingest_status_store.put(_status())
    assert ingest_run_hold.hold("job-1", "run-1", 3600) is True
    _age(db)

    assert ingest_status_store.get("job-1").status == JobState.PENDING
    assert ingest_status_store.fail_interrupted() == 0


def test_a_released_job_whose_worker_is_gone_reads_interrupted(db):
    ingest_status_store.put(_status())
    ingest_run_hold.hold("job-1", "run-1", 3600)
    ingest_run_hold.release("job-1")
    _age(db)

    settled = ingest_status_store.get("job-1")
    assert settled.status == JobState.FAILED
    assert settled.error_message.startswith("interrupted:")


def test_a_hold_that_ran_out_no_longer_vouches(db):
    ingest_status_store.put(_status())
    ingest_run_hold.hold("job-1", "run-1", 0)
    _age(db)

    assert ingest_status_store.get("job-1").status == JobState.FAILED


def test_a_hold_without_a_run_keeps_the_run_it_knew(db):
    ingest_status_store.put(_status())
    ingest_run_hold.hold("job-1", "run-1", 60)
    ingest_run_hold.hold("job-1", None, 60)

    assert ingest_run_hold.run_id_of("job-1") == "run-1"
    assert ingest_run_hold.run_id_of("unknown") is None


def test_a_hold_outlasts_one_failed_write(db, monkeypatch):
    ingest_status_store.put(_status())
    real = DocumentMetadataStore._get_or_create_sync_engine
    calls = []

    def flaky(url):
        calls.append(url)
        if len(calls) == 1:
            raise ConnectionError("the database blinked")
        return real(url)

    with monkeypatch.context() as patched:
        patched.setattr(DocumentMetadataStore, "_get_or_create_sync_engine", flaky)
        patched.setattr(ingest_run_hold.time, "sleep", lambda _seconds: None)
        assert ingest_run_hold.hold("job-1", "run-1", 3600) is True
    _age(db)
    assert ingest_status_store.get("job-1").status == JobState.PENDING


def test_without_a_database_nothing_is_held(monkeypatch):
    monkeypatch.delenv("SUMMARY_DB", raising=False)
    monkeypatch.delenv("NAT_JOB_STORE_DB_URL", raising=False)

    assert ingest_run_hold.hold("job-1", "run-1", 60) is False
    assert ingest_run_hold.run_id_of("job-1") is None


def _failed(*files: tuple[bool | None, str]) -> IngestionJobStatus:
    status = _status(state=JobState.FAILED)
    status.error_message = "1/1 file(s) failed"
    for retryable, message in files:
        detail = FileProgress(file_id="f", file_name="plan.pdf", status=FileStatus.FAILED, error_message=message)
        detail.retryable = retryable
        status.file_details.append(detail)
    return status


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (_status(state=JobState.COMPLETED), ("done", False)),
        (_status(state=JobState.CANCELLED), ("done", False)),
        (_status(state=JobState.PROCESSING), ("live", False)),
        (_failed((False, "no content extracted")), ("failed", False)),
        (_failed((True, "original_download_failed: x")), ("failed", True)),
        (_failed((False, "encrypted"), (True, "timed out")), ("failed", True)),
    ],
    ids=["completed", "cancelled", "abandoned", "bytes", "moment", "any-file-may-pass"],
)
def test_how_a_job_ended_decides_whether_it_is_tried_again(status, expected):
    outcome = ingest_execution.outcome_of(status)
    assert (outcome.state, outcome.retryable) == expected


def test_a_job_level_failure_is_judged_by_its_message():
    status = _status(state=JobState.FAILED)
    status.error_message = "Connection reset by peer"

    assert ingest_execution.outcome_of(status).retryable is True


class _Answer(io.BytesIO):
    status = 202

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


@pytest.fixture
def token(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "test-token")
    monkeypatch.setenv("FRONTEND_INTERNAL_URL", "http://frontend:3000")


def test_the_push_sends_at_most_two_hundred_ids_a_call_once_each(token):
    import json

    ids = [f"job-{n}" for n in range(250)] + ["job-0"]
    with patch.object(bff_http._opener, "open", side_effect=lambda *a, **k: _Answer(b'{"settled": 1}')) as sent:
        assert ingest_settle_push.send_settled(ids) == 2

    bodies = [json.loads(call.args[0].data)["job_ids"] for call in sent.call_args_list]
    assert [len(body) for body in bodies] == [200, 50]


def test_a_failed_push_is_a_warning_not_a_failure(token, caplog):
    with patch.object(bff_http._opener, "open", side_effect=OSError("refused")):
        assert ingest_settle_push.push_settled(["job-1"]) == 0
    assert "Settle push for 1 ingest job(s) failed" in caplog.text


def test_a_cancel_pushes_in_the_background(db, token):
    ingest_status_store.put(_status())
    with patch.object(bff_http._opener, "open", return_value=_Answer(b'{"settled": 1}')) as sent:
        assert ingest_status_store.settle_cancelled("job-1") is True
        ingest_settle_push._pusher.submit(lambda: None).result(timeout=5)  # the push before it has run

    assert sent.call_count == 1
