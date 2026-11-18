from types import SimpleNamespace

import pytest
from agent_testing.llm_factory import _resolved_through_nat

from agent.common.llm_factory import apply_openrouter_structured_defaults


class FakeLLM:
    def __init__(self, base_url="https://openrouter.ai/api/v1", extra_body=None):
        self.openai_api_base = base_url
        self.extra_body = extra_body


def test_openrouter_llm_gets_response_healing():
    llm = FakeLLM()
    apply_openrouter_structured_defaults(llm)
    assert {"id": "response-healing"} in llm.extra_body["plugins"]


def test_require_parameters_is_not_set():
    llm = FakeLLM()
    apply_openrouter_structured_defaults(llm)
    assert "provider" not in llm.extra_body


def test_is_idempotent():
    llm = FakeLLM()
    apply_openrouter_structured_defaults(llm)
    apply_openrouter_structured_defaults(llm)
    healing = [p for p in llm.extra_body["plugins"] if p.get("id") == "response-healing"]
    assert len(healing) == 1


def test_preserves_existing_extra_body():
    llm = FakeLLM(extra_body={"provider": {"order": ["A"]}, "plugins": [{"id": "web"}]})
    apply_openrouter_structured_defaults(llm)
    assert llm.extra_body["provider"] == {"order": ["A"]}
    ids = {p["id"] for p in llm.extra_body["plugins"]}
    assert ids == {"web", "response-healing"}


def test_non_openrouter_llm_is_untouched():
    llm = FakeLLM(base_url="https://llm.example.test/v1")
    apply_openrouter_structured_defaults(llm)
    assert llm.extra_body is None


def test_llm_without_extra_body_field_is_untouched():
    llm = SimpleNamespace(openai_api_base="https://openrouter.ai/api/v1")
    assert apply_openrouter_structured_defaults(llm) is llm
    assert not hasattr(llm, "extra_body")


def test_base_url_falls_back_to_client():
    llm = SimpleNamespace(
        openai_api_base=None,
        base_url=None,
        async_client=SimpleNamespace(base_url="https://openrouter.ai/api/v1"),
        extra_body=None,
    )
    apply_openrouter_structured_defaults(llm)
    assert {"id": "response-healing"} in llm.extra_body["plugins"]


@pytest.mark.asyncio
async def test_get_langchain_llm_resolves_and_hardens_the_chat_model_itself():
    from langchain_openai import ChatOpenAI

    from agent.common.model_overrides import override_model

    llm = await _resolved_through_nat(base_url="https://openrouter.ai/api/v1")

    assert isinstance(llm, ChatOpenAI)
    assert llm.extra_body["plugins"] == [{"id": "response-healing"}]
    assert "invoke" in vars(llm), "NAT's retry patch did not survive the unwrap"
    assert override_model(llm, "x-ai/grok-4.5").model_name == "x-ai/grok-4.5"


def _openrouter_chat_model(model="openai/gpt-5.6-luna", **kwargs):
    from langchain_openai import ChatOpenAI

    from agent.common.llm_factory import enforce_chat_request_contract

    llm = ChatOpenAI(
        model=model,
        api_key="test-key",  # pragma: allowlist secret
        base_url="https://openrouter.ai/api/v1",
        **kwargs,
    )
    return enforce_chat_request_contract(apply_openrouter_structured_defaults(llm))


def _sent_payload(llm, messages, **bind_kwargs):
    captured = {}
    base = type(llm).__mro__[1]
    original = base._generate

    def _capture(self, msgs, stop=None, run_manager=None, **kwargs):
        captured["payload"] = self._get_request_payload(msgs, stop=stop, **kwargs)
        raise _Captured

    base._generate = _capture
    try:
        (llm.bind(**bind_kwargs) if bind_kwargs else llm).invoke(messages)
    except _Captured:
        pass
    finally:
        base._generate = original
    return captured["payload"]


class _Captured(Exception): ...


def _messages(system="You are the agent."):
    from langchain_core.messages import HumanMessage
    from langchain_core.messages import SystemMessage

    return [SystemMessage(content=system), HumanMessage(content="Wie hoch darf die Brüstung sein?")]


DEFERRED_TOOLS = [
    {"type": "tool_search"},
    {"type": "namespace", "name": "piloti", "tools": [{"type": "function", "name": "knowledge_search"}]},
]


def test_chat_completions_payload_carries_the_cache_routing_fields():
    payload = _sent_payload(_openrouter_chat_model(), _messages(), tools=DEFERRED_TOOLS)
    extra_body = payload["extra_body"]
    assert extra_body["session_id"] == extra_body["prompt_cache_key"]
    assert extra_body["session_id"].startswith("grid-")


