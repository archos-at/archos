import json

import pytest
from agent_testing.langfuse import ENDPOINT
from agent_testing.langfuse import _make_config

from agent.observability.langfuse_trace_attributes import IDENTITY_ATTRIBUTES_ENV
from agent.observability.langfuse_trace_attributes import SESSION_ID_ATTRIBUTE
from agent.observability.langfuse_trace_attributes import TAGS_ATTRIBUTE
from agent.observability.langfuse_trace_attributes import LangfuseTraceAttributeProcessor
from agent.observability.langfuse_trace_attributes import identity_attributes_enabled
from agent.observability.langfuse_trace_attributes import langfuse_attributes_for
from agent.observability.otel_header_redaction_exporter import OtelCollectorRedactionTelemetryExporter
from agent.observability.otel_header_redaction_exporter import otelcollector_redaction_telemetry_exporter


class TestAttributeMapping:
    def test_maps_every_identity_field_to_the_name_langfuse_reads(self):
        attributes = langfuse_attributes_for(
            organization_id="org_456",
            project_id="proj_789",
            conversation_id="conv_abc",
        )

        assert attributes == {
            SESSION_ID_ATTRIBUTE: "conv_abc",
            "langfuse.trace.metadata.organization_id": "org_456",
            "langfuse.trace.metadata.project_id": "proj_789",
            TAGS_ATTRIBUTE: ["org:org_456"],
        }

    def test_omits_absent_fields_rather_than_inventing_placeholders(self):
        assert langfuse_attributes_for(organization_id=None, project_id=None, conversation_id=None) == {}

    def test_never_blanks_out_the_session_id_nat_already_set(self):
        attributes = langfuse_attributes_for(organization_id="org_456", project_id=None, conversation_id=None)

        assert SESSION_ID_ATTRIBUTE not in attributes

    def test_tags_the_tenant_so_the_trace_list_can_filter_on_it(self):
        attributes = langfuse_attributes_for(organization_id="org_456", project_id=None, conversation_id=None)

        assert attributes[TAGS_ATTRIBUTE] == ["org:org_456"]


class TestUserAttributionIsNats:
    def test_nat_puts_the_session_user_on_every_span(self):
        from nat.data_models.intermediate_step import IntermediateStep
        from nat.data_models.intermediate_step import IntermediateStepPayload
        from nat.data_models.intermediate_step import IntermediateStepType
        from nat.data_models.invocation_node import InvocationNode
        from nat.data_models.span import Span
        from nat.observability.exporter.span_exporter import SpanExporter
        from nat.plugin_api import ContextState

        class _Keep(SpanExporter[Span, Span]):
            async def export_processed(self, item: Span) -> None:
                return None

        state = ContextState.get()
        token = state.user_id.set("user_01VERIFIED")
        try:
            exporter = _Keep(context_state=state)
            exporter.export(
                IntermediateStep(
                    parent_id="root",
                    function_ancestry=InvocationNode(function_id="f", function_name="f"),
                    payload=IntermediateStepPayload(event_type=IntermediateStepType.LLM_START, name="m", UUID="u1"),
                )
            )
        finally:
            state.user_id.reset(token)

        span = exporter._span_stack["u1"]
        assert span.attributes["user.id"] == "user_01VERIFIED"
        assert any(key.endswith(".user.id") for key in span.attributes)

        import asyncio

        from agent.observability.langfuse_trace_attributes import UserIdentityStripProcessor

        stripped = asyncio.run(UserIdentityStripProcessor().process(span))
        assert not [key for key in stripped.attributes if key == "user.id" or key.endswith(".user.id")]


class TestAvailabilityGate:
    def test_defaults_to_off(self, monkeypatch):
        monkeypatch.delenv(IDENTITY_ATTRIBUTES_ENV, raising=False)
        assert identity_attributes_enabled() is False

    @pytest.mark.parametrize("value", ["true", "TRUE", " true "])
    def test_enabled_only_by_an_explicit_true(self, monkeypatch, value):
        monkeypatch.setenv(IDENTITY_ATTRIBUTES_ENV, value)
        assert identity_attributes_enabled() is True

    @pytest.mark.parametrize("value", ["", "false", "1", "yes"])
    def test_anything_else_leaves_it_off(self, monkeypatch, value):
        monkeypatch.setenv(IDENTITY_ATTRIBUTES_ENV, value)
        assert identity_attributes_enabled() is False


