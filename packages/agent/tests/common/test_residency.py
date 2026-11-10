"""Residency (ADR-0167): every model call is routed into the cell's zone, refused outside it, and recorded.

Each guard is exercised through the real seam (the httpx transport, the chat-request contract, the org lookup)
with a positive control beside it, and the refusals carry a revert check: the same planted call with the guard
patched out reaches the network, so the test fails if the guard is removed.
"""

from __future__ import annotations

import json

import httpx
import pytest
from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI

from agent.common import openrouter
from agent.common import residency
from agent.common.llm_factory import enforce_chat_request_contract
from agent.common.openrouter import NO_RETENTION_LIMITS
from agent.common.openrouter import ZERO_DATA_RETENTION
from agent.common.openrouter import DataPolicy
from agent.common.openrouter import pinned_http_client
from agent.common.residency import ProcessingPolicy
from agent.common.residency import ResidencyError
from agent.common.residency import ResidencyViolation
from agent.observability import direct_trace
from agent.observability.processing_location import route_attributes

CELL = "eu-at-1"
EU_BASE = "https://eu.openrouter.ai/api/v1"
GLOBAL_BASE = "https://openrouter.ai/api/v1"
EU_ENV = {name: EU_BASE for name in residency.MODEL_BASE_URL_ENVS}


@pytest.fixture
def cell(monkeypatch):
    monkeypatch.setenv(residency.RESIDENCY_CELL_ENV, CELL)
    return residency.active_cell()


@pytest.fixture
def no_cell(monkeypatch):
    monkeypatch.delenv(residency.RESIDENCY_CELL_ENV, raising=False)


@pytest.fixture
def routes(monkeypatch):
    """Every route the seam records, in order."""
    seen: list[residency.Route] = []
    token = residency.route_sink().set(seen.append)
    yield seen
    residency.route_sink().reset(token)


def _client(sent: list[httpx.Request], policy: DataPolicy = ZERO_DATA_RETENTION) -> httpx.Client:
    client = pinned_http_client(policy)

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(200, json={"ok": True})

    client._transport._inner = httpx.MockTransport(handler)
    return client


class TestRoutes:
    def test_the_register_places_both_gateway_hosts(self):
        placed = residency.endpoints()
        assert placed["eu.openrouter.ai"] == ("openrouter", ("EU",))
        assert placed["openrouter.ai"] == ("openrouter", ("US",))

    def test_eu_host_is_inside_the_eu_zone(self, cell):
        route = residency.route_for(EU_BASE, cell)
        assert (route.processing_location, route.subprocessor, route.compliant) == ("EU", "openrouter", True)

    def test_global_host_is_outside_the_eu_zone(self, cell):
        assert residency.route_for(GLOBAL_BASE, cell).compliant is False

    def test_an_unplaced_host_is_never_compliant_even_without_a_cell(self):
        route = residency.route_for("https://api.openai.com/v1", None)
        assert (route.processing_location, route.subprocessor, route.compliant) == ("unknown", "unknown", False)

    def test_without_a_cell_a_placed_host_is_compliant(self):
        assert residency.route_for(GLOBAL_BASE, None).compliant is True

    def test_the_zone_rewrites_the_gateway_and_nothing_else(self, cell):
        assert residency.routed_url(f"{GLOBAL_BASE}/chat/completions", cell) == f"{EU_BASE}/chat/completions"
        assert residency.routed_url("https://api.openai.com/v1", cell) == "https://api.openai.com/v1"
        assert residency.routed_url(f"{GLOBAL_BASE}/x", None) == f"{GLOBAL_BASE}/x"

    def test_an_unknown_cell_refuses(self, monkeypatch):
        monkeypatch.setenv(residency.RESIDENCY_CELL_ENV, "us-xx-9")
        with pytest.raises(ResidencyError):
            residency.active_cell()