def test_responses_payload_carries_the_cache_routing_fields():
    llm = _openrouter_chat_model(use_responses_api=True)
    payload = _sent_payload(llm, _messages(), tools=DEFERRED_TOOLS)
    assert "input" in payload  # the Responses shape, not chat completions
    assert payload["extra_body"]["session_id"].startswith("grid-")


def test_cache_routing_does_not_displace_the_response_healing_plugin():
    payload = _sent_payload(_openrouter_chat_model(), _messages(), tools=DEFERRED_TOOLS)
    assert payload["extra_body"]["plugins"] == [{"id": "response-healing"}]


def test_usage_include_is_not_sent():
    payload = _sent_payload(_openrouter_chat_model(), _messages(), tools=DEFERRED_TOOLS)
    assert "usage" not in payload
    assert "usage" not in payload["extra_body"]


def test_a_claude_call_asks_for_caching_on_both_apis():
    for responses in (False, True):
        llm = _openrouter_chat_model(model="anthropic/claude-opus-5.5", use_responses_api=responses)
        payload = _sent_payload(llm, _messages(), tools=DEFERRED_TOOLS)
        assert payload["extra_body"]["cache_control"] == {"type": "ephemeral"}
        assert payload["extra_body"]["session_id"].startswith("grid-")


def test_an_openai_call_gets_no_cache_marker():
    payload = _sent_payload(_openrouter_chat_model(), _messages(), tools=DEFERRED_TOOLS)
    assert "cache_control" not in payload["extra_body"]


def test_provider_order_is_not_pinned():
    payload = _sent_payload(_openrouter_chat_model(), _messages(), tools=DEFERRED_TOOLS)
    assert "provider" not in payload["extra_body"]


def test_a_turns_iterations_share_one_key():
    from langchain_core.messages import AIMessage
    from langchain_core.messages import ToolMessage

    llm = _openrouter_chat_model(use_responses_api=True)
    first = _sent_payload(llm, _messages(), tools=DEFERRED_TOOLS)
    later = _sent_payload(
        llm,
        [
            *_messages(),
            AIMessage(content="", tool_calls=[{"name": "knowledge_search", "args": {}, "id": "call_1"}]),
            ToolMessage(content="a passage", tool_call_id="call_1"),
        ],
        tools=DEFERRED_TOOLS,
    )
    assert first["extra_body"]["session_id"] == later["extra_body"]["session_id"]


def test_a_different_system_prompt_gets_a_different_key():
    llm = _openrouter_chat_model()
    first = _sent_payload(llm, _messages(), tools=DEFERRED_TOOLS)
    other = _sent_payload(llm, _messages(system="Du bist der Agent."), tools=DEFERRED_TOOLS)
    assert first["extra_body"]["session_id"] != other["extra_body"]["session_id"]


def test_a_non_openrouter_model_sends_no_cache_routing():
    from langchain_openai import ChatOpenAI

    from agent.common.llm_factory import enforce_chat_request_contract

    llm = enforce_chat_request_contract(
        ChatOpenAI(
            model="gpt-5.6",
            api_key="test-key",  # pragma: allowlist secret
            base_url="https://api.openai.test/v1",
        )
    )
    payload = _sent_payload(llm, _messages())
    assert "extra_body" not in payload


def test_cache_routing_composes_with_zdr_provider_routing():
    from agent.common.model_overrides import apply_zdr_routing

    llm = apply_zdr_routing(_openrouter_chat_model())
    payload = _sent_payload(llm, _messages(), tools=DEFERRED_TOOLS)
    extra_body = payload["extra_body"]
    assert extra_body["provider"]["zdr"] is True
    assert extra_body["provider"]["data_collection"] == "deny"
    assert extra_body["provider"]["order"][0] == "azure/eu"
    assert extra_body["session_id"].startswith("grid-")
    assert extra_body["plugins"] == [{"id": "response-healing"}]


def test_a_model_override_changes_the_key():
    from agent.common.model_overrides import override_model

    llm = _openrouter_chat_model()
    before = _sent_payload(llm, _messages(), tools=DEFERRED_TOOLS)
    after = _sent_payload(override_model(llm, "anthropic/claude-sonnet-5"), _messages(), tools=DEFERRED_TOOLS)
    assert before["extra_body"]["session_id"] != after["extra_body"]["session_id"]


async def _resolved_responses_client(base_url):
    return await _resolved_through_nat(base_url=base_url, api_type="responses")


def _turn_after_a_resp_id_answer():
    from langchain_core.messages import AIMessage
    from langchain_core.messages import HumanMessage

    return [
        *_messages(),
        AIMessage(content="Einen Meter.", response_metadata={"id": "resp_abc"}),
        HumanMessage(content="Und im Dachgeschoss?"),
    ]