class TestProcessor:
    async def test_stamps_the_attributes_onto_a_span(self, monkeypatch):
        from nat.data_models.span import Span

        monkeypatch.setattr(
            "agent.observability.langfuse_trace_attributes.current_langfuse_attributes",
            lambda: {"langfuse.trace.metadata.organization_id": "org_456", SESSION_ID_ATTRIBUTE: "conv_abc"},
        )

        span = Span(name="llm-call")
        result = await LangfuseTraceAttributeProcessor().process(span)

        assert result.attributes["langfuse.trace.metadata.organization_id"] == "org_456"
        assert result.attributes[SESSION_ID_ATTRIBUTE] == "conv_abc"

    async def test_a_broken_context_degrades_the_trace_instead_of_failing_export(self, monkeypatch):
        from nat.data_models.span import Span

        def explode():
            raise RuntimeError("context is gone")

        monkeypatch.setattr(
            "agent.project_context.RequestContext.from_context",
            staticmethod(explode),
        )

        span = Span(name="llm-call")
        result = await LangfuseTraceAttributeProcessor().process(span)

        assert result is span
        assert SESSION_ID_ATTRIBUTE not in result.attributes


class TestPipelineWiring:
    async def test_absent_from_the_pipeline_when_the_tier_is_off(self, monkeypatch):
        monkeypatch.delenv(IDENTITY_ATTRIBUTES_ENV, raising=False)

        async with otelcollector_redaction_telemetry_exporter(_make_config(), None) as exporter:
            assert "langfuse_trace_attributes" not in exporter._processor_names

    async def test_runs_ahead_of_redaction_when_the_tier_is_on(self, monkeypatch):
        monkeypatch.setenv(IDENTITY_ATTRIBUTES_ENV, "true")

        async with otelcollector_redaction_telemetry_exporter(_make_config(), None) as exporter:
            positions = exporter._processor_names

            assert "langfuse_trace_attributes" in positions
            assert positions["langfuse_trace_attributes"] < positions["header_redaction"]

    async def test_identity_attributes_are_actually_redactable(self, monkeypatch):
        from nat.data_models.span import Span

        monkeypatch.setenv(IDENTITY_ATTRIBUTES_ENV, "true")
        monkeypatch.setattr(
            "agent.observability.langfuse_trace_attributes.current_langfuse_attributes",
            lambda: {"langfuse.trace.metadata.organization_id": "org_456"},
        )

        config = OtelCollectorRedactionTelemetryExporter(
            _type="otelcollector_redaction",
            project="backend-chat",
            endpoint=ENDPOINT,
            redaction_enabled=True,
            force_redaction=True,
            redaction_attributes=["langfuse.trace.metadata.organization_id"],
        )

        async with otelcollector_redaction_telemetry_exporter(config, None) as exporter:
            span = Span(name="llm-call")
            by_name = {name: exporter._processors[pos] for name, pos in exporter._processor_names.items()}
            span = await by_name["langfuse_trace_attributes"].process(span)
            span = await by_name["header_redaction"].process(span)

        assert span.attributes["langfuse.trace.metadata.organization_id"] == "[REDACTED]"