class TestTheTransport:
    """Embeddings, vision, reranking, summaries, the distiller, dictation: every bespoke call rides this transport."""

    def test_flag_off_sends_where_it_was_sent(self, no_cell, routes):
        sent: list[httpx.Request] = []
        _client(sent).post(f"{GLOBAL_BASE}/embeddings", json={"model": "m", "input": "x"})
        assert sent[0].url.host == "openrouter.ai"
        assert routes[-1].processing_location == "US"

    def test_a_cell_routes_the_gateway_into_the_eu_and_keeps_the_zdr_pin(self, cell, routes):
        sent: list[httpx.Request] = []
        _client(sent).post(f"{GLOBAL_BASE}/embeddings", json={"model": "m", "input": "x"})
        assert sent[0].url.host == "eu.openrouter.ai"
        assert sent[0].headers["host"] == "eu.openrouter.ai"
        assert json.loads(sent[0].content)["provider"]["zdr"] is True
        assert routes[-1].metadata() == {
            "processing_location": "EU",
            "subprocessor": "openrouter",
            "processing_location_compliant": True,
        }

    def test_a_non_json_body_is_routed_too(self, cell):
        sent: list[httpx.Request] = []
        # Dictation's shape: a multipart upload on a client that leaves the body to the caller (no pin to merge).
        client = _client(sent, NO_RETENTION_LIMITS)
        client.post(f"{GLOBAL_BASE}/audio/transcriptions", files={"file": ("a.wav", b"RIFF")})
        assert sent[0].url.host == "eu.openrouter.ai"

    def test_a_cell_refuses_a_host_outside_its_zone_before_anything_is_sent(self, cell, routes):
        sent: list[httpx.Request] = []
        with pytest.raises(ResidencyViolation):
            _client(sent).post("https://api.openai.com/v1/chat/completions", json={"model": "m"})
        assert sent == []
        assert routes[-1].compliant is False

    def test_revert_check_without_the_guard_the_planted_call_leaves(self, cell, monkeypatch):
        monkeypatch.setattr(openrouter, "_routed_request", lambda request: request)
        sent: list[httpx.Request] = []
        _client(sent).post("https://api.openai.com/v1/chat/completions", json={"model": "m"})
        assert sent and sent[0].url.host == "api.openai.com"


def _chat(base_url: str, sent: list[httpx.Request]) -> ChatOpenAI:
    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        body = {
            "id": "c",
            "object": "chat.completion",
            "created": 0,
            "model": "m",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        }
        return httpx.Response(200, json=body)

    llm = ChatOpenAI(
        model="m", base_url=base_url, api_key="k", http_client=httpx.Client(transport=httpx.MockTransport(handler))
    )
    return enforce_chat_request_contract(llm)


class TestTheChatContract:
    def test_flag_off_answers_and_records_where(self, no_cell):
        sent: list[httpx.Request] = []
        reply = _chat(GLOBAL_BASE, sent).invoke([HumanMessage("hi")])
        assert sent and isinstance(reply, AIMessage)
        assert reply.response_metadata["processing_route"]["processing_location"] == "US"

    def test_a_cell_answers_on_the_eu_host_and_stamps_the_generation(self, cell):
        sent: list[httpx.Request] = []
        reply = _chat(EU_BASE, sent).invoke([HumanMessage("hi")])
        assert sent[0].url.host == "eu.openrouter.ai"
        assert reply.response_metadata["processing_route"] == {
            "processing_location": "EU",
            "subprocessor": "openrouter",
            "processing_location_compliant": True,
        }

    def test_a_cell_refuses_a_chat_model_on_the_global_gateway(self, cell):
        sent: list[httpx.Request] = []
        with pytest.raises(ResidencyViolation):
            _chat(GLOBAL_BASE, sent).invoke([HumanMessage("hi")])
        assert sent == []

    def test_revert_check_without_the_guard_the_global_call_leaves(self, cell, monkeypatch):
        from agent.common import llm_factory

        monkeypatch.setattr(llm_factory, "_route", lambda llm: None)
        sent: list[httpx.Request] = []
        _chat(GLOBAL_BASE, sent).invoke([HumanMessage("hi")])
        assert sent and sent[0].url.host == "openrouter.ai"

    def test_a_streamed_reply_carries_the_route_once(self, cell):
        sent: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            sent.append(request)
            chunks = [
                {
                    "id": "c",
                    "object": "chat.completion.chunk",
                    "created": 0,
                    "model": "m",
                    "choices": [{"index": 0, "delta": {"role": "assistant", "content": text}, "finish_reason": None}],
                }
                for text in ("o", "k")
            ]
            payload = "".join(f"data: {json.dumps(chunk)}\n\n" for chunk in chunks) + "data: [DONE]\n\n"
            return httpx.Response(200, content=payload.encode(), headers={"content-type": "text/event-stream"})

        llm = enforce_chat_request_contract(
            ChatOpenAI(
                model="m",
                base_url=EU_BASE,
                api_key="k",
                http_client=httpx.Client(transport=httpx.MockTransport(handler)),
            )
        )
        merged = None
        for chunk in llm.stream([HumanMessage("hi")]):
            merged = chunk if merged is None else merged + chunk
        assert merged.response_metadata["processing_route"]["processing_location"] == "EU"


