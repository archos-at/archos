"""A file read as steps writes what the one-step read writes, and a page's failure costs that page (ADR-0151).

Offline, on the harness ADR-0151's numbers come from
(``knowledge_layer_testing.page_fan_out_bench``): the 52-page PDF of 12 CAD sheets
and 40 scans, every model call stubbed, Qdrant, the object store and the vision
cache in memory, the orchestrator emulated. What a real engine does with the
steps is ``packages/agent/tests/knowledge/test_ingest_page_fan_out_engine.py``'s.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from knowledge_layer.llamaindex import assembly
from knowledge_layer.llamaindex import extract
from knowledge_layer.llamaindex import read_page
from knowledge_layer.llamaindex import step_outputs
from knowledge_layer_testing import page_fan_out_bench as bench

DELAY = 0.01


@pytest.fixture
def pdf(tmp_path) -> str:
    return bench.mixed_pdf(tmp_path)


def _run(tmp_path: Path, pdf: str, *, fan_out: bool, meter: bench.Meter | None = None) -> tuple[dict, bench.Meter]:
    meter = meter or bench.Meter(DELAY)
    with bench.harness(meter, tmp_path) as ingestor:
        result = (
            bench.run_on(ingestor, pdf, meter, bench.EmulatedEngine(page_slots=16, dispatch=0))
            if fan_out
            else bench.run_off(ingestor, pdf, meter)
        )
    return result, meter


def test_the_steps_write_the_chunks_the_one_step_read_writes_with_the_same_calls(tmp_path, pdf):
    off, off_meter = _run(tmp_path / "off", pdf, fan_out=False)
    on, on_meter = _run(tmp_path / "on", pdf, fan_out=True)

    assert off["status"] == on["status"] == "completed"
    # Deterministic chunk ids name the collection, the version, the ordinal and the text: same ids, same chunks.
    assert on_meter.written_ids == off_meter.written_ids and on_meter.written_ids
    assert on["pages"] == 52 and on["read"] == 52
    assert on["assembly"] == {"answers": 52, "pages_read_here": 0, "enrichment_stored": 1}
    # 52 page reads, four enrichment calls and one permit extraction (the tags say Bescheid), in either shape.
    assert on["calls"] == off["calls"] == 57


def test_the_write_makes_no_model_call_for_a_page_a_task_read(tmp_path, pdf):
    meter = bench.Meter(DELAY)
    (tmp_path / "w").mkdir()
    with bench.harness(meter, tmp_path / "w") as ingestor:
        prepared = bench._prepare(ingestor, pdf)
        extracted = extract.extract(ingestor, prepared)
        for entry in extracted["pages"]:
            read_page.read_page(
                ingestor,
                prepared,
                page=entry["page"],
                kind=entry["kind"],
                content_hash=extracted["content_hash"],
                final=True,
            )
        before = meter.calls
        with assembly.assembly(prepared, extracted):
            ingestor.run_prepared(prepared)

    assert meter.calls == before, "the write asked the model again for a page a task had read"
    assert meter.written_ids


def test_extract_lists_the_scans_and_drawings_and_stores_the_parse(tmp_path, pdf):
    meter = bench.Meter(DELAY)
    with bench.harness(meter, tmp_path) as ingestor:
        prepared = bench._prepare(ingestor, pdf)
        extracted = extract.extract(ingestor, prepared)
        stored = sorted(ingestor.objects.objects)

    kinds = {entry["page"]: entry["kind"] for entry in extracted["pages"]}
    assert extracted["fan_out"] is True and len(extracted["content_hash"]) == 64
    assert [n for n, kind in kinds.items() if kind == read_page.DRAWING] == list(range(1, 13))
    assert [n for n, kind in kinds.items() if kind == read_page.TRANSCRIBE] == list(range(13, 53))
    assert any(key.endswith("/_text/parsed.json") for key in stored)
    assert meter.calls == 0, "extract asks no model"
    # References and counts only: no text of the document in the step's output.
    assert set(extracted) == {"fan_out", "reason", "content_hash", "pages"}


def test_a_page_that_keeps_failing_is_recorded_unread_and_the_file_still_completes(tmp_path, pdf):
    meter = bench.Meter(DELAY)
    failing = 30
    with bench.harness(meter, tmp_path) as ingestor:
        prepared = bench._prepare(ingestor, pdf)
        extracted = extract.extract(ingestor, prepared)
        hash_ = extracted["content_hash"]
        results = {}
        for entry in extracted["pages"]:
            meter.fails.now = entry["page"] == failing
            try:
                if entry["page"] == failing:
                    with pytest.raises(read_page.PageNotRead):
                        read_page.read_page(
                            ingestor, prepared, page=failing, kind=entry["kind"], content_hash=hash_, final=False
                        )
                results[entry["page"]] = read_page.read_page(
                    ingestor, prepared, page=entry["page"], kind=entry["kind"], content_hash=hash_, final=True
                )
            finally:
                meter.fails.now = False
        before = meter.calls
        with assembly.assembly(prepared, extracted):
            ingestor.run_prepared(prepared)
        status = ingestor.get_job_status(prepared.job_id)

    assert results[failing] == {"page": failing, "read": False, "reason": "model_failed", "stored": True}
    assert status.status.value == "completed"
    assert status.file_details[0].status.value == "success"
    # Counted in the file's coverage as a failed transcription, and not asked a fourth time by the write.
    assert meter.calls == before
    assert status.file_details[0].metadata["pages_transcription_failed"] == 1


def test_a_lost_page_task_is_the_only_work_done_again(tmp_path, pdf):
    # Long enough calls that several are in flight when the worker dies.
    meter = bench.Meter(0.3, kill_after=20, kills_process=False)
    result, _ = _run(tmp_path, pdf, fan_out=True, meter=meter)

    assert result["status"] == "completed" and result["read"] == 52
    assert result["lost_tasks"] > 0
    assert result["calls"] == 57 + result["lost_tasks"]


def test_a_step_output_names_its_version_and_is_ignored_for_another():
    objects = bench.ObjectStore()

    def outputs(content_hash: str) -> step_outputs.StepOutputs:
        return step_outputs.StepOutputs(
            "doc-1",
            "proj_1",
            "org-1",
            content_hash,
            presign=objects.presign,
            fetch=objects.fetch,
            upload=objects.upload,
        )

    assert outputs("a" * 64).put(step_outputs.page_part(3), {"read": True})
    assert outputs("a" * 64).get(step_outputs.page_part(3)) == {"read": True}
    assert outputs("b" * 64).get(step_outputs.page_part(3)) is None
    # Only the closed set of parts is ever asked for.
    assert outputs("a" * 64).put("../parsed.json", {}) is False
    assert not step_outputs.PART_PATTERN.match("enrichment/other.json")


def test_a_page_task_reads_under_its_organizations_data_policy_and_the_jobs_ledger(tmp_path, pdf, monkeypatch):
    """A page read in a task of its own follows the organization's policy (ADR-0074), as inside the job."""
    from agent.common import cost_tracking
    from agent.common import openrouter

    chosen = object()
    monkeypatch.setattr(openrouter, "data_policy_for", lambda organization_id: chosen)
    seen: list[tuple[object, object]] = []
    meter = bench.Meter(DELAY)
    with bench.harness(meter, tmp_path) as ingestor:
        from knowledge_layer.llamaindex import transcription

        real = transcription._transcribe_live

        def recording(image_bytes, **kwargs):
            tracker = cost_tracking.cost_tracker_var.get()
            seen.append((openrouter.scoped_data_policy(), getattr(tracker, "organization_id", None)))
            return real(image_bytes, **kwargs)

        monkeypatch.setattr(transcription, "_transcribe_live", recording)
        prepared = bench._prepare(ingestor, pdf)
        extracted = extract.extract(ingestor, prepared)
        scan = next(entry for entry in extracted["pages"] if entry["kind"] == read_page.TRANSCRIBE)
        read_page.read_page(
            ingestor, prepared, page=scan["page"], kind=scan["kind"], content_hash=extracted["content_hash"], final=True
        )

    assert seen == [(chosen, "org-1")]