class TestToolContributions:
    @pytest.fixture(autouse=True)
    def _clean(self):
        from agent.observability.langfuse_trace_attributes import reset_contributions

        reset_contributions()
        yield
        reset_contributions()

    def test_recorded_facts_are_namespaced_like_the_identity_metadata(self):
        from agent.observability.langfuse_trace_attributes import _CONTRIBUTED
        from agent.observability.langfuse_trace_attributes import record_trace_metadata

        record_trace_metadata(ifc_op="compliance", ifc_model="haus.ifc", ifc_truncated=True)

        assert langfuse_attributes_for(
            organization_id=None,
            project_id=None,
            conversation_id=None,
            contributed=_CONTRIBUTED.get(),
        ) == {
            "langfuse.trace.metadata.ifc_op": "compliance",
            "langfuse.trace.metadata.ifc_model": "haus.ifc",
            "langfuse.trace.metadata.ifc_truncated": True,
        }

    def test_a_tool_tag_joins_the_organization_tag_rather_than_replacing_it(self):
        from agent.observability.langfuse_trace_attributes import _CONTRIBUTED
        from agent.observability.langfuse_trace_attributes import add_trace_tag

        add_trace_tag("feature:ifc")
        add_trace_tag("feature:ifc")

        attributes = langfuse_attributes_for(
            organization_id="org_456",
            project_id=None,
            conversation_id=None,
            contributed=_CONTRIBUTED.get(),
        )

        assert attributes[TAGS_ATTRIBUTE] == ["org:org_456", "feature:ifc"]

    def test_absent_values_are_dropped_here_too(self):
        from agent.observability.langfuse_trace_attributes import _CONTRIBUTED
        from agent.observability.langfuse_trace_attributes import record_trace_metadata

        record_trace_metadata(ifc_op="overview", ifc_model=None, ifc_truncated=None)

        assert langfuse_attributes_for(
            organization_id=None,
            project_id=None,
            conversation_id=None,
            contributed=_CONTRIBUTED.get(),
        ) == {"langfuse.trace.metadata.ifc_op": "overview"}

    def test_recording_never_raises_into_the_turn(self):
        from agent.observability.langfuse_trace_attributes import add_trace_tag
        from agent.observability.langfuse_trace_attributes import record_trace_metadata

        class Unhashable:
            __hash__ = None  # type: ignore[assignment]

        record_trace_metadata(ifc_op=Unhashable())
        add_trace_tag("feature:ifc")

    def test_nothing_is_attached_when_no_tool_contributed(self):
        assert langfuse_attributes_for(
            organization_id=None,
            project_id=None,
            conversation_id="conv_abc",
            contributed=None,
        ) == {SESSION_ID_ATTRIBUTE: "conv_abc"}


class TestContributionIsolation:
    @pytest.fixture(autouse=True)
    def _clean(self):
        from agent.observability.langfuse_trace_attributes import reset_contributions

        reset_contributions()
        yield
        reset_contributions()

    def test_next_job_starts_clean_after_previous_job_contributed(self):
        from agent.observability.langfuse_trace_attributes import add_trace_tag
        from agent.observability.langfuse_trace_attributes import begin_trace_contributions
        from agent.observability.langfuse_trace_attributes import end_trace_contributions
        from agent.observability.langfuse_trace_attributes import record_trace_metadata
        from agent.observability.langfuse_trace_attributes import snapshot_contributions

        job_n = begin_trace_contributions()
        try:
            record_trace_metadata(ifc_op="compliance", ifc_model="haus.ifc")
            add_trace_tag("feature:ifc")
            assert snapshot_contributions()["tags"] == ["feature:ifc"]
        finally:
            end_trace_contributions(job_n)

        job_n_plus_1 = begin_trace_contributions()
        try:
            fresh = snapshot_contributions()
            assert fresh == {"metadata": {}, "tags": []}
            attributes = langfuse_attributes_for(
                organization_id=None,
                project_id=None,
                conversation_id=None,
                contributed=fresh,
            )
            assert TAGS_ATTRIBUTE not in attributes
            assert "langfuse.trace.metadata.ifc_op" not in attributes
        finally:
            end_trace_contributions(job_n_plus_1)

    async def test_concurrent_researchers_do_not_cross_contaminate(self):
        import asyncio

        from agent.observability.langfuse_trace_attributes import add_trace_tag
        from agent.observability.langfuse_trace_attributes import record_trace_metadata
        from agent.observability.langfuse_trace_attributes import snapshot_contributions

        record_trace_metadata(ifc_op="base")

        async def worker_a():
            add_trace_tag("job:a")
            await asyncio.sleep(0.05)
            record_trace_metadata(ifc_detail="a")
            return snapshot_contributions()

        async def worker_b():
            add_trace_tag("job:b")
            await asyncio.sleep(0.01)
            return snapshot_contributions()

        result_a, result_b = await asyncio.gather(worker_a(), worker_b())

        assert "job:b" not in result_a["tags"]
        assert "job:a" not in result_b["tags"]
        assert result_a["metadata"].get("ifc_op") == "base"
        assert result_b["metadata"].get("ifc_op") == "base"

    async def test_export_task_snapshot_is_frozen_against_later_writes(self):
        import asyncio

        from agent.observability.langfuse_trace_attributes import add_trace_tag
        from agent.observability.langfuse_trace_attributes import record_trace_metadata
        from agent.observability.langfuse_trace_attributes import snapshot_contributions

        record_trace_metadata(ifc_op="early")

        async def export_reader():
            await asyncio.sleep(0.05)
            return snapshot_contributions()

        task = asyncio.create_task(export_reader())
        record_trace_metadata(ifc_op="late")
        add_trace_tag("feature:ifc")

        exported = await task
        assert exported["metadata"].get("ifc_op") == "early"
        assert "feature:ifc" not in exported["tags"]

    def test_snapshot_holds_no_live_reference(self):
        from agent.observability.langfuse_trace_attributes import record_trace_metadata
        from agent.observability.langfuse_trace_attributes import snapshot_contributions

        record_trace_metadata(ifc_op="early")
        snap = snapshot_contributions()
        assert snap is not None
        snap["metadata"]["ifc_op"] = "rewritten"
        snap["tags"].append("feature:ifc")

        fresh = snapshot_contributions()
        assert fresh["metadata"].get("ifc_op") == "early"
        assert "feature:ifc" not in fresh["tags"]


