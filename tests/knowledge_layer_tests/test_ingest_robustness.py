import time
from datetime import UTC
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from knowledge_layer.ingest import LlamaIndexIngestor
from knowledge_layer.ingest import PdfTextPages
from knowledge_layer.ingest import adapter as adapter_module
from knowledge_layer.ingest import unreadable_pdf_verdict

from agent.knowledge import ingest_status_store
from agent.knowledge.schema import FileProgress
from agent.knowledge.schema import FileStatus
from agent.knowledge.schema import IngestionJobStatus
from agent.knowledge.schema import JobState
from agent.knowledge.schema import stable_file_id


class _Page:
    def __init__(self, number: int, broken: bool) -> None:
        self._number = number
        self._broken = broken

    def extract_text(self):
        if self._broken:
            raise ValueError("unparseable content stream")
        return f"Seite {self._number}"

    def close(self): ...


class _Pdf:
    def __init__(self, pages):
        self.pages = pages

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture()
def fake_pdf(monkeypatch):
    import pdfplumber
    from knowledge_layer.ingest import captioned_tables

    monkeypatch.setattr(captioned_tables, "extract_page_tables", lambda *a, **k: [])

    def install(count: int, broken: set[int]):
        pages = [_Page(n, n in broken) for n in range(1, count + 1)]
        monkeypatch.setattr(pdfplumber, "open", lambda _path: _Pdf(pages))

    return install


def test_a_broken_page_costs_that_page_and_not_the_rest(fake_pdf):
    fake_pdf(60, broken={50})

    pages = adapter_module._extract_text_from_pdf("plan.pdf")

    assert [p["page_number"] for p in pages] == [n for n in range(1, 61) if n != 50]
    assert pages.failed_pages == [50]
    assert pages.page_count == 60


def test_an_unopenable_pdf_reads_as_no_pages(monkeypatch):
    import pdfplumber

    monkeypatch.setattr(pdfplumber, "open", MagicMock(side_effect=ValueError("not a PDF")))

    pages = adapter_module._extract_text_from_pdf("broken.pdf")

    assert list(pages) == [] and pages.failed_pages == [] and pages.page_count == 0


@pytest.mark.parametrize(
    ("failed", "total", "fails"),
    [
        (0, 10, False),
        (1, 10, False),
        (2, 10, False),  # 20% is the limit, inclusive
        (3, 10, True),
        (1, 1, True),  # every page
        (5, 5, True),
    ],
)
def test_the_file_fails_past_a_fifth_of_its_pages(failed, total, fails):
    pages = PdfTextPages([], failed_pages=list(range(1, failed + 1)), page_count=total)

    verdict = unreadable_pdf_verdict(pages)

    assert (verdict is not None) is fails
    if fails:
        assert verdict == f"pdf_pages_unreadable: {failed} of {total} pages could not be read"


def test_a_plain_page_list_has_nothing_to_report():
    assert unreadable_pdf_verdict([{"page_number": 1, "text": "x"}]) is None


@pytest.fixture()
def stores(tmp_path):
    from agent.knowledge import configure_summary_db
    from agent.knowledge import factory

    factory._document_metadata_store = None
    configure_summary_db(f"sqlite:///{tmp_path / 'summaries.db'}")
    yield
    factory._document_metadata_store = None


@pytest.fixture()
def live_ingestor(tmp_path, monkeypatch, qdrant_store):
    from knowledge_layer_testing.vector_store import FakeEmbedder

    ing = LlamaIndexIngestor({"generate_summary": False})
    ing._embed_model = FakeEmbedder()
    ing._initialized = True
    return ing


@pytest.fixture()
def quiet_pdf_pipeline(monkeypatch):
    import knowledge_layer.ingest.processing as processing_module

    from agent.common.credential_resolution import ResolvedCredential

    none = ResolvedCredential(api_key="", base_url="https://vlm.test/v1", model="test-vlm", source="none")
    monkeypatch.setattr(adapter_module, "resolve_vlm_credential", lambda organization_id=None: none)
    monkeypatch.setattr(adapter_module, "_extract_image_records", lambda *a, **k: ([], 0, 0))
    monkeypatch.setattr(processing_module, "render_visual_pages_no_vlm", lambda *a, **k: [])


