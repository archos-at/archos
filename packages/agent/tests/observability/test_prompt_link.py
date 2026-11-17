from __future__ import annotations

import asyncio
import contextvars

import pytest

from agent.observability.langfuse_trace_attributes import OBSERVATION_PROMPT_NAME
from agent.observability.langfuse_trace_attributes import OBSERVATION_PROMPT_VERSION
from agent.observability.langfuse_trace_attributes import PromptLinkProcessor
from agent.observability.langfuse_trace_attributes import begin_turn_prompt_link
from agent.observability.langfuse_trace_attributes import current_prompt_attributes
from agent.observability.langfuse_trace_attributes import end_turn_prompt_link
from agent.observability.langfuse_trace_attributes import is_generation_span
from agent.observability.langfuse_trace_attributes import prompt_observation_attributes
from agent.observability.langfuse_trace_attributes import record_prompt_link
from agent.observability.langfuse_trace_attributes import reset_prompt_link


@pytest.fixture(autouse=True)
def _clean_link():
    reset_prompt_link()
    yield
    reset_prompt_link()


class TestAttributeMapping:
    def test_the_keys_are_the_ones_langfuses_otel_mapping_reads(self):
        assert prompt_observation_attributes(name="piloti-system-static", version="12") == {
            "langfuse.observation.prompt.name": "piloti-system-static",
            "langfuse.observation.prompt.version": 12,
        }

    def test_half_a_link_is_no_link(self):
        assert prompt_observation_attributes(name="p", version=None) == {}
        assert prompt_observation_attributes(name=None, version="12") == {}
        assert prompt_observation_attributes(name="", version="") == {}

    def test_the_version_is_an_int_whichever_way_it_arrives(self):
        assert prompt_observation_attributes(name="p", version=12)[OBSERVATION_PROMPT_VERSION] == 12
        assert prompt_observation_attributes(name="p", version="12")[OBSERVATION_PROMPT_VERSION] == 12

    def test_the_type_is_read_off_the_installed_langfuse_rather_than_copied(self):
        import typing

        from langfuse.api.ingestion.types.create_generation_body import CreateGenerationBody

        declared = CreateGenerationBody.model_fields["prompt_version"].annotation
        emitted = prompt_observation_attributes(name="p", version="12")[OBSERVATION_PROMPT_VERSION]

        assert typing.get_args(declared) == (int, type(None))
        assert CreateGenerationBody(prompt_version=emitted).prompt_version == emitted

    def test_a_git_blob_version_is_no_link_at_all(self):
        assert prompt_observation_attributes(name="git:prompts/chat_static.md", version="3f2a9c1") == {}


class TestRecording:
    def test_nothing_is_attached_before_a_prompt_is_resolved(self):
        assert current_prompt_attributes() == {}

    def test_recording_replaces_rather_than_accumulates(self):
        record_prompt_link(name="piloti-system-static", version="11")
        record_prompt_link(name="piloti-system-static", version="12")

        assert current_prompt_attributes() == {
            OBSERVATION_PROMPT_NAME: "piloti-system-static",
            OBSERVATION_PROMPT_VERSION: 12,
        }

    def test_an_incomplete_record_leaves_the_last_good_one_alone(self):
        record_prompt_link(name="piloti-system-static", version="12")
        record_prompt_link(name="piloti-system-static", version="")

        assert current_prompt_attributes()[OBSERVATION_PROMPT_VERSION] == 12

    def test_recording_never_raises_into_the_render_that_called_it(self):

        class Hostile:
            def __str__(self):
                raise RuntimeError("no")

        record_prompt_link(name=Hostile(), version="12")

        assert current_prompt_attributes() == {}


class TestATurnNamesWhatItRenderedWith:
    def test_a_refresh_in_another_turn_does_not_reach_this_turn(self):
        token = begin_turn_prompt_link()
        try:
            record_prompt_link(name="p", version="12")

            def _other_turn() -> None:
                other = begin_turn_prompt_link()
                record_prompt_link(name="p", version="13")
                end_turn_prompt_link(other)

            contextvars.copy_context().run(_other_turn)

            assert current_prompt_attributes()[OBSERVATION_PROMPT_VERSION] == 12
        finally:
            end_turn_prompt_link(token)

    async def test_the_render_thread_s_resolution_is_the_turn_s(self):
        token = begin_turn_prompt_link()
        try:
            await asyncio.to_thread(record_prompt_link, name="p", version="12")

            assert current_prompt_attributes()[OBSERVATION_PROMPT_VERSION] == 12
        finally:
            end_turn_prompt_link(token)

    def test_without_a_turn_the_process_link_answers(self):
        record_prompt_link(name="p", version="12")

        assert current_prompt_attributes()[OBSERVATION_PROMPT_VERSION] == 12

    def test_a_fallback_clears_the_turn_s_box_too(self):
        token = begin_turn_prompt_link()
        try:
            record_prompt_link(name="p", version="12")
            reset_prompt_link()

            assert current_prompt_attributes() == {}
        finally:
            end_turn_prompt_link(token)


class TestGenerationDetection:
    def test_an_llm_span_is_a_generation_whatever_the_key_prefix(self):
        assert is_generation_span({"nat.event_type": "LLM_END"}) is True
        assert is_generation_span({"some.vendor.event_type": "LLM_START"}) is True

    def test_everything_else_is_not(self):
        assert is_generation_span({}) is False
        assert is_generation_span({"nat.event_type": "TOOL_END"}) is False
        assert is_generation_span({"nat.event_type": 7}) is False


class TestProcessor:
    async def test_it_stamps_the_current_link_onto_a_generation(self):
        from nat.data_models.span import Span

        record_prompt_link(name="piloti-system-static", version="12")
        span = Span(name="a-model", attributes={"nat.event_type": "LLM_END"})

        result = await PromptLinkProcessor().process(span)

        assert result.attributes[OBSERVATION_PROMPT_NAME] == "piloti-system-static"
        assert result.attributes[OBSERVATION_PROMPT_VERSION] == 12

    async def test_a_tool_span_is_left_alone(self):
        from nat.data_models.span import Span

        record_prompt_link(name="piloti-system-static", version="12")
        span = Span(name="search_documents", attributes={"nat.event_type": "TOOL_END"})

        result = await PromptLinkProcessor().process(span)

        assert OBSERVATION_PROMPT_NAME not in (result.attributes or {})

    async def test_no_recorded_link_leaves_the_span_untouched(self):
        from nat.data_models.span import Span

        span = Span(name="a-model", attributes={"nat.event_type": "LLM_END"})

        result = await PromptLinkProcessor().process(span)

        assert OBSERVATION_PROMPT_NAME not in (result.attributes or {})

    async def test_a_broken_link_degrades_the_trace_instead_of_failing_export(self, monkeypatch):
        import agent.observability.langfuse_trace_attributes as module
        from nat.data_models.span import Span

        def boom():
            raise RuntimeError("nope")

        monkeypatch.setattr(module, "current_prompt_attributes", boom)
        span = Span(name="a-model", attributes={"nat.event_type": "LLM_END"})

        result = await PromptLinkProcessor().process(span)

        assert result is span


class TestPipelineWiring:
    async def test_it_is_installed_ahead_of_redaction(self, monkeypatch):
        from agent_testing.langfuse import _make_config

        from agent.observability.otel_header_redaction_exporter import otelcollector_redaction_telemetry_exporter

        async with otelcollector_redaction_telemetry_exporter(_make_config(), None) as exporter:
            positions = exporter._processor_names

            assert "prompt_link" in positions
            assert positions["prompt_link"] < positions["header_redaction"]