class TestUsageObservationMapping:
    def test_provider_verbatim_counts_and_exclusive_detail_buckets(self):
        import json

        from agent.observability.usage_details import GEN_AI_REQUEST_MODEL
        from agent.observability.usage_details import GEN_AI_USAGE_INPUT_TOKENS
        from agent.observability.usage_details import GEN_AI_USAGE_OUTPUT_TOKENS
        from agent.observability.usage_details import OBSERVATION_COST_DETAILS
        from agent.observability.usage_details import OBSERVATION_MODEL_NAME
        from agent.observability.usage_details import OBSERVATION_USAGE_DETAILS
        from agent.observability.usage_details import usage_observation_attributes

        attributes = usage_observation_attributes(
            prompt_tokens=1204,
            completion_tokens=331,
            total_tokens=1535,
            cached_tokens=512,
            reasoning_tokens=128,
            cost_usd=0.00214,
            model="openrouter/deepseek-v4",
        )

        assert attributes[GEN_AI_USAGE_INPUT_TOKENS] == 1204
        assert attributes[GEN_AI_USAGE_OUTPUT_TOKENS] == 331
        assert json.loads(attributes[OBSERVATION_USAGE_DETAILS]) == {
            "input": 692,
            "output": 203,
            "total": 1535,
            "input_cached_tokens": 512,
            "output_reasoning_tokens": 128,
        }
        assert json.loads(attributes[OBSERVATION_COST_DETAILS]) == {"total": 0.00214}
        assert attributes[GEN_AI_REQUEST_MODEL] == "openrouter/deepseek-v4"
        assert attributes[OBSERVATION_MODEL_NAME] == "openrouter/deepseek-v4"

    def test_token_only_fallback_omits_cost_and_model(self):
        import json

        from agent.observability.usage_details import OBSERVATION_COST_DETAILS
        from agent.observability.usage_details import OBSERVATION_USAGE_DETAILS
        from agent.observability.usage_details import usage_observation_attributes

        attributes = usage_observation_attributes(prompt_tokens=100, completion_tokens=20, total_tokens=120)

        assert json.loads(attributes[OBSERVATION_USAGE_DETAILS]) == {
            "input": 100,
            "output": 20,
            "total": 120,
        }
        assert OBSERVATION_COST_DETAILS not in attributes
        assert "gen_ai.request.model" not in attributes


class TestExtractProviderUsage:
    def test_reads_the_openrouter_object_inside_span_metadata(self):
        import json

        from agent.observability.langfuse_trace_attributes import extract_provider_usage

        metadata = json.dumps(
            {
                "chat_responses": [
                    {
                        "message": {
                            "response_metadata": {
                                "token_usage": {
                                    "prompt_tokens": 1204,
                                    "completion_tokens": 331,
                                    "total_tokens": 1535,
                                    "cost": 0.00214,
                                    "prompt_tokens_details": {"cached_tokens": 512},
                                    "completion_tokens_details": {"reasoning_tokens": 128},
                                }
                            }
                        }
                    }
                ]
            }
        )

        assert extract_provider_usage(metadata) == {
            "prompt_tokens": 1204,
            "completion_tokens": 331,
            "total_tokens": 1535,
            "cached_tokens": 512,
            "cache_write_tokens": 0,
            "reasoning_tokens": 128,
            "cost_usd": 0.00214,
        }

    def test_missing_cost_reports_none_not_zero(self):
        import json

        from agent.observability.langfuse_trace_attributes import extract_provider_usage

        token_usage = {"prompt_tokens": 10, "completion_tokens": 5}
        metadata = json.dumps({"chat_responses": [{"message": {"response_metadata": {"token_usage": token_usage}}}]})

        usage = extract_provider_usage(metadata)
        assert usage is not None
        assert usage["cost_usd"] is None

    def test_responses_path_ingests_the_carried_provider_cost(self):
        import json

        from agent.common.cost_tracking import RESPONSES_ACCOUNTING_KEY
        from agent.observability.langfuse_trace_attributes import extract_provider_usage

        message = {
            "usage_metadata": {
                "input_tokens": 1000,
                "output_tokens": 50,
                "total_tokens": 1050,
                "input_token_details": {"cache_read": 800},
            },
            "response_metadata": {RESPONSES_ACCOUNTING_KEY: {"cost": 0.0123, "is_byok": False}},
        }
        usage = extract_provider_usage(json.dumps({"chat_responses": [{"message": message}]}))

        assert usage is not None
        assert usage["cost_usd"] == 0.0123
        assert usage["cached_tokens"] == 800

    def test_no_usage_object_is_absent_not_zeroed(self):
        from agent.observability.langfuse_trace_attributes import extract_provider_usage

        assert extract_provider_usage('{"chat_responses": []}') is None
        assert extract_provider_usage("not-json") is None
        assert extract_provider_usage(None) is None