def _wait_terminal(ing, job_id, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        status = ing.get_job_status(job_id)
        if status.is_terminal:
            return status
        time.sleep(0.05)
    raise AssertionError("ingestion job did not terminate in time")


def _pdf_upload(tmp_path):
    upload = tmp_path / "tmp_upload.pdf"
    upload.write_bytes(b"%PDF-1.7\n%test\n")
    return upload


def _text_pages(count: int, failed: list[int]) -> PdfTextPages:
    read = [n for n in range(1, count + 1) if n not in failed]
    pages = [{"page_number": n, "text": f"Brandabschnitt Seite {n}.", "tables": [], "table_boxes": []} for n in read]
    return PdfTextPages(pages, failed_pages=failed, page_count=count)


def test_chunks_created_counts_the_nodes_stored(tmp_path, live_ingestor, stores):
    upload = tmp_path / "tmp_upload.txt"
    upload.write_text(" ".join(f"Satz {n} der Statik mit Bewehrung." for n in range(200)), encoding="utf-8")

    job_id = live_ingestor.submit_job(
        [str(upload)],
        "proj_count",
        config={"original_filenames": ["statik.txt"], "chunk_size": 160, "chunk_overlap": 0},
    )
    status = _wait_terminal(live_ingestor, job_id)

    from knowledge_layer_testing.vector_store import chunk_texts

    stored = len(chunk_texts("proj_count", {"file_name": "statik.txt"}))
    assert status.file_details[0].status == FileStatus.SUCCESS
    assert stored > 1
    assert status.file_details[0].chunks_created == stored
    assert status.metadata["total_chunks"] == stored


def test_a_few_unreadable_pages_are_recorded_on_a_successful_file(
    tmp_path, monkeypatch, live_ingestor, stores, quiet_pdf_pipeline
):
    monkeypatch.setattr(adapter_module, "_extract_text_from_pdf", lambda _path: _text_pages(10, [4]))

    job_id = live_ingestor.submit_job(
        [str(_pdf_upload(tmp_path))], "proj_pages", config={"original_filenames": ["plan.pdf"]}
    )
    status = _wait_terminal(live_ingestor, job_id)

    detail = status.file_details[0]
    assert detail.status == FileStatus.SUCCESS
    assert detail.pages_failed == 1


def test_too_many_unreadable_pages_fail_the_file(tmp_path, monkeypatch, live_ingestor, stores, quiet_pdf_pipeline):
    monkeypatch.setattr(adapter_module, "_extract_text_from_pdf", lambda _path: _text_pages(10, [2, 3, 4]))

    job_id = live_ingestor.submit_job(
        [str(_pdf_upload(tmp_path))], "proj_holes", config={"original_filenames": ["plan.pdf"]}
    )
    status = _wait_terminal(live_ingestor, job_id)

    detail = status.file_details[0]
    assert detail.status == FileStatus.FAILED
    assert detail.error_message == "pdf_pages_unreadable: 3 of 10 pages could not be read"
    assert status.status == JobState.FAILED


@pytest.fixture()
def held_ingestor(tmp_path):
    ing = LlamaIndexIngestor({})
    ing._ingest_pool = MagicMock()
    return ing


def test_a_live_job_is_found_by_its_dispatch_key(tmp_path, held_ingestor):
    upload = tmp_path / "a.txt"
    upload.write_text("x", encoding="utf-8")

    job_id = held_ingestor.submit_job([str(upload)], "proj_1", config={"dispatch_key": "k1", "document_id": "doc-1"})

    assert held_ingestor.find_live_job("k1") == job_id
    assert held_ingestor.find_live_job("k2") is None
    assert held_ingestor.get_job_status(job_id).metadata == {"dispatch_key": "k1", "document_id": "doc-1"}
    assert held_ingestor._live_job_ids() == [job_id]

    held_ingestor._jobs[job_id].status = JobState.COMPLETED
    assert held_ingestor.find_live_job("k1") is None
    assert held_ingestor._live_job_ids() == []


def test_a_job_a_dead_process_left_processing_reads_interrupted(tmp_path, monkeypatch, held_ingestor):
    from sqlalchemy import create_engine
    from sqlalchemy import text

    url = f"sqlite:///{tmp_path / 'jobs.db'}"
    monkeypatch.setenv("SUMMARY_DB", url)
    try:
        stranded = IngestionJobStatus(
            job_id="stranded",
            status=JobState.PROCESSING,
            submitted_at="2026-09-29T10:00:00",
            total_files=1,
            collection_name="proj_1",
            backend="llamaindex",
            file_details=[FileProgress(file_name="plan.pdf", status=FileStatus.INGESTING)],
        )
        ingest_status_store.put(stranded)
        engine = create_engine(url)
        with engine.begin() as conn:
            conn.execute(text("UPDATE ingest_jobs SET heartbeat_at = '2000-01-01 00:00:00', owner = 'gone'"))
        engine.dispose()

        status = held_ingestor.get_job_status("stranded")

        assert status.status == JobState.FAILED
        assert status.error_message.startswith("interrupted:")
        assert status.metadata["retryable"] is True
    finally:
        ingest_status_store._initialized.discard(url)


def test_a_job_nothing_knows_any_more_is_unknown_not_failed(tmp_path, monkeypatch, held_ingestor):
    url = f"sqlite:///{tmp_path / 'jobs.db'}"
    monkeypatch.setenv("SUMMARY_DB", url)
    try:
        assert held_ingestor.get_job_status("pruned-long-ago") is None
    finally:
        ingest_status_store._initialized.discard(url)


def test_startup_settles_and_each_beat_vouches_for_live_jobs_only(monkeypatch, held_ingestor):
    calls: list[object] = []
    monkeypatch.setattr(ingest_status_store, "fail_interrupted", lambda: calls.append("sweep") or 0)
    monkeypatch.setattr(ingest_status_store, "heartbeat", lambda ids: calls.append(list(ids)))
    held_ingestor._jobs["live"] = SimpleNamespace(status=JobState.PROCESSING)
    held_ingestor._jobs["queued"] = SimpleNamespace(status=JobState.PENDING)
    held_ingestor._jobs["done"] = SimpleNamespace(status=JobState.COMPLETED)

    held_ingestor._settle_stranded_jobs()
    held_ingestor._beat()

    assert calls == ["sweep", ["live", "queued"]]


@pytest.fixture()
def status_db(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'jobs.db'}"
    monkeypatch.setenv("SUMMARY_DB", url)
    yield url
    ingest_status_store._initialized.discard(url)


def _age_row(url: str, job_id: str) -> None:
    from sqlalchemy import create_engine
    from sqlalchemy import text

    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE ingest_jobs SET heartbeat_at = '2000-01-01 00:00:00' WHERE job_id = :j"), {"j": job_id}
        )
    engine.dispose()