class TestTheOrganization:
    def test_a_cell_pins_zdr_whatever_the_org_switch_says(self, cell, monkeypatch):
        from agent.common import model_overrides as M

        M.reset_overrides_cache()
        monkeypatch.setattr(M, "_fetch_org_config", lambda org: ({}, False, ProcessingPolicy()))
        assert M.resolve_org_zdr_only("org_off") is True

    def test_flag_off_keeps_the_org_switch(self, no_cell, monkeypatch):
        from agent.common import model_overrides as M

        M.reset_overrides_cache()
        monkeypatch.setattr(M, "_fetch_org_config", lambda org: ({}, False, ProcessingPolicy()))
        assert M.resolve_org_zdr_only("org_off2") is False

    def test_an_org_placed_in_another_cell_is_refused(self, cell, monkeypatch):
        from agent.common import model_overrides as M

        M.reset_overrides_cache()
        elsewhere = ProcessingPolicy(residency_cell="de-de-1")
        monkeypatch.setattr(M, "_fetch_org_config", lambda org: ({}, True, elsewhere))
        with pytest.raises(ResidencyViolation):
            openrouter.data_policy_for("org_elsewhere")

    def test_an_org_placed_in_this_cell_is_served(self, cell, monkeypatch):
        from agent.common import model_overrides as M

        M.reset_overrides_cache()
        here = ProcessingPolicy(residency_cell=CELL)
        monkeypatch.setattr(M, "_fetch_org_config", lambda org: ({}, False, here))
        assert openrouter.data_policy_for("org_here") is ZERO_DATA_RETENTION

    def test_byok_on_openrouter_is_held_to_the_zone(self, cell, monkeypatch):
        from agent.common import llm_credentials

        class Reply:
            def raise_for_status(self):
                return None

            def json(self):
                return {"credential": {"id": "c", "provider": "openrouter", "baseUrl": GLOBAL_BASE, "apiKey": "k"}}

        monkeypatch.setenv("INTERNAL_API_TOKEN", "t")
        monkeypatch.setattr("httpx.get", lambda *a, **k: Reply())
        credential = llm_credentials._fetch_credential("org_byok")
        assert credential.base_url == EU_BASE


class TestPolicy:
    def test_malformed_is_the_fail_closed_policy(self):
        for payload in (None, "x", {"purposes": "service"}, {"purposes": [1]}):
            policy = residency.parse_policy(payload)
            assert policy.purposes == {"service"} and policy.known is False

    def test_service_is_always_allowed_and_unknown_purposes_drop(self):
        policy = residency.parse_policy({"purposes": ["quality_evaluation", "selling"], "residencyCell": None})
        assert policy.purposes == {"service", "quality_evaluation"}

    def test_the_judge_tag_needs_quality_evaluation(self, cell):
        metadata, tags = residency.turn_trace_metadata(ProcessingPolicy(), cell)
        assert metadata["cell"] == CELL and "quality_evaluation" in metadata["purpose_ok"]
        assert tags == [residency.QUALITY_EVALUATION_TAG]

    def test_an_unreadable_policy_is_never_judged(self):
        metadata, tags = residency.turn_trace_metadata(residency.UNREADABLE_POLICY, None)
        assert tags == [] and metadata["purpose_ok"] == "service" and metadata["cell"] == "none"

    def test_the_judge_rule_is_include_only(self):
        from agent.observability.langfuse_catalog import RULES

        conditions = RULES[0].filter
        assert {
            "type": "arrayOptions",
            "column": "tags",
            "operator": "any of",
            "value": [residency.QUALITY_EVALUATION_TAG],
        } in conditions