class TestUsageComesFromTheResponseSideOnly:
    PREVIOUS_ANSWER = {
        "prompt_tokens": 30511,
        "completion_tokens": 77,
        "total_tokens": 30588,
        "completion_tokens_details": {"reasoning_tokens": 38},
    }
    THIS_ANSWER = {
        "input_tokens": 41204,
        "output_tokens": 512,
        "total_tokens": 41716,
        "input_token_details": {"cache_read": 30208},
        "output_token_details": {"reasoning": 256},
    }

    def _metadata(self, *, inputs: bool, responses: bool) -> str:
        payload: dict = {}
        if responses:
            payload["chat_responses"] = [
                {
                    "type": "ChatGeneration",
                    "message": {
                        "content": "this answer",
                        "response_metadata": {"model_name": "vendor/model"},
                        "usage_metadata": self.THIS_ANSWER,
                    },
                }
            ]
        if inputs:
            payload["chat_inputs"] = [
                {"type": "system", "content": "..."},
                {
                    "type": "ai",
                    "content": "the previous answer",
                    "response_metadata": {"token_usage": self.PREVIOUS_ANSWER},
                },
                {"type": "tool", "content": "..."},
            ]
        return json.dumps(payload)

    def test_the_prompt_history_never_answers_for_this_call(self):
        from agent.observability.langfuse_trace_attributes import extract_provider_usage

        usage = extract_provider_usage(self._metadata(inputs=True, responses=True))

        assert usage == {
            "prompt_tokens": 41204,
            "completion_tokens": 512,
            "total_tokens": 41716,
            "cached_tokens": 30208,
            "cache_write_tokens": 0,
            "reasoning_tokens": 256,
            "cost_usd": None,
        }

    def test_usage_only_on_the_input_side_is_absent(self):
        from agent.observability.langfuse_trace_attributes import extract_provider_usage

        assert extract_provider_usage(self._metadata(inputs=True, responses=False)) is None

    def test_tool_inputs_are_not_read_either(self):
        from agent.observability.langfuse_trace_attributes import extract_provider_usage

        metadata = json.dumps(
            {
                "tool_inputs": {"messages": [{"response_metadata": {"token_usage": self.PREVIOUS_ANSWER}}]},
                "span_inputs": {"usage_metadata": {"input_tokens": 9, "output_tokens": 9}},
            }
        )

        assert extract_provider_usage(metadata) is None