def _tracked_job(ingestor, job_id: str, state: JobState) -> IngestionJobStatus:
    job = IngestionJobStatus(
        job_id=job_id,
        status=state,
        submitted_at="2026-09-29T10:00:00",
        total_files=1,
        collection_name="proj_1",
        backend="llamaindex",
        file_details=[FileProgress(file_name="plan.pdf", status=FileStatus.INGESTING)],
    )
    ingestor._jobs[job_id] = job
    return job


def _finish(ingestor, job: IngestionJobStatus) -> None:
    with ingestor._lock:
        job.status = JobState.COMPLETED
        job.completed_at = datetime.now(UTC).replace(tzinfo=None).isoformat()
        job.file_details[0].status = FileStatus.SUCCESS


def test_a_lost_terminal_write_is_retried_until_it_lands(status_db, monkeypatch, held_ingestor):
    job = _tracked_job(held_ingestor, "job-1", JobState.PROCESSING)
    held_ingestor._persist(job)
    _finish(held_ingestor, job)

    real_put = ingest_status_store.put
    monkeypatch.setattr(ingest_status_store, "put", lambda status: False)
    held_ingestor._persist(job)
    assert held_ingestor._unpersisted == {"job-1"}

    held_ingestor._beat()  # the database is still unreachable: kept for the next beat
    assert held_ingestor._unpersisted == {"job-1"}

    monkeypatch.setattr(ingest_status_store, "put", real_put)
    held_ingestor._beat()

    assert held_ingestor._unpersisted == set()
    _age_row(status_db, "job-1")  # long after: a finished row is never settled
    assert ingest_status_store.get("job-1").status == JobState.COMPLETED


