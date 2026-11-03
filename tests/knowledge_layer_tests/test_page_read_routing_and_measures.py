"""A page read carries a cache key and keeps sticky routing; a file's stages and coverage reach its job status."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from knowledge_layer.ingest import measures as ingest_measures
from knowledge_layer.ingest import vision_calls
from knowledge_layer.ingest.coverage import image_coverage

from agent.common import openrouter
from agent.common.cost_tracking import cost_tracker_var
from agent.knowledge.schema import FileProgress
from agent.knowledge.schema import FileStatus
from agent.knowledge.schema import IngestionJobStatus

OPENROUTER = "https://openrouter.ai/api/v1"


def _reply(text: str = "ok"):
    return SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(content=text))])


class Client:
    def __init__(self, base_url: str = OPENROUTER) -> None:
        self.base_url = base_url
        self.requests: list[dict] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **request):
        self.requests.append(request)
        return _reply()


@pytest.fixture
def organization():
    token = cost_tracker_var.set(SimpleNamespace(organization_id="org_a"))
    yield "org_a"
    cost_tracker_var.reset(token)


def _read(client, *, prompt_id="visual:v5:abc", model="openai/gpt-x", page_text="Grundriss EG Wohnung Huber"):
    messages = [{"role": "user", "content": [{"type": "text", "text": f"Fixed prompt. {page_text}"}]}]
    vision_calls._vlm_chat_create(client, model=model, messages=messages, max_tokens=100, prompt_id=prompt_id)
    return client.requests[-1]


class TestThePromptCacheKey:
    def test_a_page_read_carries_the_sticky_key_and_never_the_page(self, organization):
        request = _read(Client())

        extra = request["extra_body"]
        assert extra["session_id"] == extra["prompt_cache_key"]
        assert extra["session_id"].startswith("grid-")
        assert "prompt_id" not in request
        assert "Huber" not in extra["session_id"] and "org_a" not in extra["session_id"]
        assert extra["reasoning"] == {"effort": "low"}, "the vision reasoning setting survives the merge"

    def test_every_page_of_one_office_and_prompt_shares_a_key(self, organization):
        first = _read(Client(), page_text="Seite 1")["extra_body"]["session_id"]
        second = _read(Client(), page_text="Seite 2 ganz anders")["extra_body"]["session_id"]
        assert first == second

    def test_the_key_changes_with_the_model_the_prompt_and_the_office(self, organization):
        base = _read(Client())["extra_body"]["session_id"]
        assert _read(Client(), model="openai/other")["extra_body"]["session_id"] != base
        assert _read(Client(), prompt_id="ocr:v3")["extra_body"]["session_id"] != base
        token = cost_tracker_var.set(SimpleNamespace(organization_id="org_b"))
        try:
            assert _read(Client())["extra_body"]["session_id"] != base
        finally:
            cost_tracker_var.reset(token)

    def test_a_claude_model_also_asks_for_the_cache(self, organization):
        assert _read(Client(), model="anthropic/claude-x")["extra_body"]["cache_control"] == {"type": "ephemeral"}

    def test_off_openrouter_nothing_is_added(self, organization):
        request = _read(Client(base_url="https://vlm.test/v1"))
        assert "extra_body" not in request

    def test_a_zdr_page_read_is_eu_only_and_keeps_sticky_routing(self, monkeypatch):
        """Decided 2026-11-03: `only` the EU slugs, no fallback, no `order` (which turns sticky routing off)."""
        built = {}
        monkeypatch.setattr(openrouter, "openai_client", lambda **kwargs: built.update(kwargs) or Client())
        monkeypatch.delenv(openrouter.PREFERRED_PROVIDERS_ENV, raising=False)

        with openrouter.data_policy_scope(openrouter.ZERO_DATA_RETENTION):
            vision_calls._vlm_client(OPENROUTER, "k")

        body = built["policy"].apply({"model": "m"})
        provider = body["provider"]
        assert provider["zdr"] is True and provider["data_collection"] == "deny"
        assert provider["only"] == list(openrouter.preferred_providers())
        assert provider["allow_fallbacks"] is False
        assert "order" not in provider
        assert openrouter.ZERO_DATA_RETENTION.is_applied_to(body), "the ZDR guarantee checks still hold"

    def test_an_organization_without_zdr_sends_no_order(self, monkeypatch):
        built = {}
        monkeypatch.setattr(openrouter, "openai_client", lambda **kwargs: built.update(kwargs) or Client())

        with openrouter.data_policy_scope(openrouter.NO_RETENTION_LIMITS):
            vision_calls._vlm_client(OPENROUTER, "k")

        assert "provider" not in built["policy"].apply({})


def _job(*details: FileProgress) -> IngestionJobStatus:
    return IngestionJobStatus(
        job_id="job-1",
        status="processing",
        submitted_at="2026-11-02T10:00:00",
        collection_name="proj_1",
        backend="llamaindex",
        file_details=list(details),
    )


def _file(**metadata) -> FileProgress:
    return FileProgress(file_name="Plan.pdf", status=FileStatus.SUCCESS, metadata=metadata)


class _Recorder:
    def __init__(self) -> None:
        self.output: dict | None = None

    def finish(self, output, *, failed=None):
        self.output = output


class TestNoAllowedEuEndpoint:
    """An EU-only page read the provider cannot place now waits, like the in-flight 402."""

    class NoProvider(Exception):
        def __init__(self, status: int) -> None:
            super().__init__(f"Error code: {status} - No allowed providers are available for the selected model.")
            self.status_code = status
            self.response = SimpleNamespace(headers={}, status_code=status)

    def test_it_waits_within_the_budget(self):
        for status in (404, 503):
            assert vision_calls.retry_wait(self.NoProvider(status), rate_limited=0, credit_waits=0, spent=0.0)

    def test_a_data_policy_refusal_is_not_waited_out(self):
        error = self.NoProvider(404)
        error.args = ("Error code: 404 - No endpoints found matching your data policy",)
        assert vision_calls.retry_wait(error, rate_limited=0, credit_waits=0, spent=0.0) is None


class TestTheJobStatusCarriesTheMeasures:
    COVERAGE = {"pages": 40, "drawings": 5, "drawings_read": 3, "transcribed": 0, "not_read": 2}

    def test_stage_seconds_and_coverage_reach_the_job_metadata(self):
        job = _job(_file(drawing_pages_over_cap=2, images_over_cap=7))
        recorder = _Recorder()

        ingest_measures.finish_file(recorder, job, 0, {"text": 1.23456, "vision": 25.4, "dossier": 3.0}, self.COVERAGE)

        assert job.metadata["stage_seconds"] == {"text": 1.235, "vision": 25.4, "dossier": 3.0}
        assert job.metadata["coverage"] == {
            "pages": 40,
            "pages_fully_read": 38,
            "pages_not_read": 2,
            "pages_over_render_cap": 2,
            "rasters_over_cap": 7,
        }
        assert recorder.output["seconds_vision"] == 25.4 and recorder.output["pages_not_read"] == 2

    def test_a_run_again_reports_its_last_run_not_both(self):
        job = _job(_file())
        ingest_measures.finish_file(_Recorder(), job, 0, {"text": 1.0}, self.COVERAGE)
        ingest_measures.finish_file(_Recorder(), job, 0, {"text": 2.0}, self.COVERAGE)

        assert job.metadata["stage_seconds"] == {"text": 2.0}
        assert job.metadata["coverage"]["pages"] == 40

    def test_a_job_of_two_files_sums_them(self):
        job = _job(_file(), _file())
        ingest_measures.finish_file(_Recorder(), job, 0, {"text": 1.0}, self.COVERAGE)
        ingest_measures.finish_file(_Recorder(), job, 1, {"text": 0.5}, image_coverage(read=False))

        assert job.metadata["stage_seconds"] == {"text": 1.5}
        assert job.metadata["coverage"]["pages"] == 41
        assert job.metadata["coverage"]["pages_not_read"] == 3

    def test_a_file_without_pages_reports_only_its_seconds_and_caps(self):
        job = _job(_file())
        ingest_measures.finish_file(_Recorder(), job, 0, {"text": 0.1}, None)

        assert job.metadata["coverage"] == {"pages_over_render_cap": 0, "rasters_over_cap": 0}

    def test_the_measures_never_fail_the_ingest(self):
        ingest_measures.finish_file(object(), object(), 0, {}, None)  # nothing to write on: no raise


class TestAnUnreadImageIsCounted:
    def test_an_image_the_model_could_not_read_is_not_read_with_a_reason(self):
        assert image_coverage(read=False)["not_read"] == 1
        assert image_coverage(read=False)["reasons"] == {"vision_failed": 1}
        assert image_coverage(read=True)["not_read"] == 0


def test_a_page_read_in_the_vision_pool_nests_under_its_files_trace(monkeypatch):
    """The pool's threads copy the job's context, the file's trace included (12% were orphans on 2026-11-02)."""
    from knowledge_layer.ingest import adapter
    from knowledge_layer.ingest import processing
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

    from agent.observability import direct_trace

    memory = InMemorySpanExporter()
    direct_trace.reset_tracer_provider()
    direct_trace.install_tracer_provider(None, env={}, exporter=memory)
    monkeypatch.setattr(processing, "get_json", lambda key: None)
    monkeypatch.setattr(processing, "set_json", lambda *a, **k: None)
    monkeypatch.setattr(vision_calls, "_vlm_slot", lambda: __import__("contextlib").nullcontext())

    def _analyze(image_bytes, **_):
        vision_calls._vlm_chat_create(Client(), model="m", messages=[], max_tokens=10)
        return ("drawing", "Grundriss", {"summary": "x"})

    monkeypatch.setattr(adapter, "analyze_visual", _analyze)
    pages = [{"page_number": n, "image_bytes": bytes([n])} for n in range(1, 5)]
    try:
        with ingest_measures.file_trace("Plan.pdf", {}, "job-1"):
            processing.enrich_vlm_batch(
                image_records=[], drawing_pages=pages, vlm_model="m", vlm_base_url=OPENROUTER, vlm_api_key="k"
            )
        direct_trace._provider.force_flush()
        spans = memory.get_finished_spans()
    finally:
        direct_trace.reset_tracer_provider()

    (root,) = [span for span in spans if span.name == ingest_measures.INGEST_TRACE_NAME]
    reads = [span for span in spans if span.name == vision_calls.VISION_GENERATION_NAME]
    assert len(reads) == 4
    assert all(read.parent is not None and read.parent.span_id == root.context.span_id for read in reads)
    assert all("langfuse.trace.name" not in read.attributes for read in reads)