class TestResponsesApiSpanUsage:
    METADATA = json.dumps(
        {
            "chat_responses": [
                {
                    "message": {
                        "response_metadata": {"model_name": "openai/gpt-5.6-luna"},
                        "usage_metadata": {
                            "input_tokens": 41883,
                            "output_tokens": 514,
                            "total_tokens": 42397,
                            "input_token_details": {"cache_read": 35072},
                            "output_token_details": {"reasoning": 192},
                        },
                    }
                }
            ]
        }
    )

    def test_cached_and_reasoning_tokens_are_recovered(self):
        from agent.observability.langfuse_trace_attributes import extract_provider_usage

        usage = extract_provider_usage(self.METADATA)
        assert usage == {
            "prompt_tokens": 41883,
            "completion_tokens": 514,
            "total_tokens": 42397,
            "cached_tokens": 35072,
            "cache_write_tokens": 0,
            "reasoning_tokens": 192,
            "cost_usd": None,
        }

    def test_the_cached_bucket_reaches_the_observation_attributes(self):
        from agent.observability.langfuse_trace_attributes import extract_provider_usage
        from agent.observability.usage_details import OBSERVATION_USAGE_DETAILS
        from agent.observability.usage_details import usage_observation_attributes

        usage = extract_provider_usage(self.METADATA)
        attributes = usage_observation_attributes(
            prompt_tokens=usage["prompt_tokens"],
            completion_tokens=usage["completion_tokens"],
            total_tokens=usage["total_tokens"],
            cached_tokens=usage["cached_tokens"],
            reasoning_tokens=usage["reasoning_tokens"],
            cost_usd=usage["cost_usd"],
            model="openai/gpt-5.6-luna",
        )
        details = json.loads(attributes[OBSERVATION_USAGE_DETAILS])
        assert details["input_cached_tokens"] == 35072
        assert details["input"] == 41883 - 35072
        assert details["output"] == 514 - 192

    def test_the_provider_object_still_wins_when_both_are_present(self):
        from agent.observability.langfuse_trace_attributes import extract_provider_usage

        metadata = json.dumps(
            {
                "chat_responses": [
                    {
                        "message": {
                            "response_metadata": {
                                "token_usage": {
                                    "prompt_tokens": 10,
                                    "completion_tokens": 5,
                                    "total_tokens": 15,
                                    "cost": 0.5,
                                    "prompt_tokens_details": {"cached_tokens": 4},
                                }
                            },
                            "usage_metadata": {"input_tokens": 999, "output_tokens": 9},
                        }
                    }
                ]
            }
        )
        usage = extract_provider_usage(metadata)
        assert usage["prompt_tokens"] == 10
        assert usage["cost_usd"] == 0.5


class TestSpanTokenCounts:
    def test_zero_counts_are_absent_not_zeroed(self):
        from agent.observability.langfuse_trace_attributes import extract_span_token_counts

        assert extract_span_token_counts({}) is None
        assert (
            extract_span_token_counts(
                {
                    "llm.token_count.prompt": 0,
                    "llm.token_count.completion": 0,
                    "llm.token_count.total": 0,
                }
            )
            is None
        )

    def test_partial_counts_still_land(self):
        from agent.observability.langfuse_trace_attributes import extract_span_token_counts

        assert extract_span_token_counts({"llm.token_count.prompt": 50}) == {
            "prompt_tokens": 50,
            "completion_tokens": 0,
            "total_tokens": 0,
        }