def test_a_job_settled_while_its_owner_could_not_beat_is_written_back(status_db, held_ingestor):
    job = _tracked_job(held_ingestor, "job-1", JobState.PROCESSING)
    held_ingestor._persist(job)
    _age_row(status_db, "job-1")
    assert ingest_status_store.get("job-1").status == JobState.FAILED

    held_ingestor._beat()

    assert ingest_status_store.get("job-1").status == JobState.PROCESSING
    assert ingest_status_store.heartbeat(["job-1"]) == 1


def test_a_live_job_whose_first_write_never_landed_is_written_by_the_beat(status_db, held_ingestor):
    _tracked_job(held_ingestor, "job-1", JobState.PENDING)

    held_ingestor._beat()

    assert ingest_status_store.get("job-1").status == JobState.PENDING


def test_a_job_no_longer_tracked_is_not_retried(monkeypatch, held_ingestor):
    monkeypatch.setattr(ingest_status_store, "heartbeat", lambda ids: None)
    puts: list[str] = []
    monkeypatch.setattr(ingest_status_store, "put", lambda status: puts.append(status.job_id) or False)
    held_ingestor._unpersisted.add("pruned")

    held_ingestor._beat()

    assert puts == [] and held_ingestor._unpersisted == set()


def test_a_retry_writes_the_job_as_it_is_now(status_db, monkeypatch, held_ingestor):
    job = _tracked_job(held_ingestor, "job-1", JobState.PROCESSING)
    real_put = ingest_status_store.put
    monkeypatch.setattr(ingest_status_store, "put", lambda status: False)
    held_ingestor._persist(job)
    monkeypatch.setattr(ingest_status_store, "put", real_put)
    _finish(held_ingestor, job)

    held_ingestor._beat()

    assert ingest_status_store.get("job-1").status == JobState.COMPLETED


def _hatchet_run_job(ingestor, job_id: str, *, told_to_stop: bool) -> IngestionJobStatus:
    job = _tracked_job(ingestor, job_id, JobState.PROCESSING)
    ingestor._claim_guards[job_id] = lambda: not told_to_stop
    ingest_status_store.put(job)
    return job


def test_a_persons_cancel_is_not_turned_back_to_processing_by_the_stopped_runs_heartbeat(status_db, held_ingestor):
    _hatchet_run_job(held_ingestor, "job-1", told_to_stop=True)
    assert ingest_status_store.settle_cancelled("job-1") is True

    held_ingestor._beat()

    assert ingest_status_store.get("job-1").status == JobState.CANCELLED
    assert held_ingestor._unpersisted == set()


def test_a_persons_cancel_is_not_turned_back_to_processing_by_the_stopped_runs_progress(status_db, held_ingestor):
    job = _hatchet_run_job(held_ingestor, "job-1", told_to_stop=True)
    ingest_status_store.settle_cancelled("job-1")

    held_ingestor._update_file_status(job, 0, FileStatus.SUCCESS, chunks_created=3)

    assert ingest_status_store.get("job-1").status == JobState.CANCELLED