class TestAnImageIsScreenedByWhatTheModelRead:
    """Without a Qdrant: the image branch alone, on a real ingestor's screen (the job harness skips without one)."""

    TERMS = {"content_terms": ["Gehaltsabrechnung"], "detectors": []}

    @pytest.fixture
    def ingestor(self, monkeypatch):
        from knowledge_layer.ingest.adapter import LlamaIndexIngestor

        ingestor = LlamaIndexIngestor({})
        events: list[str] = []

        def _status(job, index, status, error=None, **_):
            job.file_details[index].status = status
            job.file_details[index].error_message = error

        monkeypatch.setattr(ingestor, "_update_file_status", _status)
        monkeypatch.setattr(ingestor, "_thumbnail_after_screen", lambda url, path: events.append(f"thumbnail:{path}"))
        ingestor.events = events
        return ingestor

    def _read(self, ingestor, monkeypatch, caption: str | None, tmp_path):
        from knowledge_layer.ingest import adapter
        from knowledge_layer.ingest.image_ingest import read_standalone_image
        from knowledge_layer.ingest.screening import ScreeningRules
        from llama_index.core import Document

        documents = None if caption is None else [Document(text=caption, metadata={"content_type": "image"})]
        monkeypatch.setattr(adapter, "_build_image_documents", lambda *a, **k: documents)
        path = tmp_path / "foto.png"
        path.write_bytes(b"\x89PNG\r\n\x1a\n")
        job = _job(FileProgress(file_name="foto.png", status=FileStatus.INGESTING))
        stages: dict[str, float] = {}
        read = read_standalone_image(
            ingestor,
            job,
            0,
            file_path=str(path),
            file_name="foto.png",
            file_size=8,
            image_format="png",
            rules=ScreeningRules.from_config(self.TERMS),
            thumbnail_upload_url="http://seaweed/put/thumb",
            vision={"vlm_model": "m", "vlm_base_url": OPENROUTER, "vlm_api_key": "k", "extract_charts": True},
            stages=stages,
        )
        return read, job.file_details[0], stages

    def test_a_clean_reading_is_partial_and_then_gets_its_thumbnail(self, ingestor, monkeypatch, tmp_path):
        read, detail, stages = self._read(ingestor, monkeypatch, "Ein Foto der Baustelle.", tmp_path)

        assert read.documents is not None
        assert detail.screening == "partial"
        assert ingestor.events == [f"thumbnail:{tmp_path / 'foto.png'}"]
        assert {"vision", "screen"} <= set(stages)

    def test_a_match_quarantines_the_image_and_draws_no_thumbnail(self, ingestor, monkeypatch, tmp_path):
        from knowledge_layer.ingest.screening import QUARANTINED_PREFIX

        read, detail, _ = self._read(ingestor, monkeypatch, "Gehaltsabrechnung Oktober", tmp_path)

        assert read.documents is None
        assert detail.screening == "quarantined"
        assert detail.status == FileStatus.FAILED and detail.error_message.startswith(QUARANTINED_PREFIX)
        assert detail.quarantine.after_transcription is True, "the vision model saw it, and the verdict says so"
        assert ingestor.events == []

    def test_an_unread_image_fails_and_is_counted_not_read(self, ingestor, monkeypatch, tmp_path):
        read, detail, _ = self._read(ingestor, monkeypatch, None, tmp_path)

        assert read.documents is None and detail.status == FileStatus.FAILED
        assert read.coverage == image_coverage(read=False)
        assert detail.screening == "unchecked"