class TestUsageAttributeProcessor:
    def _llm_span(self, **attributes):
        from nat.data_models.span import Span

        base = {
            "nat.event_type": "LLM_START",
            "llm.token_count.prompt": 1204,
            "llm.token_count.completion": 331,
            "llm.token_count.total": 1535,
        }
        base.update(attributes)
        return Span(name="openrouter/deepseek-v4", attributes=base)

    async def test_llm_span_gains_the_gen_ai_namespace(self):
        from agent.observability.langfuse_trace_attributes import UsageAttributeProcessor

        span = await UsageAttributeProcessor().process(self._llm_span())

        assert span.attributes["gen_ai.usage.input_tokens"] == 1204
        assert span.attributes["gen_ai.usage.output_tokens"] == 331
        assert span.attributes["gen_ai.request.model"] == "openrouter/deepseek-v4"

    async def test_a_decision_span_gains_its_tokens_cost_and_model_from_its_own_output(self):
        from agent.observability.decision_trace import decision_observation
        from agent.observability.langfuse_trace_attributes import UsageAttributeProcessor
        from nat.data_models.span import Span

        _, body_out = decision_observation(
            questions=["precedent"],
            states=1,
            model="typesafe/jev-1.13",
            input_tokens=341,
            output_tokens=22,
            cost_usd=1.4e-05,
        )
        span = Span(
            name="decide.turn", attributes={"nat.event_type": "FUNCTION_START", "output.value": json.dumps(body_out)}
        )

        span = await UsageAttributeProcessor().process(span)

        assert span.attributes["gen_ai.usage.input_tokens"] == 341
        assert span.attributes["gen_ai.usage.output_tokens"] == 22
        assert span.attributes["gen_ai.request.model"] == "typesafe/jev-1.13"

    async def test_provider_object_in_metadata_beats_bare_counts(self):
        import json

        from agent.observability.langfuse_trace_attributes import UsageAttributeProcessor

        metadata = json.dumps(
            {
                "chat_responses": [
                    {
                        "message": {
                            "response_metadata": {
                                "token_usage": {
                                    "prompt_tokens": 1204,
                                    "completion_tokens": 331,
                                    "total_tokens": 1535,
                                    "cost": 0.00214,
                                    "prompt_tokens_details": {"cached_tokens": 512},
                                }
                            }
                        }
                    }
                ]
            }
        )
        span = await UsageAttributeProcessor().process(self._llm_span(**{"nat.metadata": metadata}))

        assert json.loads(span.attributes["langfuse.observation.usage_details"]) == {
            "input": 692,
            "output": 331,
            "total": 1535,
            "input_cached_tokens": 512,
        }
        assert json.loads(span.attributes["langfuse.observation.cost_details"]) == {"total": 0.00214}

    async def test_metadata_recovers_usage_when_counts_are_zero(self):
        import json

        from agent.observability.langfuse_trace_attributes import UsageAttributeProcessor

        metadata = json.dumps(
            {
                "chat_responses": [
                    {"message": {"response_metadata": {"token_usage": {"prompt_tokens": 40, "completion_tokens": 8}}}}
                ]
            }
        )
        span = self._llm_span(**{"nat.metadata": metadata})
        span.attributes["llm.token_count.prompt"] = 0
        span.attributes["llm.token_count.completion"] = 0
        span.attributes["llm.token_count.total"] = 0

        span = await UsageAttributeProcessor().process(span)

        assert span.attributes["gen_ai.usage.input_tokens"] == 40
        assert span.attributes["gen_ai.usage.output_tokens"] == 8

    async def test_non_llm_spans_pass_through_untouched(self):
        from agent.observability.langfuse_trace_attributes import UsageAttributeProcessor
        from nat.data_models.span import Span

        span = Span(name="knowledge_search", attributes={"nat.event_type": "TOOL_START"})
        result = await UsageAttributeProcessor().process(span)

        assert result is span
        assert "gen_ai.usage.input_tokens" not in result.attributes

    async def test_llm_span_without_any_usage_stays_absent_not_zeroed(self):
        from agent.observability.langfuse_trace_attributes import UsageAttributeProcessor
        from nat.data_models.span import Span

        span = Span(name="m", attributes={"nat.event_type": "LLM_START"})
        result = await UsageAttributeProcessor().process(span)

        assert "gen_ai.usage.input_tokens" not in result.attributes
        assert "langfuse.observation.usage_details" not in result.attributes


class TestUsagePipelineWiring:
    async def test_installed_without_the_identity_flag_and_ahead_of_redaction(self, monkeypatch):
        from agent.observability.langfuse_trace_attributes import IDENTITY_ATTRIBUTES_ENV
        from agent.observability.otel_header_redaction_exporter import otelcollector_redaction_telemetry_exporter

        monkeypatch.delenv(IDENTITY_ATTRIBUTES_ENV, raising=False)

        async with otelcollector_redaction_telemetry_exporter(_make_config(), None) as exporter:
            positions = exporter._processor_names

            assert "usage_attributes" in positions
            assert "langfuse_trace_attributes" not in positions
            assert positions["usage_attributes"] < positions["header_redaction"]