def test_a_stopped_run_that_finishes_still_writes_completed_over_cancelled(status_db, held_ingestor):
    job = _hatchet_run_job(held_ingestor, "job-1", told_to_stop=True)
    ingest_status_store.settle_cancelled("job-1")
    _finish(held_ingestor, job)

    held_ingestor._persist(job)

    stored = ingest_status_store.get("job-1")
    assert stored.status == JobState.COMPLETED
    assert stored.file_details[0].status == FileStatus.SUCCESS


def test_a_stopped_run_that_then_fails_leaves_the_row_cancelled(tmp_path, status_db, monkeypatch, held_ingestor):
    upload = tmp_path / "a.txt"
    upload.write_text("x", encoding="utf-8")
    prepared = held_ingestor.prepare_job([str(upload)], "proj_1")

    def stopped_then_broken() -> None:
        ingest_status_store.settle_cancelled(prepared.job_id)
        raise RuntimeError("the embedder is away")

    monkeypatch.setattr(held_ingestor, "_ensure_initialized", stopped_then_broken)
    answers = iter([True])  # the PROCESSING write is the owner's; every later question finds the run stopped

    held_ingestor.run_prepared(prepared, still_owner=lambda: next(answers, False))

    stored = ingest_status_store.get(prepared.job_id)
    assert stored.status == JobState.CANCELLED
    assert stored.error_message.startswith("cancelled:")
    assert held_ingestor._unpersisted == set()


def test_an_owner_hatchet_runs_whose_row_another_replica_settled_writes_again_and_wins(status_db, held_ingestor):
    _hatchet_run_job(held_ingestor, "job-1", told_to_stop=False)
    _age_row(status_db, "job-1")
    settled = ingest_status_store.get("job-1")
    assert (settled.status, settled.metadata["failure_reason"]) == (JobState.FAILED, "interrupted")

    held_ingestor._beat()

    assert ingest_status_store.get("job-1").status == JobState.PROCESSING
    assert ingest_status_store.heartbeat(["job-1"]) == 1


def test_a_prepared_job_is_vouched_for_by_the_process_that_runs_it(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'jobs.db'}"
    monkeypatch.setenv("SUMMARY_DB", url)
    upload = tmp_path / "a.txt"
    upload.write_text("x", encoding="utf-8")
    accepting = LlamaIndexIngestor({})
    try:
        prepared = accepting.prepare_job([str(upload)], "proj_1", config={"organization_id": "org-1"})

        assert accepting._live_job_ids() == []
        assert accepting.get_job_status(prepared.job_id).status == JobState.PENDING
        assert prepared.organization_id == "org-1"

        running = LlamaIndexIngestor({})
        ran = []
        monkeypatch.setattr(running, "_run_ingestion", lambda job_id, *_: ran.append(job_id))
        running.run_prepared(prepared)

        assert ran == [prepared.job_id]
        assert running._live_job_ids() == [prepared.job_id]
        assert [(d.file_name, d.file_id) for d in running._jobs[prepared.job_id].file_details] == [
            ("a.txt", stable_file_id("proj_1", "a.txt"))
        ]
    finally:
        ingest_status_store._initialized.discard(url)


def test_a_job_that_fails_validation_is_final_at_once(tmp_path, held_ingestor):
    prepared = held_ingestor.prepare_job([str(tmp_path / "missing.pdf")], "proj_1")

    assert prepared.status.status == JobState.FAILED
    assert held_ingestor.get_job_status(prepared.job_id).status == JobState.FAILED
    held_ingestor._ingest_pool.submit.assert_not_called()


def test_a_job_the_pool_refuses_reads_failed_not_pending(tmp_path):
    ing = LlamaIndexIngestor({})
    ing._ingest_pool.shutdown(wait=True)
    upload = tmp_path / "a.txt"
    upload.write_text("x", encoding="utf-8")

    with pytest.raises(RuntimeError):
        ing.submit_job([str(upload)], "proj_1", config={"organization_id": "org-1"})

    (job_id,) = ing._jobs
    status = ing.get_job_status(job_id)
    assert status.status == JobState.FAILED
    assert status.error_message.startswith("interrupted:")
    assert ing._live_job_ids() == []