class TestTheBootCheck:
    def test_no_cell_boots_whatever_is_configured(self):
        assert residency.boot_errors({"LLM_BASE_URL": "https://api.openai.com/v1"}) == []

    def test_an_eu_deployment_boots(self):
        assert residency.boot_errors({residency.RESIDENCY_CELL_ENV: CELL, **EU_ENV}) == []

    def test_a_planted_non_eu_route_fails_the_boot(self):
        env = {residency.RESIDENCY_CELL_ENV: CELL, **EU_ENV, "LLM_BASE_URL": "https://api.openai.com/v1"}
        errors = residency.boot_errors(env)
        assert len(errors) == 1 and "LLM_BASE_URL" in errors[0]
        with pytest.raises(ResidencyError):
            residency.assert_residency(env)

    def test_chat_on_the_global_gateway_fails_the_boot(self):
        env = {residency.RESIDENCY_CELL_ENV: CELL, **EU_ENV, "OPENROUTER_BASE_URL": GLOBAL_BASE}
        assert any("OPENROUTER_BASE_URL" in error for error in residency.boot_errors(env))

    def test_chat_left_on_the_default_fails_the_boot(self):
        env = {residency.RESIDENCY_CELL_ENV: CELL}
        assert any("OPENROUTER_BASE_URL is unset" in error for error in residency.boot_errors(env))

    def test_a_platform_endpoint_on_the_gateway_is_rewritten_not_refused(self):
        env = {residency.RESIDENCY_CELL_ENV: CELL, "OPENROUTER_BASE_URL": EU_BASE, "EMBED_BASE_URL": GLOBAL_BASE}
        assert residency.boot_errors(env) == []

    def test_an_unknown_cell_fails_the_boot(self):
        assert residency.boot_errors({residency.RESIDENCY_CELL_ENV: "xx-yy-1"})

    def test_the_deployed_chat_models_follow_the_base_url_variable(self):
        from pathlib import Path

        import yaml

        config = Path(__file__).resolve().parents[4] / "configs" / "config_oib_openrouter.yml"
        llms = yaml.safe_load(config.read_text(encoding="utf-8"))["llms"]
        literal = [
            name
            for name, spec in llms.items()
            if "openrouter.ai" in str(spec.get("base_url", ""))
            and "${OPENROUTER_BASE_URL" not in str(spec.get("base_url"))
        ]
        assert literal == []


class TestRecording:
    def test_a_direct_generation_carries_its_route(self, cell):
        class Span:
            attributes: dict = {}

            def set_attributes(self, values):
                self.attributes = {**self.attributes, **values}

        span = Span()
        direct_trace._record_route(span, residency.route_for(EU_BASE, cell))
        assert span.attributes["langfuse.observation.metadata.processing_location"] == "EU"
        assert span.attributes["langfuse.observation.metadata.processing_location_compliant"] is True

    def test_the_generation_span_reads_its_route_from_the_response_side_only(self):
        route = {"processing_location": "EU", "subprocessor": "openrouter", "processing_location_compliant": True}
        older = {**route, "processing_location": "US"}
        metadata = {
            "chat_inputs": [{"response_metadata": {"processing_route": older}}],
            "chat_responses": [{"message": {"response_metadata": {"processing_route": route}}}],
        }
        attributes = {"nat.event_type": "LLM_END", "nat.metadata": json.dumps(metadata)}
        assert route_attributes(attributes) == {
            "langfuse.observation.metadata.processing_location": "EU",
            "langfuse.observation.metadata.subprocessor": "openrouter",
            "langfuse.observation.metadata.processing_location_compliant": True,
        }

    def test_a_span_that_is_not_a_generation_gets_nothing(self):
        assert route_attributes({"nat.event_type": "TOOL_END", "nat.metadata": "{}"}) == {}

    def test_one_score_per_distinct_route_per_trace(self, cell, monkeypatch):
        from agent.observability import langfuse_scores
        from agent.observability import turn_trace

        posted = []
        monkeypatch.setattr(turn_trace, "current_trace_id_hex", lambda: "a" * 32)
        monkeypatch.setattr(langfuse_scores, "emit_scores", lambda scores, **k: posted.extend(scores))
        residency._scored.clear()
        for _ in range(5):
            residency.record_route(residency.route_for(EU_BASE, cell))
        residency.record_route(residency.route_for(GLOBAL_BASE, cell))
        assert [(s.name, s.value, s.item) for s in posted] == [
            ("processing-location-compliant", 1, "openrouter:EU"),
            ("processing-location-compliant", 0, "openrouter:US"),
        ]