@pytest.mark.asyncio
async def test_openrouter_responses_client_never_sends_previous_response_id():
    llm = await _resolved_responses_client("https://openrouter.ai/api/v1")
    assert llm.use_previous_response_id is False

    payload = _sent_payload(llm, _turn_after_a_resp_id_answer())
    assert "input" in payload  # still the Responses shape, not chat completions
    assert "previous_response_id" not in payload
    assert "previous_response_id" not in payload.get("extra_body", {})


@pytest.mark.asyncio
async def test_the_whole_conversation_still_goes_without_the_server_side_handle():
    llm = await _resolved_responses_client("https://openrouter.ai/api/v1")
    payload = _sent_payload(llm, _turn_after_a_resp_id_answer())
    sent = str(payload["input"])
    assert "Brüstung" in sent
    assert "Dachgeschoss" in sent


@pytest.mark.asyncio
async def test_a_non_openrouter_responses_client_is_untouched():
    llm = await _resolved_responses_client("https://api.openai.test/v1")
    assert llm.use_previous_response_id is True

    payload = _sent_payload(llm, _turn_after_a_resp_id_answer())
    assert payload["previous_response_id"] == "resp_abc"


_STREAMED_RATE_LIMIT = (
    "ResponseError(code='rate_limit_exceeded', message='openai/gpt-6.1-sol is temporarily "
    "rate-limited upstream. Please retry shortly')"
)


@pytest.mark.asyncio
async def test_a_rate_limit_raised_inside_the_stream_is_retried():
    from langchain_core.messages import AIMessage
    from langchain_core.outputs import ChatGeneration
    from langchain_core.outputs import ChatResult

    llm = await _resolved_through_nat(base_url="https://openrouter.ai/api/v1", num_retries=2)
    base = type(llm).__mro__[1]
    original = base._agenerate
    calls = []

    async def _rate_limited_once(self, messages, stop=None, run_manager=None, **kwargs):
        calls.append(1)
        if len(calls) == 1:
            raise ValueError(_STREAMED_RATE_LIMIT)
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content="Einen Meter."))])

    base._agenerate = _rate_limited_once
    try:
        result = await llm.ainvoke(_messages())
    finally:
        base._agenerate = original

    assert result.content == "Einen Meter."
    assert len(calls) == 2


def test_the_configured_retry_messages_survive_the_merge():
    from agent.common.llm_factory import retry_messages

    assert retry_messages(["Too Many Requests", "429"]) == ["Too Many Requests", "429", "rate_limit_exceeded"]
    assert retry_messages(None) == ["rate_limit_exceeded"]
    assert retry_messages(["rate_limit_exceeded"]) == ["rate_limit_exceeded"]


_REASONING_MANDATORY_400 = (
    "Error code: 400 - {'error': {'message': 'Reasoning is mandatory for this endpoint and cannot be "
    "disabled.', 'code': 400, 'metadata': {'provider_name': None}}}"
)


def _efforts_sent(llm, monkeypatch, *, refuse=_REASONING_MANDATORY_400):
    from langchain_core.messages import AIMessage
    from langchain_core.outputs import ChatGeneration
    from langchain_core.outputs import ChatResult

    from agent.common import llm_factory

    monkeypatch.setattr(llm_factory, "_REASONING_MANDATORY", llm_factory.OrderedDict())
    sent = []

    async def _refuse_reasoning_off(self, messages, stop=None, run_manager=None, **kwargs):
        sent.append(self.reasoning_effort)
        if self.reasoning_effort == "none":
            raise ValueError(refuse)
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content='{"items": []}'))])

    monkeypatch.setattr(type(llm).__mro__[1], "_agenerate", _refuse_reasoning_off)
    return sent


async def test_a_reasoning_off_call_to_a_model_that_must_reason_is_sent_at_the_floor(monkeypatch):
    llm = _openrouter_chat_model(reasoning_effort="none")
    sent = _efforts_sent(llm, monkeypatch)

    result = await llm.bind(max_tokens=400).ainvoke(_messages())

    assert result.content == '{"items": []}'
    assert sent == ["none", "minimal"]
    assert llm.reasoning_effort == "none", "the shared instance must not be changed"


async def test_the_next_call_to_that_model_goes_to_the_floor_directly(monkeypatch):
    llm = _openrouter_chat_model(reasoning_effort="none")
    sent = _efforts_sent(llm, monkeypatch)

    await llm.ainvoke(_messages())
    await llm.ainvoke(_messages())

    assert sent == ["none", "minimal", "minimal"]


async def test_any_other_refusal_is_not_resent(monkeypatch):
    llm = _openrouter_chat_model(reasoning_effort="none")
    sent = _efforts_sent(llm, monkeypatch, refuse="Error code: 400 - context length exceeded")

    with pytest.raises(ValueError, match="context length"):
        await llm.ainvoke(_messages())
    assert sent == ["none"]