class TestPosthogSessionLink:
    SESSION = "0199d7f2-5b3a-7c4e-9a1d-3e8f2b6c5d70"

    def test_the_metadata_key_is_the_one_langfuse_reads(self):
        from agent.observability.langfuse_trace_attributes import METADATA_PREFIX
        from agent.observability.langfuse_trace_attributes import POSTHOG_SESSION_METADATA_KEY

        assert POSTHOG_SESSION_METADATA_KEY == "$posthog_session_id"
        assert f"{METADATA_PREFIX}{POSTHOG_SESSION_METADATA_KEY}" == "langfuse.trace.metadata.$posthog_session_id"

    @pytest.mark.parametrize(
        "value",
        [SESSION, SESSION.upper(), f"  {SESSION} "],
    )
    def test_a_uuid_v7_is_accepted_and_normalized(self, value):
        from agent.observability.langfuse_trace_attributes import posthog_session_id_or_none

        assert posthog_session_id_or_none(value) == self.SESSION

    @pytest.mark.parametrize(
        "value",
        [
            None,
            42,
            "",
            "not-a-session",
            "0199d7f2-5b3a-4c4e-9a1d-3e8f2b6c5d70",  # UUIDv4: the version nibble is 4
            "0199d7f2-5b3a-7c4e-1a1d-3e8f2b6c5d70",  # wrong variant
            "0199d7f2-5b3a-7c4e-9a1d-3e8f2b6c5d70-extra",
            "0199d7f2-5b3a-7c4e-9a1d-3e8f2b6c5d70\n<script>",
        ],
    )
    def test_anything_else_is_not_a_session_id(self, value):
        from agent.observability.langfuse_trace_attributes import posthog_session_id_or_none

        assert posthog_session_id_or_none(value) is None

    def test_it_rides_the_identity_switch_and_lands_in_the_turns_metadata(self, monkeypatch):
        from agent.observability.langfuse_trace_attributes import record_posthog_session
        from agent.observability.langfuse_trace_attributes import reset_contributions
        from agent.observability.langfuse_trace_attributes import snapshot_contributions

        reset_contributions()
        monkeypatch.delenv(IDENTITY_ATTRIBUTES_ENV, raising=False)
        assert record_posthog_session(self.SESSION) is False
        assert snapshot_contributions() is None

        monkeypatch.setenv(IDENTITY_ATTRIBUTES_ENV, "true")
        assert record_posthog_session("nope") is False
        assert record_posthog_session(self.SESSION) is True
        assert snapshot_contributions()["metadata"] == {"$posthog_session_id": self.SESSION}
        reset_contributions()

    def test_the_span_attribute_is_the_trace_metadata_namespace(self):
        from agent.observability.langfuse_trace_attributes import langfuse_attributes_for

        attributes = langfuse_attributes_for(
            organization_id=None,
            project_id=None,
            conversation_id=None,
            contributed={"metadata": {"$posthog_session_id": self.SESSION}, "tags": []},
        )
        assert attributes == {"langfuse.trace.metadata.$posthog_session_id": self.SESSION}


class TestLessonsMetadata:
    LESSON_A = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"
    LESSON_B = "9b2f6c1a-7d3e-4c1b-8a55-1f0e2d3c4b5a"

    def test_the_arm_and_the_lessons_land_in_the_turns_metadata_without_the_identity_switch(self, monkeypatch):
        from agent.observability.langfuse_trace_attributes import record_lessons
        from agent.observability.langfuse_trace_attributes import reset_contributions
        from agent.observability.langfuse_trace_attributes import snapshot_contributions

        reset_contributions()
        monkeypatch.delenv(IDENTITY_ATTRIBUTES_ENV, raising=False)
        record_lessons("treated", (self.LESSON_A, self.LESSON_B))
        assert snapshot_contributions()["metadata"] == {
            "lessons_arm": "treated",
            "lesson_ids": f"{self.LESSON_A},{self.LESSON_B}",
        }
        reset_contributions()

    def test_a_turn_with_no_lessons_records_the_arm_alone(self):
        from agent.observability.langfuse_trace_attributes import record_lessons
        from agent.observability.langfuse_trace_attributes import reset_contributions
        from agent.observability.langfuse_trace_attributes import snapshot_contributions

        reset_contributions()
        record_lessons("holdout", ())
        assert snapshot_contributions()["metadata"] == {"lessons_arm": "holdout"}
        reset_contributions()

    def test_the_span_attributes_are_the_trace_metadata_namespace(self):
        attributes = langfuse_attributes_for(
            organization_id=None,
            project_id=None,
            conversation_id=None,
            contributed={"metadata": {"lessons_arm": "treated", "lesson_ids": self.LESSON_A}, "tags": []},
        )
        assert attributes == {
            "langfuse.trace.metadata.lessons_arm": "treated",
            "langfuse.trace.metadata.lesson_ids": self.LESSON_A,
        }


def test_cache_writes_ride_their_own_usage_bucket():
    from agent.observability.usage_details import OBSERVATION_USAGE_DETAILS
    from agent.observability.usage_details import usage_observation_attributes

    attributes = usage_observation_attributes(
        prompt_tokens=30_000, completion_tokens=500, total_tokens=30_500, cached_tokens=4_000, cache_write_tokens=25_000
    )
    assert json.loads(attributes[OBSERVATION_USAGE_DETAILS]) == {
        "input": 1_000,
        "output": 500,
        "total": 30_500,
        "input_cached_tokens": 4_000,
        "input_cache_write_tokens": 25_000,
    }