class TestTheAsyncTransport:
    """Summaries, titles, the reranker, decisions, the distiller and dictation use the limited async client."""

    def _post(self, url: str) -> list[httpx.Request]:
        import asyncio

        sent: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            sent.append(request)
            return httpx.Response(200, json={"ok": True})

        async def run() -> None:
            async with openrouter.limited_async_http_client(inner=httpx.MockTransport(handler)) as client:
                await client.post(url, json={"model": "m"})

        asyncio.run(run())
        return sent

    def test_a_cell_routes_it_into_the_eu(self, cell):
        assert self._post(f"{GLOBAL_BASE}/chat/completions")[0].url.host == "eu.openrouter.ai"

    def test_a_cell_refuses_it_outside_the_zone(self, cell):
        with pytest.raises(ResidencyViolation):
            self._post("https://api.openai.com/v1/chat/completions")

    def test_flag_off_leaves_it_alone(self, no_cell):
        assert self._post(f"{GLOBAL_BASE}/chat/completions")[0].url.host == "openrouter.ai"


class TestPlacementOnEveryPath:
    """An organization this cell may not serve is refused on the bespoke paths too, not only on chat."""

    @pytest.fixture
    def elsewhere(self, monkeypatch):
        from agent.common import model_overrides as M

        M.reset_overrides_cache()
        monkeypatch.setattr(residency, "_current_organization", lambda: "org_elsewhere")
        monkeypatch.setattr(M, "_fetch_org_config", lambda org: ({}, True, ProcessingPolicy(residency_cell="de-de-1")))

    def test_an_embedding_for_an_org_placed_elsewhere_never_leaves(self, cell, elsewhere):
        sent: list[httpx.Request] = []
        with pytest.raises(ResidencyViolation):
            _client(sent).post(f"{GLOBAL_BASE}/embeddings", json={"model": "m", "input": "x"})
        assert sent == []

    def test_an_async_call_for_an_org_placed_elsewhere_never_leaves(self, cell, elsewhere):
        with pytest.raises(ResidencyViolation):
            TestTheAsyncTransport()._post(f"{GLOBAL_BASE}/chat/completions")

    def test_an_async_chat_call_for_an_org_placed_elsewhere_never_leaves(self, cell, elsewhere):
        import asyncio

        sent: list[httpx.Request] = []
        with pytest.raises(ResidencyViolation):
            asyncio.run(_chat(EU_BASE, sent).ainvoke([HumanMessage("hi")]))
        assert sent == []

    def test_an_unreadable_placement_is_refused_inside_a_cell(self, cell, monkeypatch):
        from agent.common import model_overrides as M

        M.reset_overrides_cache()
        monkeypatch.setattr(M, "_fetch_org_config", lambda org: ({}, True, residency.UNREADABLE_POLICY))
        with pytest.raises(ResidencyViolation):
            openrouter.data_policy_for("org_unreadable")

    def test_flag_off_an_org_placed_elsewhere_is_served(self, no_cell, elsewhere):
        sent: list[httpx.Request] = []
        _client(sent).post(f"{GLOBAL_BASE}/embeddings", json={"model": "m", "input": "x"})
        assert sent

    def test_the_turn_does_not_read_a_refusal_as_a_lookup_failure(self, cell, monkeypatch):
        import asyncio

        from agent.common import request_llm_context

        def refuse():
            raise ResidencyViolation("placed elsewhere")

        monkeypatch.setattr(request_llm_context, "get_zdr_only_from_context", refuse)
        with pytest.raises(ResidencyViolation):
            asyncio.run(request_llm_context._read_zdr_only())

    def test_a_call_with_no_organization_is_pinned_inside_a_cell(self, cell):
        assert openrouter.data_policy_for(None) is ZERO_DATA_RETENTION

    def test_revert_check_without_the_placement_guard_the_embedding_leaves(self, cell, elsewhere, monkeypatch):
        monkeypatch.setattr(residency, "check_current_organization", lambda: None)
        sent: list[httpx.Request] = []
        _client(sent).post(f"{GLOBAL_BASE}/embeddings", json={"model": "m", "input": "x"})
        assert sent and sent[0].url.host == "eu.openrouter.ai"
