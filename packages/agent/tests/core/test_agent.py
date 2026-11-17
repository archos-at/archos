from unittest.mock import AsyncMock
from unittest.mock import MagicMock
from unittest.mock import patch

import pytest
from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage
from langchain_core.tools import tool

from agent.citations.entries import EmptySourceRegistryError
from agent.citations.entries import SourceEntry
from agent.citations.registry import SourceRegistry
from agent.citations.session import reset_session_registry
from agent.citations.session import set_session_registry
from agent.common import LLMProvider
from agent.common import LLMRole
from agent.common.answer_envelope import render_envelope_response_format
from agent.common.brand import PRODUCT_NAME
from agent.common.data_source_registry import populate_from_config
from agent.common.data_source_registry import reset_registry
from agent.common.retrieval_rounds import assistant_checkpoint
from agent.core.agent import ChatAgent
from agent.core.models import ResearchAgentState
from tests.fixtures.drafting_turns import COMMISSION
from tests.fixtures.drafting_turns import FILE
from tests.fixtures.drafting_turns import REVISE
from tests.fixtures.drafting_turns import SEEDED_DRAFT_PATH
from tests.fixtures.drafting_turns import assert_turn_shape
from tests.fixtures.drafting_turns import draft_cards
from tests.fixtures.drafting_turns import traced_tool_name


async def _run_with_captured_registry(agent, state):
    registry = SourceRegistry()
    token = set_session_registry(registry)
    try:
        result = await agent.run(state)
    finally:
        reset_session_registry(token)
    return result, registry


async def _run_with_bound_registry(agent, state, registry):
    token = set_session_registry(registry)
    try:
        result = await agent.run(state)
    finally:
        reset_session_registry(token)
    return result


@tool(description="Search the web for information.")
def web_search_tool(query: str) -> str:
    return f"Results for: {query}"


@tool(description="Render a rich UI card alongside your answer.")
def emit_card(card_json: str) -> str:
    return f"Card will be shown with your answer: {card_json}"


@tool(description="Return the exact JSON shape for one or more card types.")
def describe_card(card_types: str) -> str:
    return f"Shapes for: {card_types}"


def _chat_prompt_source() -> str:
    from pathlib import Path

    from agent.core import agent as chat_agent

    prompts = Path(chat_agent.__file__).parent / "prompts"
    static = (prompts / "chat_static.md").read_text(encoding="utf-8")
    return static + "\n" + (prompts / "system.j2").read_text(encoding="utf-8")


def _bundled_static_block() -> str:
    from agent.core.prompt import bundled_static_block
    from agent.core.prompt import render_static_block

    return render_static_block(bundled_static_block().text)


def _bundled_prompt_text() -> str:
    from agent.core.prompt import bundled_static_block
    from agent.core.prompt import system_prompt_template

    return bundled_static_block().text + "\n" + system_prompt_template()


class TestChatAgent:
    @pytest.fixture(autouse=True)
    def _bypass_citation_pipeline(self):
        with (
            patch.object(SourceRegistry, "all_sources", return_value=[SourceEntry(url="https://example.com")]),
            patch("agent.core.answer_pipeline.verify_citations") as mock_verify,
            patch("agent.core.answer_pipeline.sanitize_report") as mock_sanitize,
        ):
            mock_verify.side_effect = lambda content, reg, reference_sources=None, **_: MagicMock(
                verified_report=content, removed_citations=[]
            )
            mock_sanitize.side_effect = lambda content: MagicMock(sanitized_report=content)
            yield

    @pytest.fixture
    def mock_llm(self):
        llm = MagicMock()
        llm.ainvoke = AsyncMock()
        llm.bind_tools = MagicMock(return_value=llm)
        llm.bind = MagicMock(return_value=llm)
        return llm

    @pytest.fixture
    def mock_llm_provider(self, mock_llm):
        provider = MagicMock(spec=LLMProvider)
        provider.get = MagicMock(return_value=mock_llm)
        return provider

    @pytest.fixture
    def real_tool(self):
        return web_search_tool

    def test_init_with_defaults(self, mock_llm_provider, real_tool):
        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[real_tool],
        )

        assert agent.llm_provider == mock_llm_provider
        assert len(agent.tools) == 1
        assert agent.tool_iteration_ceiling == 5
        assert agent.max_tool_iterations == 5
        assert agent.callbacks == []
        assert agent.system_prompt is not None

    def test_init_with_custom_prompt(self, mock_llm_provider, real_tool):
        custom_system = "Custom system prompt"
        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[real_tool],
            system_prompt=custom_system,
        )
        assert agent.system_prompt == custom_system

    def test_init_with_custom_limits(self, mock_llm_provider, real_tool):
        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[real_tool],
            max_tool_iterations=3,
        )

        assert agent.max_tool_iterations == 3
        assert agent.tool_iteration_ceiling == 3

    def test_init_with_callbacks(self, mock_llm_provider, real_tool):
        callbacks = [MagicMock()]
        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[real_tool],
            callbacks=callbacks,
        )

        assert agent.callbacks == callbacks

    def test_init_with_empty_tools(self, mock_llm_provider):
        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[],
        )

        assert agent.tools == []
        assert agent.tools_info == []

    def test_build_tools_info(self, mock_llm_provider, real_tool):
        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[real_tool],
        )

        assert len(agent.tools_info) == 1
        assert agent.tools_info[0]["name"] == "web_search_tool"
        assert "Search the web" in agent.tools_info[0]["description"]

    def test_get_llm(self, mock_llm_provider, mock_llm, real_tool):
        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[real_tool],
        )

        result = agent._get_llm()

        mock_llm_provider.get.assert_called_with(LLMRole.RESEARCHER)
        assert result == mock_llm

    def test_graph_property(self, mock_llm_provider, real_tool):
        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[real_tool],
        )

        assert agent.graph is not None
        assert agent.graph == agent._graph

    @pytest.mark.asyncio
    async def test_run_basic_query(self, mock_llm_provider, mock_llm, real_tool):
        agent_response = AIMessage(content="CUDA is a parallel computing platform.")
        mock_llm.ainvoke = AsyncMock(return_value=agent_response)

        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[real_tool],
        )

        state = ResearchAgentState(messages=[HumanMessage(content="What is CUDA?")])

        result = await agent.run(state)

        assert result is not None
        assert result.messages is not None

    @pytest.mark.asyncio
    async def test_run_with_callbacks(self, mock_llm_provider, mock_llm, real_tool):
        agent_response = AIMessage(content="Answer")
        mock_llm.ainvoke = AsyncMock(return_value=agent_response)

        mock_callback = MagicMock()
        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[real_tool],
            callbacks=[mock_callback],
        )

        state = ResearchAgentState(messages=[HumanMessage(content="Test")])

        await agent.run(state)

    @pytest.mark.asyncio
    async def test_run_extracts_and_strips_control_markers(self, mock_llm_provider, mock_llm, real_tool):
        from langchain_core.callbacks import BaseCallbackHandler

        agent_response = AIMessage(content="The answer body.\n[CONFIDENCE:high]\n[ESCALATE_TO_DEEP]")
        mock_llm.ainvoke = AsyncMock(return_value=agent_response)

        class _EmitCallback(BaseCallbackHandler):
            def __init__(self):
                self.reports = []

            def emit_final_report(self, content):
                self.reports.append(content)

        emit_callback = _EmitCallback()
        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[real_tool],
            callbacks=[emit_callback],
        )

        state = ResearchAgentState(messages=[HumanMessage(content="Frage?")])
        result = await agent.run(state)

        assert len(emit_callback.reports) == 1
        emitted = emit_callback.reports[0]
        assert "[CONFIDENCE" not in emitted
        assert "[ESCALATE_TO_DEEP]" not in emitted

        final_content = result.messages[-1].content
        assert "[CONFIDENCE" not in final_content
        assert "[ESCALATE_TO_DEEP]" not in final_content

        assert result.escalation_requested is True
        assert result.answer_confidence_marker == "high"

    @pytest.mark.asyncio
    async def test_run_without_markers_sets_neutral_structured_signals(self, mock_llm_provider, mock_llm, real_tool):
        mock_llm.ainvoke = AsyncMock(return_value=AIMessage(content="A clean grounded answer [1]."))
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[real_tool])

        result = await agent.run(ResearchAgentState(messages=[HumanMessage(content="Frage?")]))

        assert result.escalation_requested is False
        assert result.answer_confidence_marker is None

    @pytest.mark.asyncio
    async def test_run_flattens_list_shaped_answer_content(self, mock_llm_provider, mock_llm, real_tool):
        agent_response = AIMessage(
            content=[
                {"type": "text", "text": "The flattened answer body [1]."},
                {"type": "text", "text": "[CONFIDENCE:high]"},
            ]
        )
        mock_llm.ainvoke = AsyncMock(return_value=agent_response)
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[real_tool])

        result = await agent.run(ResearchAgentState(messages=[HumanMessage(content="Frage?")]))

        final_content = result.messages[-1].content
        assert "The flattened answer body" in final_content
        assert "'type'" not in final_content
        assert not final_content.startswith("[{")
        assert "[CONFIDENCE" not in final_content
        assert result.answer_confidence_marker == "high"

    @staticmethod
    def _envelope_reply(*, fenced: bool = True, **overrides):
        import json as _json

        prose = (
            "Die erforderliche Geländerhöhe für die Terrasse beträgt 100 cm, weil die "
            "Absturzhöhe unter 12 m liegt [1]. "
            + "Die Höhe wird vom fertigen Fußboden bis zur Oberkante der Umwehrung gemessen. "
            * 10
        )
        envelope = {
            "answer": prose + "\n\n## References\n- [1] https://example.com",
            "verdict": {
                "value": "100 cm",
                "subject": "Erforderliche Geländerhöhe",
                "reference": {"document": "OIB-Richtlinie 4", "section": "Punkt 2.1.1"},
            },
            "takeaways": [
                {"text": "Unter 12 m Absturzhöhe genügen 100 cm."},
                {"text": "Gemessen wird ab fertigem Fußboden.", "detail": "Aufkantungen zählen mit."},
            ],
            "callout": {"kind": "warning", "text": "Ab 12 m Absturzhöhe sind 110 cm erforderlich."},
            "confidence": {"level": "medium", "reason": "eine Fundstelle, nicht am Projekt gemessen"},
            "summary": "Die Terrasse ist damit ohne erhöhte Umwehrung einreichbar; Aufkantungen beim Aufmaß mitzählen.",
        }
        envelope.update(overrides)
        body = _json.dumps(envelope, ensure_ascii=False)
        return f"```answer_json\n{body}\n```" if fenced else body

    @pytest.mark.asyncio
    async def test_run_consumes_a_full_answer_envelope(self, mock_llm_provider, mock_llm, real_tool):
        from langchain_core.callbacks import BaseCallbackHandler

        mock_llm.ainvoke = AsyncMock(return_value=AIMessage(content=self._envelope_reply()))

        class _EmitCallback(BaseCallbackHandler):
            def __init__(self):
                self.reports = []

            def emit_final_report(self, content):
                self.reports.append(content)

        emit_callback = _EmitCallback()
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[real_tool], callbacks=[emit_callback])

        result = await agent.run(ResearchAgentState(messages=[HumanMessage(content="Geländerhöhe Terrasse?")]))

        final_content = result.messages[-1].content
        assert "Die erforderliche Geländerhöhe für die Terrasse beträgt 100 cm" in final_content
        assert "```" not in final_content
        assert '"verdict"' not in final_content
        emitted = emit_callback.reports[-1]
        assert "```" not in emitted
        assert '"confidence"' not in emitted

        assert result.escalation_requested is False
        assert result.answer_confidence_marker == "medium"
        assert result.answer_confidence_marker_reason == "eine Fundstelle, nicht am Projekt gemessen"

        assert result.answer_meta is not None
        assert result.answer_meta["v"] == 1
        assert result.answer_meta["verdict"]["value"] == "100 cm"
        assert result.answer_meta["summary"].startswith("Die Terrasse ist damit")
        assert result.answer_meta["verdict"]["reference"]["document"] == "OIB-Richtlinie 4"
        assert len(result.answer_meta["takeaways"]) == 2
        assert result.answer_meta["callout"]["kind"] == "warning"

    @pytest.mark.asyncio
    async def test_run_accepts_the_bare_object_json_mode_produces(self, mock_llm_provider, mock_llm, real_tool):
        mock_llm.ainvoke = AsyncMock(return_value=AIMessage(content=self._envelope_reply(fenced=False)))
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[real_tool])

        result = await agent.run(ResearchAgentState(messages=[HumanMessage(content="Frage?")]))

        final_content = result.messages[-1].content
        assert "Die erforderliche Geländerhöhe für die Terrasse beträgt 100 cm" in final_content
        assert not final_content.strip().startswith("{")
        assert result.answer_confidence_marker == "medium"
        assert result.answer_meta is not None and result.answer_meta["verdict"]["value"] == "100 cm"

    @pytest.mark.asyncio
    async def test_run_keeps_one_placed_callout_marker(self, mock_llm_provider, mock_llm, real_tool):
        prose = (
            "Die erforderliche Geländerhöhe beträgt 100 cm [1].\n\n"
            "[[callout]]\n\n"
            "Weitere Erläuterung.\n\n[[callout]]\n\n"
            "## References\n- [1] https://example.com"
        )
        mock_llm.ainvoke = AsyncMock(return_value=AIMessage(content=self._envelope_reply(answer=prose)))
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[real_tool])

        result = await agent.run(ResearchAgentState(messages=[HumanMessage(content="Frage?")]))

        final_content = result.messages[-1].content
        assert final_content.count("[[callout]]") == 1
        assert result.answer_meta is not None and result.answer_meta["callout"]["kind"] == "warning"

    @pytest.mark.asyncio
    async def test_run_strips_the_marker_when_no_callout_survived(self, mock_llm_provider, mock_llm, real_tool):
        prose = "Die Antwort [1].\n\n[[callout]]\n\nMehr Text.\n\n## References\n- [1] https://example.com"
        mock_llm.ainvoke = AsyncMock(return_value=AIMessage(content=self._envelope_reply(answer=prose, callout=None)))
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[real_tool])

        result = await agent.run(ResearchAgentState(messages=[HumanMessage(content="Frage?")]))

        assert "[[callout]]" not in result.messages[-1].content

    @pytest.mark.asyncio
    async def test_run_envelope_escalation_discards_the_anatomy(self, mock_llm_provider, mock_llm, real_tool):
        mock_llm.ainvoke = AsyncMock(return_value=AIMessage(content=self._envelope_reply(escalate_to_deep=True)))
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[real_tool])

        result = await agent.run(ResearchAgentState(messages=[HumanMessage(content="Frage?")]))

        assert result.escalation_requested is True
        assert result.answer_meta is None
        assert result.answer_confidence_marker == "medium"

    def _bindable(self, mock_llm, reply):
        bound = MagicMock()
        bound.ainvoke = AsyncMock(return_value=AIMessage(content=reply))
        mock_llm.bind = MagicMock(return_value=bound)
        return bound

    @pytest.mark.asyncio
    async def test_forced_synthesis_keeps_the_tools_and_asks_for_no_call(self, mock_llm_provider, mock_llm, real_tool):
        bound = self._bindable(mock_llm, self._envelope_reply())
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[real_tool], max_tool_iterations=0)

        result = await agent.run(ResearchAgentState(messages=[HumanMessage(content="Frage?")]))

        mock_llm.bind_tools.assert_called()
        mock_llm.bind.assert_called_once_with(tool_choice="none")
        bound.ainvoke.assert_awaited_once()
        assert result.answer_confidence_marker == "medium"
        assert "```" not in result.messages[-1].content

    @pytest.mark.asyncio
    async def test_synthesis_binds_json_mode_only_where_the_rounds_did(self, mock_llm_provider, mock_llm, real_tool):
        bound = self._bindable(mock_llm, self._envelope_reply(fenced=False))
        bound.bind = MagicMock(return_value=bound)
        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[real_tool],
            max_tool_iterations=0,
            envelope_json_mode_with_tools=True,
        )

        result = await agent.run(ResearchAgentState(messages=[HumanMessage(content="Frage?")]))

        mock_llm.bind.assert_called_once_with(tool_choice="none")
        bound.bind.assert_called_once_with(response_format=render_envelope_response_format())
        assert result.answer_confidence_marker == "medium"

    @pytest.mark.asyncio
    async def test_a_provider_that_ignores_tool_choice_gets_the_tool_free_call(
        self, mock_llm_provider, mock_llm, real_tool
    ):
        bound = self._bindable(mock_llm, "")
        ignored = AIMessage(content="", tool_calls=[{"name": "knowledge_search", "args": {}, "id": "c1"}])
        bound.ainvoke = AsyncMock(side_effect=[ignored, AIMessage(content=self._envelope_reply(fenced=False))])
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[real_tool], max_tool_iterations=0)

        result = await agent.run(ResearchAgentState(messages=[HumanMessage(content="Frage?")]))

        kinds = [next(iter(call.kwargs)) for call in mock_llm.bind.call_args_list]
        assert kinds == ["tool_choice", "response_format"]
        assert not getattr(result.messages[-1], "tool_calls", None)
        assert result.answer_confidence_marker == "medium"

    @pytest.mark.asyncio
    async def test_a_malformed_tool_call_at_synthesis_is_not_taken_for_the_answer(
        self, mock_llm_provider, mock_llm, real_tool
    ):
        bound = self._bindable(mock_llm, "")
        malformed = AIMessage(
            content="",
            invalid_tool_calls=[{"name": "knowledge_search", "args": "{", "id": "c1", "error": "bad json"}],
        )
        bound.ainvoke = AsyncMock(side_effect=[malformed, AIMessage(content=self._envelope_reply(fenced=False))])
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[real_tool], max_tool_iterations=0)

        result = await agent.run(ResearchAgentState(messages=[HumanMessage(content="Frage?")]))

        kinds = [next(iter(call.kwargs)) for call in mock_llm.bind.call_args_list]
        assert kinds == ["tool_choice", "response_format"]
        assert result.answer_confidence_marker == "medium"

    @pytest.mark.asyncio
    async def test_a_provider_that_rejects_tool_choice_gets_the_tool_free_call(
        self, mock_llm_provider, mock_llm, real_tool
    ):
        rejected = RuntimeError("tool_choice not supported")
        rejected.status_code = 400
        bound = self._bindable(mock_llm, "")
        bound.ainvoke = AsyncMock(side_effect=[rejected, AIMessage(content=self._envelope_reply(fenced=False))])
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[real_tool], max_tool_iterations=0)

        result = await agent.run(ResearchAgentState(messages=[HumanMessage(content="Frage?")]))

        kinds = [next(iter(call.kwargs)) for call in mock_llm.bind.call_args_list]
        assert kinds == ["tool_choice", "response_format"]
        assert result.answer_confidence_marker == "medium"

    @pytest.mark.asyncio
    async def test_a_transport_error_is_not_retried_down_the_ladder(self, mock_llm_provider, mock_llm, real_tool):
        bound = self._bindable(mock_llm, "")
        bound.bind = MagicMock(return_value=bound)
        bound.ainvoke = AsyncMock(side_effect=ConnectionError("upstream reset"))
        mock_llm.ainvoke = AsyncMock(return_value=AIMessage(content=self._envelope_reply()))
        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[real_tool],
            max_tool_iterations=0,
            envelope_json_mode_with_tools=True,
        )

        with pytest.raises(ConnectionError):
            await agent.run(ResearchAgentState(messages=[HumanMessage(content="Frage?")]))

        assert bound.bind.call_count == 1
        mock_llm.ainvoke.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_tool_bound_iterations_bind_json_mode_only_by_opt_in(self, mock_llm_provider, mock_llm, real_tool):
        mock_llm.bind = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=AIMessage(content=self._envelope_reply()))
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[real_tool])

        await agent.run(ResearchAgentState(messages=[HumanMessage(content="Frage?")]))
        mock_llm.bind.assert_not_called()

        bound = self._bindable(mock_llm, self._envelope_reply())
        opted_in = ChatAgent(llm_provider=mock_llm_provider, tools=[real_tool], envelope_json_mode_with_tools=True)
        result = await opted_in.run(ResearchAgentState(messages=[HumanMessage(content="Frage?")]))

        mock_llm.bind.assert_called_once_with(response_format=render_envelope_response_format())
        bound.ainvoke.assert_awaited_once()
        assert result.answer_confidence_marker == "medium"

    @pytest.mark.asyncio
    async def test_run_with_user_info(self, mock_llm_provider, mock_llm, real_tool):
        agent_response = AIMessage(content="Personalized answer")
        mock_llm.ainvoke = AsyncMock(return_value=agent_response)

        custom_prompt = "You are an assistant. User: {{ user_info }}."
        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[real_tool],
            system_prompt=custom_prompt,
        )

        state = ResearchAgentState(
            messages=[HumanMessage(content="Test query")],
            user_info={"name": "John", "role": "developer"},
        )

        result = await agent.run(state)

        assert result is not None

    @pytest.mark.asyncio
    async def test_run_with_tools_info_in_state(self, mock_llm_provider, mock_llm, real_tool):
        agent_response = AIMessage(content="Answer")
        mock_llm.ainvoke = AsyncMock(return_value=agent_response)

        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[real_tool],
        )

        custom_tools_info = [
            {"name": "custom_tool", "description": "A custom tool"},
        ]

        state = ResearchAgentState(
            messages=[HumanMessage(content="Test query")],
            tools_info=custom_tools_info,
        )

        result = await agent.run(state)

        assert result is not None

    def test_a_missing_prompt_is_a_boot_failure(self, mock_llm_provider, real_tool):
        from agent.common.prompt_utils import PromptError
        from agent.core import prompt as prompt_module

        prompt_module.system_prompt_template.cache_clear()
        try:
            with (
                patch.object(prompt_module, "load_prompt", side_effect=PromptError("system.j2 missing")),
                pytest.raises(PromptError),
            ):
                ChatAgent(llm_provider=mock_llm_provider, tools=[real_tool])
        finally:
            prompt_module.system_prompt_template.cache_clear()

    def test_the_prompt_template_is_read_once_per_process(self, mock_llm_provider, real_tool):
        from agent.core import prompt as prompt_module

        prompt_module.system_prompt_template.cache_clear()
        try:
            with patch.object(prompt_module, "load_prompt", wraps=prompt_module.load_prompt) as reads:
                first = ChatAgent(llm_provider=mock_llm_provider, tools=[real_tool])
                second = ChatAgent(llm_provider=mock_llm_provider, tools=[real_tool])
        finally:
            prompt_module.system_prompt_template.cache_clear()

        template_reads = [c for c in reads.call_args_list if c.args[1] == prompt_module.PROMPT_NAME]
        assert len(template_reads) == 1
        assert first.system_prompt is second.system_prompt

    def test_default_prompt_requires_tool_result_references(self, mock_llm_provider, real_tool):
        ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[real_tool],
        )

        assert "a result with neither URL nor key is cited by the tool's name" in _bundled_prompt_text()
        assert "exactly as the tool returned it" in _bundled_prompt_text()

    def test_default_prompt_matches_user_language(self, mock_llm_provider, real_tool):
        ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[real_tool],
        )

        text = _bundled_prompt_text()
        assert "Write in the language of the person's newest message, not of the turn context or files" in text
        assert "language of the request" not in text
        assert "German is Austrian technical German" in text

    def test_an_english_question_is_answered_in_english_in_the_examples(self, mock_llm_provider, real_tool):
        import re

        ChatAgent(llm_provider=mock_llm_provider, tools=[real_tool])
        examples = re.findall(r"<example type=\"[a-z]+\">\nUser: (.*?)\n(.*?)</example>", _bundled_prompt_text(), re.S)
        english = [body for question, body in examples if question.startswith(("What ", "How ", "Which "))]

        assert english, "no example asks in English"
        assert all("**References:**" in body and "**Quellen:**" not in body for body in english)

    def test_default_prompt_names_profile_facts_in_words(self, mock_llm_provider, real_tool):
        ChatAgent(llm_provider=mock_llm_provider, tools=[real_tool])

        assert "Name a fact in words, never as its key" in _bundled_prompt_text()

    def test_default_prompt_keeps_escalate_marker_language_independent(self, mock_llm_provider, real_tool):
        ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[real_tool],
        )

        assert "contract tokens: write them exactly, whatever the answer's language" in _bundled_prompt_text()
        assert "[ESCALATE_TO_DEEP]" not in _bundled_prompt_text()

    def _render_default_prompt(
        self,
        mock_llm_provider,
        real_tool,
        *,
        project_context: str | None = None,
    ) -> str:
        from agent.common import render_prompt_template

        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[real_tool])
        return (
            _bundled_static_block()
            + "\n"
            + render_prompt_template(
                agent.system_prompt,
                user_info=None,
                current_datetime="2026-07-15",
                available_documents=[],
                project_context=project_context,
            )
        )

    def test_the_formatting_block_routes_a_diagram_to_a_drawing_card(self, mock_llm_provider, real_tool):
        rendered = self._render_default_prompt(mock_llm_provider, real_tool)
        formatting = rendered.split("<formatting>")[1].split("</formatting>")[0]
        assert "```mermaid" in formatting
        assert "not only when asked" in formatting
        assert "`:::procedure`" in formatting and "`:::cases`" in formatting
        assert "schematic card" in formatting
        assert "are never a drawing" in formatting
        assert "flowchart TD" in formatting
        assert "reach the reader as a listing" in formatting
        assert "│" in formatting

    def test_project_memory_is_framed_as_fallible_not_binding(self, mock_llm_provider, real_tool):
        rendered = self._render_default_prompt(
            mock_llm_provider,
            real_tool,
            project_context=(
                "PROJECT_MEMORY v1\n"
                '- [derived_fact | high | unverified] "Für Bergsteiggasse ist OIB-RL 2.1 nicht anwendbar"'
            ),
        )

        assert "neither a confirmed fact nor law" in rendered
        assert "The current conversation outranks it" in rendered
        assert "never argue the person out of their own correction" in rendered
        assert "never a source for a legal requirement" in rendered
        without = self._render_default_prompt(mock_llm_provider, real_tool, project_context="name: X")
        assert "PROJECT_MEMORY" not in without

    def test_research_turn_prompt_keeps_the_envelope_mandate(self, mock_llm_provider, real_tool):
        rendered = self._render_default_prompt(mock_llm_provider, real_tool)

        assert "<answer_envelope>" in rendered
        assert "Every researched answer carries `confidence`" in rendered
        assert "answer*: string" in rendered
        assert "escalate_to_deep" in rendered
        assert "classified as conversational / meta" not in rendered

    def test_the_confidence_marker_does_not_depend_on_having_sources(self, mock_llm_provider, real_tool):
        rendered = self._render_default_prompt(mock_llm_provider, real_tool)

        assert "every answer that retrieved, measured or cites" in rendered
        assert "a measurement taken this turn" in rendered
        assert "a record or a measurement never stands in for one" in rendered
        assert "An answer that cites nothing still carries it" in rendered
        assert "there is no confidence chip" in rendered

    @pytest.mark.asyncio
    async def test_tool_iterations_incremented_on_tool_calls(self, mock_llm_provider, mock_llm, real_tool):
        tool_call_response = AIMessage(
            content="",
            tool_calls=[{"name": "web_search_tool", "args": {"query": "test"}, "id": "1"}],
        )
        final_response = AIMessage(content="Final answer")
        mock_llm.ainvoke = AsyncMock(side_effect=[tool_call_response, final_response])

        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[real_tool],
        )

        state = ResearchAgentState(
            messages=[HumanMessage(content="Test query")],
            tool_iterations=0,
        )

        result = await agent.run(state)

        assert result.tool_iterations >= 1

    @pytest.mark.asyncio
    async def test_forced_synthesis_at_max_iterations(self, mock_llm_provider, mock_llm, real_tool):
        final_response = AIMessage(content="Forced synthesis response")
        mock_llm.ainvoke = AsyncMock(return_value=final_response)

        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[real_tool],
            max_tool_iterations=3,
        )

        state = ResearchAgentState(
            messages=[HumanMessage(content="Test query")],
            tool_iterations=3,
        )

        result = await agent.run(state)

        assert result is not None
        mock_llm.ainvoke.assert_called()

    @pytest.mark.asyncio
    async def test_a_round_of_cards_costs_one_round(self, mock_llm_provider, mock_llm, real_tool):
        search_round = AIMessage(
            content="",
            tool_calls=[{"name": "web_search_tool", "args": {"query": "test"}, "id": "1"}],
        )
        card_round = AIMessage(
            content="",
            tool_calls=[
                {"name": "describe_card", "args": {"card_types": "verdict_header,typed_table"}, "id": "2"},
                {"name": "emit_card", "args": {"card_json": "{}"}, "id": "3"},
                {"name": "emit_card", "args": {"card_json": "{}"}, "id": "4"},
            ],
        )
        mock_llm.ainvoke = AsyncMock(side_effect=[search_round, card_round, AIMessage(content="Final answer")])

        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[real_tool, emit_card, describe_card],
            max_tool_iterations=3,
        )

        result = await agent.run(ResearchAgentState(messages=[HumanMessage(content="Test query")]))

        assert result.tool_iterations == 2
        assert result.research_truncated is None
        assert sum(1 for message in result.messages if getattr(message, "name", None) == "emit_card") == 2

    def test_state_has_tool_iterations_field(self):
        state = ResearchAgentState(messages=[HumanMessage(content="Test")])
        assert hasattr(state, "tool_iterations")
        assert state.tool_iterations == 0

    def test_state_tool_iterations_default_value(self):
        state = ResearchAgentState(messages=[HumanMessage(content="Test")])
        assert state.tool_iterations == 0

    def test_state_tool_iterations_can_be_set(self):
        state = ResearchAgentState(
            messages=[HumanMessage(content="Test")],
            tool_iterations=5,
        )
        assert state.tool_iterations == 5

    @pytest.mark.asyncio
    async def test_run_returns_updated_tool_iterations(self, mock_llm_provider, mock_llm, real_tool):
        agent_response = AIMessage(content="Answer")
        mock_llm.ainvoke = AsyncMock(return_value=agent_response)

        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[real_tool],
        )

        state = ResearchAgentState(
            messages=[HumanMessage(content="Test")],
            tool_iterations=0,
        )

        result = await agent.run(state)

        assert hasattr(result, "tool_iterations")

    @pytest.mark.asyncio
    async def test_forced_synthesis_adds_instruction_message(self, mock_llm_provider, mock_llm, real_tool):
        captured_messages = []

        async def capture_messages(messages):
            captured_messages.append(messages)
            return AIMessage(content="Synthesized response")

        mock_llm.ainvoke = AsyncMock(side_effect=capture_messages)

        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[real_tool],
            max_tool_iterations=2,
        )

        state = ResearchAgentState(
            messages=[HumanMessage(content="Test query")],
            tool_iterations=2,
        )

        await agent.run(state)

        last_call_messages = captured_messages[0]
        synthesis_instruction_found = any(
            "research limit" in str(msg.content).lower() for msg in last_call_messages if hasattr(msg, "content")
        )
        assert synthesis_instruction_found


@tool(description="Search the web and return results with URLs.")
def web_search_with_urls(query: str) -> str:
    return (
        '<Document href="https://docs.nvidia.com/cuda/">\n'
        "<title>\nCUDA Toolkit Documentation\n</title>\n"
        "CUDA is a parallel computing platform.\n"
        "</Document>"
    )


@tool(description="Get the current time for a timezone.")
def mcp_time__get_current_time(timezone: str = "UTC") -> str:
    return "2026-05-11T14:30:00+09:00"


@tool(description="Get current observed weather conditions.")
def weather_observation_tool(location: str) -> str:
    return f"Current conditions for {location}: clear, 68F"


@tool(description="Search the web (returns no results).")
def empty_web_search_tool(query: str) -> str:
    return ""


@tool(description="Look into the office's other projects (a search that matched nothing).")
def project_lookup(action: str, query: str = "") -> str:
    return "Treffer aus anderen Projekten: 0 Passage(n) aus 0 Projekt(en); 7 von 7 Projekten durchsucht."


@tool(description="Durably save a user preference, decision, or project fact.")
def remember_tool(fact: str) -> str:
    return f"Saved: {fact}"


_SPY_SEARCH_EXECUTIONS: list[str] = []


@tool(description="Search the web (spy: records every actual execution).")
def spy_search_tool(query: str) -> str:
    _SPY_SEARCH_EXECUTIONS.append(query)
    return f"Results for: {query}"


class TestChatSourceRegistryGating:
    @pytest.fixture(autouse=True)
    def _reset_data_source_registry(self):
        reset_registry()
        yield
        reset_registry()

    @pytest.fixture
    def mock_llm(self):
        llm = MagicMock()
        llm.ainvoke = AsyncMock()
        llm.bind_tools = MagicMock(return_value=llm)
        llm.bind = MagicMock(return_value=llm)
        return llm

    @pytest.fixture
    def mock_llm_provider(self, mock_llm):
        provider = MagicMock(spec=LLMProvider)
        provider.get = MagicMock(return_value=mock_llm)
        return provider

    @pytest.mark.asyncio
    async def test_explicit_tool_not_declared_as_data_source_is_not_captured(self, mock_llm_provider, mock_llm):
        tool_call_response = AIMessage(
            content="",
            tool_calls=[{"name": "mcp_time__get_current_time", "args": {"timezone": "Asia/Tokyo"}, "id": "1"}],
        )
        final_response = AIMessage(
            content=("The current time was returned by the MCP tool.\n\n## Sources\n[1] mcp_time__get_current_time")
        )
        mock_llm.ainvoke = AsyncMock(side_effect=[tool_call_response, final_response])

        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[mcp_time__get_current_time],
        )

        state = ResearchAgentState(messages=[HumanMessage(content="What time is it in Tokyo?")])
        result = await agent.run(state)

        assert result.verified_sources is None
        assert "current time" in result.messages[-1].content

    @pytest.mark.asyncio
    async def test_an_answer_that_looked_nothing_up_is_returned_as_is(self, mock_llm_provider, mock_llm):
        final_response = AIMessage(content="Your project **test 1** is a Neubau, Beherbergung, GK3 building.")
        mock_llm.ainvoke = AsyncMock(side_effect=[final_response])

        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[mcp_time__get_current_time],
        )

        state = ResearchAgentState(
            messages=[HumanMessage(content="what do you know about my project")],
        )
        result = await agent.run(state)

        assert result.verified_sources is None
        assert "test 1" in result.messages[-1].content
        assert result.source_lookup_attempted is False

    @pytest.mark.asyncio
    async def test_a_greeting_keeps_the_full_binding(self, mock_llm_provider, mock_llm):
        populate_from_config(
            [
                {
                    "id": "web_search",
                    "name": "Web Search",
                    "description": "Search the web.",
                    "tools": ["empty_web_search_tool"],
                }
            ],
        )
        final_response = AIMessage(content="Hallo! Bei mir läuft alles super.")
        mock_llm.ainvoke = AsyncMock(side_effect=[final_response])

        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[empty_web_search_tool, remember_tool],
        )
        bound_at_construction = {getattr(t, "name", t) for t in mock_llm.bind_tools.call_args.args[0]}
        assert bound_at_construction == {"empty_web_search_tool", "remember_tool"}
        mock_llm.bind_tools.reset_mock()

        state = ResearchAgentState(messages=[HumanMessage(content="wie läufts so")])
        result = await agent.run(state)

        assert mock_llm.bind_tools.call_count == 0
        assert "läuft alles super" in result.messages[-1].content
        assert result.source_lookup_attempted is False

    @pytest.mark.asyncio
    async def test_a_search_the_model_calls_on_a_greeting_executes(self, mock_llm_provider, mock_llm):
        _SPY_SEARCH_EXECUTIONS.clear()
        populate_from_config(
            [
                {
                    "id": "web_search",
                    "name": "Web Search",
                    "description": "Search the web.",
                    "tools": ["spy_search_tool"],
                }
            ],
        )
        search_call = AIMessage(
            content="",
            tool_calls=[{"name": "spy_search_tool", "args": {"query": "wie läufts so"}, "id": "1"}],
        )
        final_response = AIMessage(content="Hallo! Bei mir läuft alles super.")
        mock_llm.ainvoke = AsyncMock(side_effect=[search_call, final_response])

        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[spy_search_tool, remember_tool],
            repair_pass=False,
        )

        state = ResearchAgentState(messages=[HumanMessage(content="wie läufts so")])
        result = await agent.run(state)

        assert _SPY_SEARCH_EXECUTIONS == ["wie läufts so"]
        assert "läuft alles super" in result.messages[-1].content
        assert result.source_lookup_attempted is True

    @pytest.mark.asyncio
    async def test_research_turn_hallucinated_search_call_executes(self, mock_llm_provider, mock_llm):
        _SPY_SEARCH_EXECUTIONS.clear()
        populate_from_config(
            [
                {
                    "id": "web_search",
                    "name": "Web Search",
                    "description": "Search the web.",
                    "tools": ["spy_search_tool"],
                }
            ],
        )
        search_call = AIMessage(
            content="",
            tool_calls=[{"name": "spy_search_tool", "args": {"query": "OIB 2.2"}, "id": "1"}],
        )
        final_response = AIMessage(content="Answer [1].\n\n**References:**\n- [1] Results for: OIB 2.2")
        mock_llm.ainvoke = AsyncMock(side_effect=[search_call, final_response])

        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[spy_search_tool, remember_tool],
            repair_pass=False,
        )

        state = ResearchAgentState(
            messages=[HumanMessage(content="Which OIB Richtlinie applies?")],
        )
        await _run_with_captured_registry(agent, state)

        assert _SPY_SEARCH_EXECUTIONS == ["OIB 2.2"]

    @pytest.mark.asyncio
    async def test_research_turn_keeps_search_tools_bound(self, mock_llm_provider, mock_llm):
        populate_from_config(
            [
                {
                    "id": "web_search",
                    "name": "Web Search",
                    "description": "Search the web.",
                    "tools": ["empty_web_search_tool"],
                }
            ],
        )
        final_response = AIMessage(content="Answer from context.")
        mock_llm.ainvoke = AsyncMock(side_effect=[final_response])

        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[empty_web_search_tool, remember_tool],
        )
        mock_llm.bind_tools.reset_mock()

        state = ResearchAgentState(
            messages=[HumanMessage(content="Which OIB Richtlinie applies to high-rise buildings?")],
        )
        await agent.run(state)

        assert mock_llm.bind_tools.call_count == 0

    @pytest.mark.asyncio
    async def test_a_failed_lookup_ships_the_answer_labelled_as_model_knowledge(self, mock_llm_provider, mock_llm):
        populate_from_config(
            [
                {
                    "id": "web_search",
                    "name": "Web Search",
                    "description": "Search the web.",
                    "tools": ["empty_web_search_tool"],
                }
            ],
        )
        tool_call_response = AIMessage(
            content="",
            tool_calls=[{"name": "empty_web_search_tool", "args": {"query": "OIB 2.2"}, "id": "1"}],
        )
        final_response = AIMessage(content="Hochhäuser regelt die OIB-RL 2.3 [1].\n\n## Quellen\n- [1] oib-rl_2.3.pdf")
        mock_llm.ainvoke = AsyncMock(side_effect=[tool_call_response, final_response])

        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[empty_web_search_tool],
        )

        state = ResearchAgentState(
            messages=[HumanMessage(content="Which OIB Richtlinie applies to high-rise buildings?")],
        )
        result = await agent.run(state)

        assert result.answer_lookup_found_nothing is True
        assert result.messages[-1].content == "Hochhäuser regelt die OIB-RL 2.3."
        assert result.verified_sources is None

    @pytest.mark.asyncio
    async def test_a_ruling_whose_lookup_found_nothing_is_still_refused(self, mock_llm_provider, mock_llm):
        populate_from_config(
            [{"id": "web_search", "name": "Web Search", "description": "Web.", "tools": ["empty_web_search_tool"]}],
        )
        ruling = '```answer_json\n{"kind": "ruling", "answer": "Die Fluchtweglänge beträgt 40 m."}\n```'
        mock_llm.ainvoke = AsyncMock(
            side_effect=[
                AIMessage(
                    content="",
                    tool_calls=[{"name": "empty_web_search_tool", "args": {"query": "Fluchtweg GK 4"}, "id": "1"}],
                ),
                AIMessage(content=ruling),
            ]
        )
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[empty_web_search_tool])

        with pytest.raises(EmptySourceRegistryError):
            await agent.run(ResearchAgentState(messages=[HumanMessage(content="Wie lang darf der Fluchtweg sein?")]))

    @pytest.mark.asyncio
    async def test_a_lookup_in_other_projects_that_found_nothing_keeps_its_honest_answer(
        self, mock_llm_provider, mock_llm
    ):
        populate_from_config(
            [{"id": "knowledge_layer", "name": "Knowledge", "description": "Projects.", "tools": ["project_lookup"]}],
        )
        honest = "Eine Tiefgarage mit über 100 Stellplätzen hatten wir in keinem Referenzprojekt."
        mock_llm.ainvoke = AsyncMock(
            side_effect=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {"name": "project_lookup", "args": {"action": "search", "query": "Tiefgarage"}, "id": "1"}
                    ],
                ),
                AIMessage(content=honest),
            ]
        )
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[project_lookup])

        result = await agent.run(
            ResearchAgentState(
                messages=[HumanMessage(content="Hatten wir schon eine Tiefgarage mit über 100 Stellplätzen?")]
            )
        )

        assert honest in result.messages[-1].content

    @pytest.mark.asyncio
    async def test_an_empty_passage_search_beside_a_record_lookup_is_flagged(self, mock_llm_provider, mock_llm):
        populate_from_config(
            [
                {"id": "knowledge_layer", "name": "Knowledge", "description": "Projects.", "tools": ["project_lookup"]},
                {"id": "web_search", "name": "Web Search", "description": "Web.", "tools": ["empty_web_search_tool"]},
            ],
        )
        mock_llm.ainvoke = AsyncMock(
            side_effect=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {"name": "project_lookup", "args": {"action": "search", "query": "Tiefgarage"}, "id": "1"},
                        {"name": "empty_web_search_tool", "args": {"query": "OIB-RL 2.2 Garage"}, "id": "2"},
                    ],
                ),
                AIMessage(content="Die OIB-RL 2.2 verlangt …"),
            ]
        )
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[project_lookup, empty_web_search_tool])

        result = await agent.run(
            ResearchAgentState(messages=[HumanMessage(content="Was verlangt die OIB für Garagen?")])
        )

        assert result.answer_lookup_found_nothing is True

    @pytest.mark.asyncio
    async def test_research_turn_answered_from_context_returns_answer(self, mock_llm_provider, mock_llm):
        final_response = AIMessage(content="To fill in hohe_gebaeude_details I need the exact building height.")
        mock_llm.ainvoke = AsyncMock(side_effect=[final_response])

        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[mcp_time__get_current_time],
        )

        state = ResearchAgentState(
            messages=[HumanMessage(content="what do you need to know to fill that in?")],
        )
        result = await agent.run(state)

        assert result.verified_sources is None
        assert "building height" in result.messages[-1].content

    @pytest.mark.asyncio
    async def test_registered_group_tool_without_urls_is_captured(self, mock_llm_provider, mock_llm):
        populate_from_config(
            [
                {
                    "id": "mcp_time",
                    "name": "MCP Time",
                    "description": "Get current time and timezone information through MCP.",
                    "tools": ["mcp_time"],
                }
            ],
            group_names={"mcp_time"},
        )
        tool_call_response = AIMessage(
            content="",
            tool_calls=[{"name": "mcp_time__get_current_time", "args": {"timezone": "Asia/Tokyo"}, "id": "1"}],
        )
        final_response = AIMessage(
            content=("The current time was returned by the MCP tool.\n\n## Sources\n[1] mcp_time__get_current_time")
        )
        mock_llm.ainvoke = AsyncMock(side_effect=[tool_call_response, final_response])

        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[mcp_time__get_current_time],
        )

        state = ResearchAgentState(messages=[HumanMessage(content="What time is it in Tokyo?")])
        result, registry = await _run_with_captured_registry(agent, state)

        sources = registry.all_sources()
        assert len(sources) == 1
        assert sources[0].citation_key == "mcp_time__get_current_time"
        assert sources[0].source_type == "tool_result"
        assert result.messages[-1].content.rstrip().endswith("[1] mcp_time__get_current_time")

    @pytest.mark.asyncio
    async def test_a_source_the_model_did_not_cite_is_never_appended(self, mock_llm_provider, mock_llm):
        populate_from_config(
            [
                {
                    "id": "mcp_time",
                    "name": "MCP Time",
                    "description": "Get current time and timezone information through MCP.",
                    "tools": ["mcp_time"],
                }
            ],
            group_names={"mcp_time"},
        )
        tool_call_response = AIMessage(
            content="",
            tool_calls=[{"name": "mcp_time__get_current_time", "args": {"timezone": "Asia/Tokyo"}, "id": "1"}],
        )
        final_response = AIMessage(content="It's currently 4:54 AM in Tokyo.")
        mock_llm.ainvoke = AsyncMock(side_effect=[tool_call_response, final_response])

        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[mcp_time__get_current_time],
        )

        state = ResearchAgentState(messages=[HumanMessage(content="What time is it in Tokyo?")])
        result = await agent.run(state)

        assert result.messages[-1].content.rstrip() == "It's currently 4:54 AM in Tokyo."
        assert result.verified_sources is None
        assert result.answer_citation_grounded is False

    @pytest.mark.asyncio
    async def test_missing_citation_fallback_skips_ambiguous_multi_source_registry(self, mock_llm_provider, mock_llm):
        populate_from_config(
            [
                {
                    "id": "mcp_time",
                    "name": "MCP Time",
                    "description": "Get current time and timezone information through MCP.",
                    "tools": ["mcp_time"],
                },
                {
                    "id": "web_search",
                    "name": "Web Search",
                    "description": "Search the web for real-time information.",
                    "tools": ["web_search_with_urls"],
                },
            ],
            group_names={"mcp_time"},
        )
        tool_call_response = AIMessage(
            content="",
            tool_calls=[
                {"name": "mcp_time__get_current_time", "args": {"timezone": "Asia/Tokyo"}, "id": "1"},
                {"name": "web_search_with_urls", "args": {"query": "CUDA"}, "id": "2"},
            ],
        )
        final_response = AIMessage(content="CUDA is a parallel computing platform.")
        mock_llm.ainvoke = AsyncMock(side_effect=[tool_call_response, final_response])

        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[mcp_time__get_current_time, web_search_with_urls],
        )

        state = ResearchAgentState(messages=[HumanMessage(content="What is CUDA? Also note the time.")])
        result, registry = await _run_with_captured_registry(agent, state)

        sources = registry.all_sources()
        assert len(sources) >= 2
        assert sources[0].citation_key == "mcp_time__get_current_time"
        assert any(source.url == "https://docs.nvidia.com/cuda/" for source in sources)
        assert result.messages[-1].content == "CUDA is a parallel computing platform."

    @pytest.mark.asyncio
    async def test_registered_exact_data_source_tool_without_urls_is_captured(self, mock_llm_provider, mock_llm):
        populate_from_config(
            [
                {
                    "id": "weather_observations",
                    "name": "Weather Observations",
                    "description": "Current observed weather conditions.",
                    "tools": ["weather_observation_tool"],
                }
            ]
        )
        tool_call_response = AIMessage(
            content="",
            tool_calls=[{"name": "weather_observation_tool", "args": {"location": "San Francisco"}, "id": "1"}],
        )
        final_response = AIMessage(content="The weather is clear.\n\n## Sources\n[1] weather_observation_tool")
        mock_llm.ainvoke = AsyncMock(side_effect=[tool_call_response, final_response])

        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[weather_observation_tool],
        )

        state = ResearchAgentState(messages=[HumanMessage(content="What is the weather in San Francisco?")])
        result, registry = await _run_with_captured_registry(agent, state)

        sources = registry.all_sources()
        assert len(sources) == 1
        assert sources[0].citation_key == "weather_observation_tool"
        assert sources[0].source_type == "tool_result"
        assert result.messages[-1].content.rstrip().endswith("[1] weather_observation_tool")


class TestChatSourceCaptureIntegration:
    @pytest.fixture
    def mock_llm(self):
        llm = MagicMock()
        llm.ainvoke = AsyncMock()
        llm.bind_tools = MagicMock(return_value=llm)
        llm.bind = MagicMock(return_value=llm)
        return llm

    @pytest.fixture
    def mock_llm_provider(self, mock_llm):
        provider = MagicMock(spec=LLMProvider)
        provider.get = MagicMock(return_value=mock_llm)
        return provider

    @pytest.fixture(autouse=True)
    def _register_web_search_source(self):
        reset_registry()
        populate_from_config(
            [
                {
                    "id": "web_search",
                    "name": "Web Search",
                    "description": "Search the web for real-time information.",
                    "tools": ["web_search_with_urls"],
                }
            ]
        )
        yield
        reset_registry()

    @pytest.mark.asyncio
    async def test_source_registry_populated_from_tool_call(self, mock_llm_provider, mock_llm):
        tool_call_response = AIMessage(
            content="",
            tool_calls=[{"name": "web_search_with_urls", "args": {"query": "CUDA"}, "id": "1"}],
        )
        final_response = AIMessage(
            content=(
                "CUDA is a parallel computing platform.\n\n"
                "## Sources\n"
                "[1] CUDA Toolkit Documentation: https://docs.nvidia.com/cuda/"
            )
        )
        mock_llm.ainvoke = AsyncMock(side_effect=[tool_call_response, final_response])

        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[web_search_with_urls],
        )

        state = ResearchAgentState(messages=[HumanMessage(content="What is CUDA?")])
        result, registry = await _run_with_captured_registry(agent, state)

        sources = registry.all_sources()
        assert len(sources) >= 1
        assert any(s.url == "https://docs.nvidia.com/cuda/" for s in sources)

        assert result.messages[-1].content

    @pytest.mark.asyncio
    async def test_invalid_citation_removed_end_to_end(self, mock_llm_provider, mock_llm):
        tool_call_response = AIMessage(
            content="",
            tool_calls=[{"name": "web_search_with_urls", "args": {"query": "CUDA"}, "id": "1"}],
        )
        final_response = AIMessage(
            content=(
                "CUDA is great [1]. Also see this [2].\n\n"
                "## Sources\n"
                "[1] CUDA Docs: https://docs.nvidia.com/cuda/\n"
                "[2] Fake Source: https://totally-fabricated.example.com/fake"
            )
        )
        mock_llm.ainvoke = AsyncMock(side_effect=[tool_call_response, final_response])

        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[web_search_with_urls],
        )

        state = ResearchAgentState(messages=[HumanMessage(content="What is CUDA?")])
        result = await agent.run(state)

        output = result.messages[-1].content
        assert "totally-fabricated.example.com" not in output
        assert "docs.nvidia.com/cuda" in output


class TestChatSessionRegistry:
    @pytest.fixture
    def mock_llm(self):
        llm = MagicMock()
        llm.ainvoke = AsyncMock()
        llm.bind_tools = MagicMock(return_value=llm)
        llm.bind = MagicMock(return_value=llm)
        return llm

    @pytest.fixture
    def mock_llm_provider(self, mock_llm):
        provider = MagicMock(spec=LLMProvider)
        provider.get = MagicMock(return_value=mock_llm)
        return provider

    @pytest.mark.asyncio
    async def test_run_uses_session_registry_when_set(self, mock_llm_provider, mock_llm):
        from agent.citations.session import set_session_registry

        session_reg = SourceRegistry()
        session_reg.add(SourceEntry(url="https://prior-turn.example.com/article"))

        agent_response = AIMessage(
            content=(
                "Answer based on prior context [1].\n\n"
                "## Sources\n"
                "[1] Prior Article: https://prior-turn.example.com/article"
            )
        )
        mock_llm.ainvoke = AsyncMock(return_value=agent_response)

        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[web_search_tool],
        )

        set_session_registry(session_reg)
        try:
            state = ResearchAgentState(messages=[HumanMessage(content="Follow-up question")])
            result = await agent.run(state)
            assert result is not None
            assert "prior-turn.example.com/article" in result.messages[-1].content
        finally:
            set_session_registry(None)

    @pytest.mark.asyncio
    async def test_standalone_runs_never_share_a_registry(self, mock_llm_provider, mock_llm):
        from agent.citations.session import set_session_registry

        set_session_registry(None)  # Ensure no session registry
        populate_from_config(
            [
                {
                    "id": "web_search",
                    "name": "Web Search",
                    "description": "Search the web.",
                    "tools": ["web_search_with_urls"],
                }
            ]
        )
        try:
            mock_llm.ainvoke = AsyncMock(
                side_effect=[
                    AIMessage(
                        content="", tool_calls=[{"name": "web_search_with_urls", "args": {"query": "q"}, "id": "1"}]
                    ),
                    AIMessage(content="Grounded [1].\n\n## Sources\n[1] https://docs.nvidia.com/cuda/"),
                    AIMessage(content="Answer without sources"),
                ]
            )
            agent = ChatAgent(llm_provider=mock_llm_provider, tools=[web_search_with_urls])

            first = await agent.run(ResearchAgentState(messages=[HumanMessage(content="Q1")]))
            second = await agent.run(ResearchAgentState(messages=[HumanMessage(content="Q2")]))
        finally:
            reset_registry()

        assert first.answer_citation_grounded is True
        assert "docs.nvidia.com" not in second.messages[-1].content
        assert second.verified_sources is None

    @pytest.mark.asyncio
    async def test_the_session_registry_is_left_bound_after_the_run(self, mock_llm_provider, mock_llm):
        from agent.citations.session import get_session_registry
        from agent.citations.session import set_session_registry

        session_reg = SourceRegistry()
        session_reg.add(SourceEntry(url="https://session.example.com/doc"))

        agent_response = AIMessage(content=("Answer [1].\n\n## Sources\n[1] Doc: https://session.example.com/doc"))
        mock_llm.ainvoke = AsyncMock(return_value=agent_response)

        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[web_search_tool],
        )

        set_session_registry(session_reg)
        try:
            state = ResearchAgentState(messages=[HumanMessage(content="Q")])
            result = await agent.run(state)
            assert get_session_registry() is session_reg
            assert result.answer_citation_grounded is True
        finally:
            set_session_registry(None)


class TestChatAnswerGrounding:
    @pytest.fixture(autouse=True)
    def _reset_data_source_registry(self):
        reset_registry()
        yield
        reset_registry()

    @staticmethod
    def _after_a_lookup(mock_llm, answer: str, *, query: str = "q") -> None:
        populate_from_config(
            [{"id": "web_search", "name": "Web Search", "description": "Search the web.", "tools": ["web_search_tool"]}]
        )
        mock_llm.ainvoke = AsyncMock(
            side_effect=[
                AIMessage(content="", tool_calls=[{"name": "web_search_tool", "args": {"query": query}, "id": "1"}]),
                AIMessage(content=answer),
            ]
        )

    @pytest.fixture
    def mock_llm(self):
        llm = MagicMock()
        llm.ainvoke = AsyncMock()
        llm.bind_tools = MagicMock(return_value=llm)
        llm.bind = MagicMock(return_value=llm)
        return llm

    @pytest.fixture
    def mock_llm_provider(self, mock_llm):
        provider = MagicMock(spec=LLMProvider)
        provider.get = MagicMock(return_value=mock_llm)
        return provider

    def _agent(self, provider, **kwargs):
        return ChatAgent(llm_provider=provider, tools=[web_search_tool], **kwargs)

    @pytest.mark.asyncio
    async def test_grounded_when_verification_keeps_valid_citation(self, mock_llm_provider, mock_llm):
        mock_llm.ainvoke.return_value = AIMessage(content="OIB-Richtlinie 2 regelt Brandschutz [1].")
        source = SourceEntry(url="https://example.com/a", title="A", tool_name="web_search_tool")
        with (
            patch.object(SourceRegistry, "all_sources", return_value=[source]),
            patch("agent.core.answer_pipeline.verify_citations") as mock_verify,
        ):
            mock_verify.return_value = MagicMock(
                verified_report="OIB-Richtlinie 2 regelt Brandschutz [1].",
                valid_citations=[{"number": 1, "url": "https://example.com/a", "citation_key": None, "line": "[1]"}],
                removed_citations=[],
            )
            state = ResearchAgentState(messages=[HumanMessage(content="Brandschutz?")])
            result, _ = await _run_with_captured_registry(self._agent(mock_llm_provider), state)
        assert result.answer_citation_grounded is True

    @pytest.mark.asyncio
    async def test_not_grounded_when_no_citation_survives_beside_a_lone_source(self, mock_llm_provider, mock_llm):
        self._after_a_lookup(mock_llm, "Answer without any citation.")
        source = SourceEntry(url="https://example.com/a", title="A", tool_name="web_search_tool")
        with (
            patch.object(SourceRegistry, "all_sources", return_value=[source]),
            patch("agent.core.answer_pipeline.verify_citations") as mock_verify,
        ):
            mock_verify.return_value = MagicMock(
                verified_report="Answer without any citation.",
                valid_citations=[],
                removed_citations=[{"number": 1, "line": "[1]", "reason": "unverifiable"}],
            )
            state = ResearchAgentState(messages=[HumanMessage(content="Q?")])
            result, _ = await _run_with_captured_registry(self._agent(mock_llm_provider, repair_pass=False), state)
        assert result.answer_citation_grounded is False

    @pytest.mark.asyncio
    async def test_not_grounded_when_all_citations_removed_and_many_sources(self, mock_llm_provider, mock_llm):
        mock_llm.ainvoke.return_value = AIMessage(content="Answer [1][2].")
        sources = [
            SourceEntry(url="https://example.com/a", title="A", tool_name="web_search_tool"),
            SourceEntry(url="https://example.com/b", title="B", tool_name="web_search_tool"),
        ]
        with (
            patch.object(SourceRegistry, "all_sources", return_value=sources),
            patch("agent.core.answer_pipeline.verify_citations") as mock_verify,
        ):
            mock_verify.return_value = MagicMock(
                verified_report="Answer.",
                valid_citations=[],
                removed_citations=["[1]", "[2]"],
            )
            state = ResearchAgentState(messages=[HumanMessage(content="Q?")])
            result, _ = await _run_with_captured_registry(self._agent(mock_llm_provider), state)
        assert result.answer_citation_grounded is False

    @pytest.mark.asyncio
    async def test_not_grounded_when_registry_empty_and_nothing_was_looked_up(self, mock_llm_provider, mock_llm):
        mock_llm.ainvoke.return_value = AIMessage(content="Hallo! Wie kann ich helfen?")
        state = ResearchAgentState(
            messages=[HumanMessage(content="Hi")],
        )
        result, _ = await _run_with_captured_registry(self._agent(mock_llm_provider), state)
        assert result.answer_citation_grounded is False

    @pytest.mark.asyncio
    async def test_an_unresolvable_citation_is_labelled_not_replaced(self, mock_llm_provider, mock_llm):
        self._after_a_lookup(mock_llm, "The building height limit is 12 m [1].")
        source = SourceEntry(url="https://example.gv.at/oib", title="OIB Richtlinie", tool_name="web_search_tool")
        with patch.object(SourceRegistry, "all_sources", return_value=[source]):
            state = ResearchAgentState(messages=[HumanMessage(content="What is the height limit?")])
            result, _ = await _run_with_captured_registry(self._agent(mock_llm_provider, repair_pass=False), state)

        answer = next(m for m in reversed(result.messages) if isinstance(m, AIMessage) and not m.tool_calls)
        assert answer.content == "The building height limit is 12 m."
        assert "OIB Richtlinie" not in answer.content
        assert result.answer_citation_grounded is False

    @pytest.mark.asyncio
    async def test_verified_sources_empty_when_answer_cites_nothing(self, mock_llm_provider, mock_llm):
        mock_llm.ainvoke.return_value = AIMessage(content="Hallo! Wie kann ich helfen?")
        registry = SourceRegistry()
        registry.add(
            SourceEntry(
                url="https://ris.bka.gv.at/prev",
                title="Prior RIS source",
                tool_name="ris_search",
            )
        )
        with patch("agent.core.answer_pipeline.verify_citations") as mock_verify:
            mock_verify.return_value = MagicMock(
                verified_report="Hallo! Wie kann ich helfen?",
                valid_citations=[],
                removed_citations=[],
            )
            state = ResearchAgentState(messages=[HumanMessage(content="hallo wie gehts")])
            registry.add(
                SourceEntry(
                    url="https://ris.bka.gv.at/prev2",
                    title="Prior RIS source 2",
                    tool_name="ris_search",
                )
            )
            result = await _run_with_bound_registry(self._agent(mock_llm_provider), state, registry)
        assert result.verified_sources is None

    @pytest.mark.asyncio
    async def test_verified_sources_only_the_one_cited_of_many(self, mock_llm_provider, mock_llm):
        mock_llm.ainvoke.return_value = AIMessage(content="Antwort [1].")
        registry = SourceRegistry()
        cited = SourceEntry(url="https://example.com/b", title="B", tool_name="web_search_tool")
        registry.add(SourceEntry(url="https://example.com/a", title="A", tool_name="web_search_tool"))
        registry.add(cited)
        registry.add(SourceEntry(url="https://example.com/c", title="C", tool_name="web_search_tool"))
        with patch("agent.core.answer_pipeline.verify_citations") as mock_verify:
            mock_verify.return_value = MagicMock(
                verified_report="Antwort [1].",
                valid_citations=[{"number": 1, "url": "https://example.com/b", "citation_key": None, "line": "[1]"}],
                removed_citations=[],
            )
            state = ResearchAgentState(messages=[HumanMessage(content="Frage?")])
            result = await _run_with_bound_registry(self._agent(mock_llm_provider), state, registry)
        assert result.verified_sources is not None
        assert [s["url"] for s in result.verified_sources] == ["https://example.com/b"]

    @pytest.mark.asyncio
    async def test_verified_sources_citation_key_resolves(self, mock_llm_provider, mock_llm):
        mock_llm.ainvoke.return_value = AIMessage(content="Antwort [1].")
        registry = SourceRegistry()
        registry.add(SourceEntry(url="https://example.com/a", title="A", tool_name="web_search_tool"))
        registry.add(SourceEntry(citation_key="oib-richtlinie-2.pdf#p3", title="OIB 2", tool_name="kb_search"))
        with patch("agent.core.answer_pipeline.verify_citations") as mock_verify:
            mock_verify.return_value = MagicMock(
                verified_report="Antwort [1].",
                valid_citations=[
                    {
                        "number": 1,
                        "url": None,
                        "citation_key": "oib-richtlinie-2.pdf#p3",
                        "line": "[1]",
                    }
                ],
                removed_citations=[],
            )
            state = ResearchAgentState(messages=[HumanMessage(content="Frage?")])
            result = await _run_with_bound_registry(self._agent(mock_llm_provider), state, registry)
        assert result.verified_sources is not None
        assert [s["citation_key"] for s in result.verified_sources] == ["oib-richtlinie-2.pdf#p3"]

    @pytest.mark.asyncio
    async def test_a_lone_registry_source_is_not_emitted_when_nothing_was_cited(self, mock_llm_provider, mock_llm):
        self._after_a_lookup(mock_llm, "Answer without any citation.", query="https://example.com/only")
        registry = SourceRegistry()
        only = SourceEntry(url="https://example.com/only", title="Only", tool_name="web_search_tool")
        registry.add(only)
        with patch("agent.core.answer_pipeline.verify_citations") as mock_verify:
            mock_verify.return_value = MagicMock(
                verified_report="Answer without any citation.",
                valid_citations=[],
                removed_citations=[{"number": 1, "line": "[1]", "reason": "unverifiable"}],
            )
            state = ResearchAgentState(messages=[HumanMessage(content="Q?")])
            result = await _run_with_bound_registry(self._agent(mock_llm_provider, repair_pass=False), state, registry)
        assert result.verified_sources is None

    @pytest.mark.asyncio
    async def test_verified_sources_empty_when_a_greeting_cites_nothing_from_a_populated_registry(
        self, mock_llm_provider, mock_llm
    ):
        mock_llm.ainvoke.return_value = AIMessage(content="Hallo! Wie kann ich helfen?")
        registry = SourceRegistry()
        registry.add(SourceEntry(url="https://ris.bka.gv.at/prev", title="Prior RIS", tool_name="ris_search"))
        state = ResearchAgentState(
            messages=[HumanMessage(content="Hi")],
        )
        result = await _run_with_bound_registry(self._agent(mock_llm_provider), state, registry)
        assert result.verified_sources is None

    @pytest.mark.asyncio
    async def test_verified_sources_carry_their_citation_number(self, mock_llm_provider, mock_llm):
        mock_llm.ainvoke.return_value = AIMessage(content="Antwort [1][2].")
        registry = SourceRegistry()
        registry.add(SourceEntry(url="https://example.com/a", title="A", tool_name="web_search_tool"))
        registry.add(SourceEntry(citation_key="oib-rl_4.pdf, p.9", title="OIB 4", tool_name="kb_search"))
        with patch("agent.core.answer_pipeline.verify_citations") as mock_verify:
            mock_verify.return_value = MagicMock(
                verified_report="Antwort [1][2].",
                valid_citations=[
                    {"number": 1, "url": "https://example.com/a", "citation_key": None, "line": "[1]"},
                    {"number": 2, "url": None, "citation_key": "oib-rl_4.pdf, p.9", "line": "[2]"},
                ],
                removed_citations=[],
            )
            state = ResearchAgentState(messages=[HumanMessage(content="Frage?")])
            result = await _run_with_bound_registry(self._agent(mock_llm_provider), state, registry)
        assert [s["number"] for s in result.verified_sources] == [1, 2]

    @pytest.mark.asyncio
    async def test_citation_numbers_survive_the_sanitize_renumber(self, mock_llm_provider, mock_llm):
        answer = (
            "Erfunden [1]. Belegt [2].\n\n"
            "**References:**\n"
            "- [1] Fake - https://not-in-registry.example/x\n"
            "- [2] Real - https://example.com/real\n"
        )
        mock_llm.ainvoke.return_value = AIMessage(content=answer)
        registry = SourceRegistry()
        registry.add(SourceEntry(url="https://example.com/real", title="Real", tool_name="web_search_tool"))

        state = ResearchAgentState(messages=[HumanMessage(content="Frage?")])
        result = await _run_with_bound_registry(self._agent(mock_llm_provider), state, registry)

        final_text = result.messages[-1].content
        assert "[2]" not in final_text  # the gap was closed
        assert "Belegt [1]" in final_text
        assert [s["number"] for s in result.verified_sources] == [1]
        assert [s["url"] for s in result.verified_sources] == ["https://example.com/real"]

    @pytest.mark.asyncio
    async def test_citations_removed_populated_when_verification_drops_citations(self, mock_llm_provider, mock_llm):
        mock_llm.ainvoke.return_value = AIMessage(content="Antwort [1].")
        source = SourceEntry(url="https://example.com/a", title="A", tool_name="web_search_tool")
        with (
            patch.object(SourceRegistry, "all_sources", return_value=[source]),
            patch("agent.core.answer_pipeline.verify_citations") as mock_verify,
        ):
            mock_verify.return_value = MagicMock(
                verified_report="Antwort [1].",
                valid_citations=[{"number": 1, "url": "https://example.com/a", "citation_key": None, "line": "[1]"}],
                removed_citations=[
                    {"number": 2, "line": "[2] Bad: https://nope.example.com", "reason": "url_not_in_registry"},
                    {"number": 3, "line": "[3] Also bad", "reason": "url_not_in_registry"},
                    {"number": 4, "line": "[4] Mystery", "reason": "unverifiable"},
                ],
            )
            state = ResearchAgentState(messages=[HumanMessage(content="Frage?")])
            result, _ = await _run_with_captured_registry(self._agent(mock_llm_provider), state)
        assert result.citations_removed == {
            "count": 3,
            "reasons": ["url_not_in_registry", "unverifiable"],
        }

    @pytest.mark.asyncio
    async def test_citations_removed_absent_when_nothing_removed(self, mock_llm_provider, mock_llm):
        mock_llm.ainvoke.return_value = AIMessage(content="Antwort [1].")
        source = SourceEntry(url="https://example.com/a", title="A", tool_name="web_search_tool")
        with (
            patch.object(SourceRegistry, "all_sources", return_value=[source]),
            patch("agent.core.answer_pipeline.verify_citations") as mock_verify,
        ):
            mock_verify.return_value = MagicMock(
                verified_report="Antwort [1].",
                valid_citations=[{"number": 1, "url": "https://example.com/a", "citation_key": None, "line": "[1]"}],
                removed_citations=[],
            )
            state = ResearchAgentState(messages=[HumanMessage(content="Frage?")])
            result, _ = await _run_with_captured_registry(self._agent(mock_llm_provider), state)
        assert result.citations_removed is None

    @pytest.mark.asyncio
    async def test_citations_removed_absent_on_a_greeting_without_verification(self, mock_llm_provider, mock_llm):
        mock_llm.ainvoke.return_value = AIMessage(content="Hallo! Wie kann ich helfen?")
        state = ResearchAgentState(
            messages=[HumanMessage(content="Hi")],
        )
        result, _ = await _run_with_captured_registry(self._agent(mock_llm_provider), state)
        assert result.citations_removed is None


@tool(description="Search the internal knowledge base (returns KB-format results).")
def knowledge_search(query: str) -> str:
    return (
        "Found 1 relevant document(s):\n\n"
        "--- Result 1 ---\n"
        "Source: OIB-330.pdf\n"
        "Collection: oib_knowledge\n"
        "Page: 12\n"
        "Citation: OIB-330.pdf, p.12\n"
        "Content Type: text\n"
        "Relevance Score: 0.88\n"
        "\n"
        "Die lichte Durchgangshoehe von Treppen muss mindestens 2,10 m betragen.\n"
        "\n"
        "## Trace-Lanes\n"
        '{"lanes":[]}\n'
    )


class TestChatQuoteVerification:
    @pytest.fixture
    def mock_llm(self):
        llm = MagicMock()
        llm.ainvoke = AsyncMock()
        llm.bind_tools = MagicMock(return_value=llm)
        llm.bind = MagicMock(return_value=llm)
        return llm

    @pytest.fixture
    def mock_llm_provider(self, mock_llm):
        provider = MagicMock(spec=LLMProvider)
        provider.get = MagicMock(return_value=mock_llm)
        return provider

    @pytest.fixture(autouse=True)
    def _register_kb_source(self):
        reset_registry()
        populate_from_config(
            [
                {
                    "id": "oib_knowledge",
                    "name": "OIB Knowledge",
                    "description": "Search the internal OIB knowledge base.",
                    "tools": ["knowledge_search"],
                }
            ]
        )
        yield
        reset_registry()

    def _tool_call(self):
        return AIMessage(
            content="",
            tool_calls=[{"name": "knowledge_search", "args": {"query": "Treppe"}, "id": "1"}],
        )

    @pytest.mark.asyncio
    async def test_fabricated_quote_kept_unmarked_and_flagged(self, mock_llm_provider, mock_llm):
        final = AIMessage(
            content=(
                "Die Richtlinie fordert „Treppen muessen mit einer automatischen "
                'Loeschanlage ausgestattet sein" [1].\n\n'
                "## Sources\n[1] OIB-330.pdf, p.12"
            )
        )
        mock_llm.ainvoke = AsyncMock(side_effect=[self._tool_call(), final])
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[knowledge_search])
        state = ResearchAgentState(messages=[HumanMessage(content="Treppenhoehe?")])
        result = await _run_with_bound_registry(agent, state, SourceRegistry())

        output = result.messages[-1].content
        assert "[nicht wörtlich in der Quelle belegt]" not in output
        assert "automatische" in output.lower()
        assert result.answer_quotes_verified is False

    @pytest.mark.asyncio
    async def test_verbatim_quote_not_annotated_and_verified(self, mock_llm_provider, mock_llm):
        final = AIMessage(
            content=(
                "Es gilt: „Die lichte Durchgangshoehe von Treppen muss mindestens "
                '2,10 m betragen" [1].\n\n## Sources\n[1] OIB-330.pdf, p.12'
            )
        )
        mock_llm.ainvoke = AsyncMock(side_effect=[self._tool_call(), final])
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[knowledge_search])
        state = ResearchAgentState(messages=[HumanMessage(content="Treppenhoehe?")])
        result = await _run_with_bound_registry(agent, state, SourceRegistry())

        output = result.messages[-1].content
        assert "[nicht wörtlich in der Quelle belegt]" not in output
        assert result.answer_quotes_verified is True

    def test_state_defaults_quotes_verified_true(self):
        state = ResearchAgentState(messages=[HumanMessage(content="hi")])
        assert state.answer_quotes_verified is True


class TestChatRepairPass:
    @pytest.fixture
    def mock_llm(self):
        llm = MagicMock()
        llm.ainvoke = AsyncMock()
        llm.bind_tools = MagicMock(return_value=llm)
        llm.bind = MagicMock(return_value=llm)
        return llm

    @pytest.fixture
    def mock_llm_provider(self, mock_llm):
        provider = MagicMock(spec=LLMProvider)
        provider.get = MagicMock(return_value=mock_llm)
        return provider

    @pytest.fixture(autouse=True)
    def _register_kb_source(self):
        reset_registry()
        populate_from_config(
            [
                {
                    "id": "oib_knowledge",
                    "name": "OIB Knowledge",
                    "description": "Search the internal OIB knowledge base.",
                    "tools": ["knowledge_search"],
                }
            ]
        )
        yield
        reset_registry()

    def _tool_call(self):
        return AIMessage(
            content="",
            tool_calls=[{"name": "knowledge_search", "args": {"query": "Treppe"}, "id": "1"}],
        )

    FABRICATED = AIMessage(
        content=(
            "Die Richtlinie fordert „Treppen muessen mit einer automatischen "
            'Loeschanlage ausgestattet sein" [1].\n\n'
            "## Sources\n[1] OIB-330.pdf, p.12"
        )
    )
    VERBATIM = AIMessage(
        content=(
            "Es gilt: „Die lichte Durchgangshoehe von Treppen muss mindestens "
            '2,10 m betragen" [1].\n\n## Sources\n[1] OIB-330.pdf, p.12'
        )
    )

    MISQUOTED = AIMessage(
        content=(
            "Vorweg: Treppen sind Fluchtwege. Es gilt: „Die lichte Durchgangshoehe bei Treppen muss "
            'wenigstens 2,10 m betragen" [1]. Danach folgt die Breite.\n\n## Sources\n[1] OIB-330.pdf, p.12'
        )
    )

    @pytest.fixture
    def patch_llm(self):
        llm = MagicMock()
        llm.ainvoke = AsyncMock(
            return_value=AIMessage(content="Die lichte Durchgangshoehe von Treppen muss mindestens 2,10 m betragen")
        )
        return llm

    @pytest.mark.asyncio
    async def test_a_misremembered_quote_is_corrected_in_place(self, mock_llm_provider, mock_llm, patch_llm):
        mock_llm.ainvoke = AsyncMock(side_effect=[self._tool_call(), self.MISQUOTED])
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[knowledge_search], card_repair_llm=patch_llm)
        state = ResearchAgentState(messages=[HumanMessage(content="Treppenhoehe?")])

        result = await _run_with_bound_registry(agent, state, SourceRegistry())

        output = result.messages[-1].content
        assert output.startswith("Vorweg: Treppen sind Fluchtwege. Es gilt: „Die lichte Durchgangshoehe von Treppen")
        assert '2,10 m betragen" [1]. Danach folgt die Breite.' in output
        assert "[nicht wörtlich in der Quelle belegt]" not in output
        assert result.answer_quotes_verified is True
        assert mock_llm.ainvoke.await_count == 2
        assert patch_llm.ainvoke.await_count == 1

    @pytest.mark.asyncio
    async def test_a_quote_no_passage_comes_close_to_stays_as_written_and_flagged(
        self, mock_llm_provider, mock_llm, patch_llm
    ):
        mock_llm.ainvoke = AsyncMock(side_effect=[self._tool_call(), self.FABRICATED])
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[knowledge_search], card_repair_llm=patch_llm)
        state = ResearchAgentState(messages=[HumanMessage(content="Treppenhoehe?")])

        result = await _run_with_bound_registry(agent, state, SourceRegistry())

        output = result.messages[-1].content
        assert "Loeschanlage" in output
        assert "[nicht wörtlich in der Quelle belegt]" not in output
        assert result.answer_quotes_verified is False
        assert patch_llm.ainvoke.await_count == 0

    @pytest.mark.asyncio
    async def test_a_correction_the_passage_does_not_hold_is_refused(self, mock_llm_provider, mock_llm, patch_llm):
        patch_llm.ainvoke = AsyncMock(
            return_value=AIMessage(content="Die lichte Durchgangshoehe von Treppen muss mindestens 2,50 m betragen")
        )
        mock_llm.ainvoke = AsyncMock(side_effect=[self._tool_call(), self.MISQUOTED])
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[knowledge_search], card_repair_llm=patch_llm)
        state = ResearchAgentState(messages=[HumanMessage(content="Treppenhoehe?")])

        result = await _run_with_bound_registry(agent, state, SourceRegistry())

        output = result.messages[-1].content
        assert "wenigstens 2,10 m" in output
        assert "2,50" not in output
        assert "[nicht wörtlich in der Quelle belegt]" not in output
        assert result.answer_quotes_verified is False

    @pytest.mark.asyncio
    async def test_a_clean_answer_costs_no_extra_call(self, mock_llm_provider, mock_llm, patch_llm):
        mock_llm.ainvoke = AsyncMock(side_effect=[self._tool_call(), self.VERBATIM])
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[knowledge_search], card_repair_llm=patch_llm)
        state = ResearchAgentState(messages=[HumanMessage(content="Treppenhoehe?")])

        await _run_with_bound_registry(agent, state, SourceRegistry())

        assert mock_llm.ainvoke.await_count == 2
        assert patch_llm.ainvoke.await_count == 0

    @pytest.mark.asyncio
    async def test_switched_off_ships_the_quote_unpatched_and_flagged(self, mock_llm_provider, mock_llm, patch_llm):
        mock_llm.ainvoke = AsyncMock(side_effect=[self._tool_call(), self.MISQUOTED])
        agent = ChatAgent(
            llm_provider=mock_llm_provider, tools=[knowledge_search], repair_pass=False, card_repair_llm=patch_llm
        )
        state = ResearchAgentState(messages=[HumanMessage(content="Treppenhoehe?")])

        result = await _run_with_bound_registry(agent, state, SourceRegistry())

        assert "[nicht wörtlich in der Quelle belegt]" not in result.messages[-1].content
        assert result.answer_quotes_verified is False
        assert patch_llm.ainvoke.await_count == 0

    @pytest.mark.asyncio
    async def test_without_a_small_model_the_repair_is_off(self, mock_llm_provider, mock_llm):
        mock_llm.ainvoke = AsyncMock(side_effect=[self._tool_call(), self.MISQUOTED])
        agent = ChatAgent(
            llm_provider=mock_llm_provider, tools=[knowledge_search], repair_pass=True, card_repair_llm=None
        )
        state = ResearchAgentState(messages=[HumanMessage(content="Treppenhoehe?")])

        with patch("agent.core.agent.quote_patcher") as patcher:
            result = await _run_with_bound_registry(agent, state, SourceRegistry())

        assert "[nicht wörtlich in der Quelle belegt]" not in result.messages[-1].content
        assert result.answer_quotes_verified is False
        assert "wenigstens 2,10 m" in result.messages[-1].content
        patcher.assert_not_called()
        assert mock_llm.ainvoke.await_count == 2


class TestClarificationGuidance:
    def _render(self, *, project_context):

        from agent.common import render_prompt_template

        prompt = _chat_prompt_source()
        return render_prompt_template(
            prompt,
            user_info={"name": "Alex", "email": "a@example.com"},
            current_datetime="2026-07-23",
            available_documents=[],
            project_context=project_context,
            parcel_note=None,
        )

    def test_clarification_guidance_present_on_research_turn_without_project_context(self):
        rendered = self._render(project_context=None)
        rules = rendered.split("<rules>")[1].split("</rules>")[0]
        assert "answer under a stated assumption" in rules
        assert "ask one short question first" in rules
        assert "`ask_user`" in rules

    def test_clarification_guidance_present_with_project_context_too(self):
        rendered = self._render(project_context="facts:\n  bundesland: unknown")
        assert "answer under a stated assumption" in rendered


class TestOffTopicDeclineShape:
    def _render(self):

        from agent.common import render_prompt_template

        prompt = _chat_prompt_source()
        return render_prompt_template(
            prompt,
            user_info={"name": "Alex", "email": "a@example.com"},
            current_datetime="2026-07-23",
            available_documents=[],
            project_context=None,
            parcel_note=None,
        )

    def test_contract_has_explicit_off_topic_decline_shape(self):
        rendered = self._render()
        rules = rendered.split("<rules>")[1].split("</rules>")[0]
        assert "decline without answering it, even when you know the answer" in rules
        assert "a redirect to what you can help with" in rules
        assert "no tool call" in rules

    def test_in_scope_conversational_shape_still_answers(self):
        kinds = self._render().split("KINDS.")[1].split("FIELDS.")[0]
        assert "`direct`: a greeting, a question about you" in kinds


class TestADirectReplyMayStillEmitACard:
    def _render(self):
        return TestOffTopicDeclineShape._render(self)

    def _kinds(self) -> str:
        return self._render().split("KINDS.")[1].split("FIELDS.")[0]

    def test_the_direct_reply_shape_has_every_tool(self):
        kinds = self._kinds()
        assert "Every tool is available on every turn" in kinds
        direct_shape = kinds.split("- `direct`")[1].split("- `walkthrough`")[0]
        assert "no tool calls" not in direct_shape
        assert "cited only for a retrieved passage" in direct_shape

    def test_the_off_topic_shape_still_forbids_every_tool_call(self):
        rules = self._render().split("<rules>")[1].split("</rules>")[0]
        assert "no tool call" in rules

    def test_the_direct_reply_shape_names_the_card_rule_and_its_limit(self):
        direct_shape = self._kinds().split("- `direct`")[1].split("- `walkthrough`")[0]
        assert "is a walkthrough or a ruling, not a direct reply" in direct_shape
        assert "no card" in direct_shape

    def test_the_hand_off_shape_escalates_a_commissioned_report_at_once(self):
        hand_off = self._kinds().split("- `handoff`")[1]
        assert "`escalate_to_deep`" in hand_off and "`escalation_reason`" in hand_off
        assert "a commissioned report needs no retrieval first" in hand_off
        assert "never handed off" in hand_off

    def test_the_card_contract_is_in_every_system_prompt(self):
        from agent.core.prompt import bundled_static_block
        from agent.core.prompt import render_static_block

        system = render_static_block(bundled_static_block().text)
        assert "CARDS (the `cards` field)" in system
        assert "[[card:N]]" in system

    def test_the_contract_names_the_kinds_and_earns_a_ruling(self):
        kinds = self._kinds()
        for kind in ("direct", "walkthrough", "ruling", "handoff", "work"):
            assert f"`{kind}`" in kinds
        assert "copyable legal value" in kinds
        walkthrough = kinds.split("- `walkthrough`")[1].split("- `ruling`")[0]
        assert "carries no `verdict`" in walkthrough
        assert "summarising" in walkthrough and "organising" in walkthrough

    def test_walkthrough_examples_exist_and_carry_no_verdict(self):
        rendered = self._render()
        chunks = rendered.split('type="walkthrough"')
        assert len(chunks) >= 2, "need a walkthrough example"
        for chunk in chunks[1:]:
            example = chunk.split("</example>", 1)[0]
            assert '"verdict"' not in example

    def test_the_research_example_is_a_walkthrough_not_a_topic_gavel(self):
        rendered = self._render()
        overview = rendered.split('type="walkthrough"')[1].split("</example>", 1)[0]
        assert '"kind": "walkthrough"' in overview
        assert '"topic": "Fire safety"' in overview
        ruling = rendered.split('type="ruling"')[1].split("</example>", 1)[0]
        assert '"kind": "ruling"' in ruling
        assert '"value": "REI 60"' in ruling
        assert '"value": "Brandschutz"' not in rendered
        assert '"value": "Fire safety"' not in rendered

    def test_the_identity_does_not_reduce_the_job_to_oib_questions(self):
        rendered = self._render()
        assert "Ich beantworte Fragen zu OIB" not in rendered
        assert "OIB-Richtlinien, österreichischem Baurecht" not in rendered

    def test_the_research_rules_state_outcomes_not_a_procedure(self):
        rendered = self._render()
        assert "Grid OIB Research Agent" not in rendered
        assert "at most 2 calls" not in rendered
        assert "not every question is a legal question" in rendered
        assert "commit to it; re-plan only" not in rendered
        good = rendered.split("<good_answer>")[1].split("</good_answer>")[0]
        assert "evidence you saw this turn" in good
        rules = rendered.split("<rules>")[1].split("</rules>")[0]
        assert "A file you did not open is not described" in rules
        assert "„nicht gelesen“" in rules
        assert "Abdeckung: unzureichend" not in rules
        assert "`conclusion`" not in rules
        procedures = (
            "at most two searches",
            "ONE parallel round",
            "per member",
            "Choose sources in this order",
            "rewrite the user's question",
        )
        for procedure in procedures:
            assert procedure not in rendered, procedure


class TestKnowledgeInventoryIsNotCitable:
    def _render(self, prompt: str, documents: list[dict]) -> str:
        from agent.common import render_prompt_template

        return render_prompt_template(
            prompt,
            tools=[{"name": "knowledge_search", "description": "Search the knowledge base"}],
            user_info=None,
            current_datetime="2026-07-28",
            available_documents=documents,
            project_context=None,
            ris_catalog=None,
            norm_doctrine=None,
            parcel_note=None,
            execution_enabled=False,
            jurisdiction_grounding=None,
            enable_source_router=False,
            max_research_concurrency=3,
        )

    @staticmethod
    def _prompt(path: str) -> str:
        from pathlib import Path

        import agent

        if path == "core/prompts/system.j2":
            return _chat_prompt_source()
        return (Path(agent.__file__).parent / "agents" / path).read_text(encoding="utf-8")

    DOCUMENTS = [{"file_name": "oib-rl_2_ausgabe_mai_2023.pdf", "summary": "Brandschutz.", "tags": []}]

    def test_chat_prompt_marks_the_inventory_as_not_a_source(self):
        rendered = self._render(self._prompt("core/prompts/system.j2"), self.DOCUMENTS)

        assert "oib-rl_2_ausgabe_mai_2023.pdf" in rendered
        assert "NOT sources" in rendered
        assert "not a citable source" in rendered
        citations = rendered.split("CITATIONS.")[1].split("EXAMPLES.")[0]
        assert "the citation key exactly as the tool returned it" in citations
        assert "Cite only what a tool returned" in citations

    def test_chat_prompt_asks_for_disagreement_between_sources_to_be_shown(self):
        source = self._prompt("core/prompts/system.j2")

        block = source.split("<legal_method>")[1].split("</legal_method>")[0]
        rule = block.split("When two sources disagree")[1].split("\n")[0]
        assert "show both with their citations" in rule
        assert "Resolve by the chain" in rule
        assert "say that they disagree" in rule
        assert "keep `confidence` below high" in rule

    def test_every_example_source_line_in_the_prompt_is_a_bare_locator(self):
        import json
        import re

        source = self._prompt("core/prompts/system.j2")
        blocks = re.findall(r"```answer_json\n(\{.*?\})\n```", source, flags=re.DOTALL)
        assert blocks, "the prompt lost its answer_json examples"
        entries: list[str] = []
        for block in blocks:
            answer = json.loads(block).get("answer", "")
            for label in ("**Quellen:**", "**References:**"):
                if label in answer:
                    entries.extend(
                        line.strip() for line in answer.split(label, 1)[1].split("\n") if line.strip().startswith("- [")
                    )
        assert entries, "no example carries a sources section"
        bare_locator = re.compile(r"^- \[\d+\] (\S+\.\w{2,5}), p\.\d+$")
        titled_url = re.compile(r"^- \[\d+\] .+ - https?://\S+$")
        for entry in entries:
            assert bare_locator.match(entry) or titled_url.match(entry), entry

    def test_deep_researcher_prompt_marks_the_inventory_as_not_a_source(self):
        rendered = self._render(self._prompt("deep_researcher/prompts/researcher.j2"), self.DOCUMENTS)

        assert "oib-rl_2_ausgabe_mai_2023.pdf" in rendered
        assert "NOT sources" in rendered
        assert "not a citable source" in rendered

    def test_no_prompt_still_calls_the_base_corpus_a_user_upload(self):
        for path in (
            "core/prompts/system.j2",
            "deep_researcher/prompts/researcher.j2",
            "deep_researcher/prompts/orchestrator.j2",
            "deep_researcher/prompts/planner.j2",
            "deep_researcher/prompts/source_router.j2",
        ):
            source = self._prompt(path)
            assert "Uploaded Documents" not in source, path

    def test_chat_prompt_teaches_the_four_shelves(self):
        source = self._prompt("core/prompts/system.j2")
        for mount, name in (("/project/", "Projektwissen"), ("/office/", "Büroablage"), ("/chat/", "Private Sitzung")):
            assert f"{mount} is {name}" in source or f"{mount} {name}" in source
        assert "/law/oib/ Basiswissen" in source
        rendered = self._render(source, self.DOCUMENTS)
        assert "Büroablage is never the OIB corpus" in rendered

    def test_grouped_inventory_does_not_mix_oib_into_office_shelf(self):
        documents = [
            {"file_name": "oib-rl_2.pdf", "summary": "Brandschutz.", "shelf": "base", "collection": "oib_knowledge"},
            {
                "file_name": "Buero-Standard.pdf",
                "summary": "Detail.",
                "shelf": "office_shelf",
                "collection": "archiv_org",
            },
        ]
        rendered = self._render(self._prompt("core/prompts/system.j2"), documents)
        office_shelf = rendered.split("### Büroablage", 1)[1].split("### ", 1)[0]
        assert "Buero-Standard.pdf" in office_shelf
        assert "oib-rl_2.pdf" not in office_shelf


class TestTheModelCardsAreActuallyAskedFor:
    def _ifc_skill(self) -> str:
        from pathlib import Path

        import agent

        return (
            Path(agent.__file__).parent / "skills" / "builtin" / "bim" / "ifc-spatial-reasoning" / "SKILL.md"
        ).read_text(encoding="utf-8")

    def test_the_static_prompt_does_not_teach_the_model_cards(self):
        from agent.cards.catalog import MODEL_BACKED_CARD_TYPES

        static = _chat_prompt_source().split("<turn_context>")[0]
        for card_type in MODEL_BACKED_CARD_TYPES:
            assert card_type not in static, card_type

    def test_every_model_backed_card_is_named_in_the_skill(self):
        from agent.cards.catalog import MODEL_BACKED_CARD_TYPES

        body = self._ifc_skill()
        for card_type in MODEL_BACKED_CARD_TYPES:
            assert card_type in body, card_type

    def test_it_says_where_the_ids_must_come_from(self):
        body = self._ifc_skill()
        assert "THIS turn" in body


_MEASURED_BASEMENT = {
    "value": 2.703,
    "unit": "m",
    "tolerance": 0.005,
    "provenance": "computed",
    "from": ["3xR9kQvB7Fp8sT2mW1nZdY"],
    "method": "clearHeight(space 3xR9kQvB7Fp8sT2mW1nZdY)",
    "decidable": True,
    "caveat": "Nur die Räume mit exportierter Geschoßebene.",
}

_MEASURED_MODEL = {"model": {"filename": "Institut.ifc", "schemaVersion": "IFC4", "elements": 12043}}


@tool(description="Measure the project's IFC/BIM model and report the provenance.")
def ifc_measure(operation: str = "measure") -> str:
    from agent.tools.bim.measure_register import _render

    return _render(
        "measure",
        dict(_MEASURED_BASEMENT),
        source=dict(_MEASURED_MODEL),
        handle="0f1e2d3c4b5a",  # pragma: allowlist secret - an IFC model handle, not a credential
        detail="clearHeight",
    )


class TestMeasurementSourcesDoNotGroundCitations:
    @pytest.fixture
    def mock_llm(self):
        llm = MagicMock()
        llm.ainvoke = AsyncMock()
        llm.bind_tools = MagicMock(return_value=llm)
        llm.bind = MagicMock(return_value=llm)
        return llm

    @pytest.fixture
    def mock_llm_provider(self, mock_llm):
        provider = MagicMock(spec=LLMProvider)
        provider.get = MagicMock(return_value=mock_llm)
        return provider

    def _measuring_turn(self, mock_llm, answer: str, *, tools=None):
        mock_llm.ainvoke = AsyncMock(
            side_effect=[
                AIMessage(
                    content="",
                    tool_calls=[{"name": "ifc_measure", "args": {"operation": "measure"}, "id": "m1"}],
                ),
                AIMessage(content=answer),
            ]
        )
        return tools or [ifc_measure]

    @staticmethod
    def _measurement_sources(result):
        return [s for s in (result.verified_sources or []) if s.get("kind") == "measurement"]

    @pytest.mark.asyncio
    async def test_measured_answer_with_uncited_normative_claim_never_reaches_the_registry(
        self, mock_llm_provider, mock_llm
    ):
        tools = self._measuring_turn(
            mock_llm,
            "Der Keller ist 2,70 m hoch und erfüllt damit die Mindestraumhöhe nach OIB-Richtlinie 4.",
        )
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=tools)
        state = ResearchAgentState(
            messages=[HumanMessage(content="Wie hoch ist der Keller?")],
        )
        result, registry = await _run_with_captured_registry(agent, state)

        assert self._measurement_sources(result), "the measurement produced no Herleitung source"
        assert result.answer_measurement_grounded is True
        assert registry.all_sources() == []
        assert result.answer_citation_grounded is False

    @pytest.mark.asyncio
    async def test_a_lone_measurement_is_never_a_citation(self, mock_llm_provider, mock_llm):
        tools = self._measuring_turn(mock_llm, "Der Keller ist 2,70 m hoch.")
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=tools)
        state = ResearchAgentState(
            messages=[HumanMessage(content="Wie hoch ist der Keller?")],
        )
        result, registry = await _run_with_captured_registry(agent, state)

        assert self._measurement_sources(result)
        assert registry.all_sources() == []
        assert result.answer_citation_grounded is False
        answer = next(m for m in reversed(result.messages) if isinstance(m, AIMessage) and not m.tool_calls)
        assert "[1]" not in answer.content

    @pytest.mark.asyncio
    async def test_failed_retrieval_is_still_reported_even_when_the_turn_measured(self, mock_llm_provider, mock_llm):
        populate_from_config(
            [
                {
                    "id": "web_search",
                    "name": "Web Search",
                    "description": "Search the web.",
                    "tools": ["empty_web_search_tool"],
                }
            ],
        )
        mock_llm.ainvoke = AsyncMock(
            side_effect=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {"name": "ifc_measure", "args": {"operation": "measure"}, "id": "m1"},
                        {"name": "empty_web_search_tool", "args": {"query": "OIB 4 Raumhöhe"}, "id": "w1"},
                    ],
                ),
                AIMessage(content="Der Keller ist 2,70 m hoch."),
            ]
        )
        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[ifc_measure, empty_web_search_tool],
        )
        state = ResearchAgentState(
            messages=[HumanMessage(content="Wie hoch ist der Keller?")],
        )
        result, registry = await _run_with_captured_registry(agent, state)

        assert registry.all_sources() == []
        assert result.answer_lookup_found_nothing is True

    @pytest.mark.asyncio
    async def test_the_card_carries_the_audit_trail_the_envelope_had(self, mock_llm_provider, mock_llm):
        tools = self._measuring_turn(mock_llm, "Der Keller ist 2,70 m hoch.")
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=tools)
        state = ResearchAgentState(
            messages=[HumanMessage(content="Wie hoch ist der Keller?")],
        )
        result, _ = await _run_with_captured_registry(agent, state)

        (card,) = self._measurement_sources(result)
        assert card["lane"] == "measurement"
        assert card["title"] == "clearHeight"
        measurement = card["measurement"]
        assert measurement["provenance"] == "computed"
        assert measurement["provenance_label"] == "gemessen"
        assert measurement["value_text"] == "2.703 m"
        assert measurement["tolerance_text"] == "±0.005 m"
        assert measurement["method"] == _MEASURED_BASEMENT["method"]
        assert [e["global_id"] for e in measurement["elements"]] == _MEASURED_BASEMENT["from"]
        assert measurement["model"] == "Institut.ifc (IFC4, 12043 elements)"
        assert measurement["caveat"] == _MEASURED_BASEMENT["caveat"]

    @pytest.mark.asyncio
    async def test_the_measurement_does_not_count_as_a_cited_source(self, mock_llm_provider, mock_llm):
        tools = self._measuring_turn(mock_llm, "Der Keller ist 2,70 m hoch.")
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=tools)
        state = ResearchAgentState(
            messages=[HumanMessage(content="Wie hoch ist der Keller?")],
        )
        with patch("agent.core.ledger.citation_events") as events:
            result, _ = await _run_with_captured_registry(agent, state)

        assert self._measurement_sources(result)
        assert events.record_turn.call_args.kwargs["cited_count"] == 0
        assert events.record_turn.call_args.kwargs["source_count"] == 0


class TestTheResearchBudgetIsOneNumber:
    def _agent(self, iterations: int = 3):
        llm = MagicMock()
        llm.ainvoke = AsyncMock()
        llm.bind_tools = MagicMock(return_value=llm)
        llm.bind = MagicMock(return_value=llm)
        provider = MagicMock(spec=LLMProvider)
        provider.get = MagicMock(return_value=llm)
        return (
            ChatAgent(llm_provider=provider, tools=[web_search_tool], max_tool_iterations=iterations),
            llm,
        )

    def test_the_ceiling_is_the_budget(self):
        agent, _ = self._agent(iterations=7)
        assert agent.max_tool_iterations == 7
        assert agent.tool_iteration_ceiling == 7

    def test_the_agent_takes_no_reserve_at_all(self):
        import inspect

        assert "reserved_tool_iterations" not in inspect.signature(ChatAgent.__init__).parameters


class TestTruncationIsObservable:
    @pytest.fixture(autouse=True)
    def _bypass_citation_pipeline(self):
        with (
            patch.object(SourceRegistry, "all_sources", return_value=[SourceEntry(url="https://example.com")]),
            patch("agent.core.answer_pipeline.verify_citations") as verify,
            patch("agent.core.answer_pipeline.sanitize_report") as sanitize,
        ):
            verify.side_effect = lambda content, reg, reference_sources=None, **_: MagicMock(
                verified_report=content, removed_citations=[]
            )
            sanitize.side_effect = lambda content: MagicMock(sanitized_report=content)
            yield

    async def _truncated_run(self):
        llm = MagicMock()
        llm.bind_tools = MagicMock(return_value=llm)
        llm.bind = MagicMock(return_value=llm)
        llm.ainvoke = AsyncMock(return_value=AIMessage(content="Die Antwort [1]."))
        provider = MagicMock(spec=LLMProvider)
        provider.get = MagicMock(return_value=llm)
        agent = ChatAgent(
            llm_provider=provider,
            tools=[web_search_tool],
            max_tool_iterations=5,
        )
        history = [
            HumanMessage(content="Wie tief ist der Lichteinfall?"),
            AIMessage(
                content="",
                tool_calls=[
                    {"name": "read_file", "args": {"file_path": "/skills/office/piloti-voice/SKILL.md"}, "id": "s1"},
                    {"name": "read_file", "args": {"file_path": "/skills/office/piloti-cards/SKILL.md"}, "id": "s2"},
                ],
            ),
            AIMessage(content="", tool_calls=[{"name": "knowledge_search", "args": {}, "id": "k1"}]),
            AIMessage(
                content="",
                tool_calls=[
                    {"name": "find_elements", "args": {}, "id": "f1"},
                    {"name": "light_incidence", "args": {}, "id": "l1"},
                ],
            ),
        ]
        state = ResearchAgentState(messages=history, tool_iterations=5)
        await agent.run(state)

    @pytest.mark.asyncio
    async def test_the_log_says_what_was_cut_off_and_on_what_shape(self, caplog):
        import logging

        with caplog.at_level(logging.WARNING, logger="agent.core.agent"):
            await self._truncated_run()

        lines = [m for m in caplog.messages if "Forcing synthesis (rounds)" in m]
        assert lines, f"the turn was cut off and left no countable record of it; warnings logged were {caplog.messages}"
        line = lines[0]
        assert "ceiling=5" in line
        assert "rounds_spent=5" in line
        assert "input_tokens=0/" in line
        assert "skill_calls=2" in line
        assert "shape=read_skill>read_skill>knowledge_search>find_elements>light_incidence" in line
        assert "Lichteinfall" not in line

    @pytest.mark.asyncio
    async def test_the_turn_records_the_truncation_as_telemetry(self, emitted):
        await self._truncated_run()

        records = [step for step in emitted.steps if step.id == "status:budget"]
        assert records, (
            "evidence-gathering was cut off and the turn emitted no truncation telemetry — "
            f"nothing here can answer how often it happens; steps were {[step.id for step in emitted.steps]}"
        )
        record = records[0]
        assert record.detail == {
            "truncated": True,
            "ceiling": 5,
            "research_budget": 5,
            "spent": 5,
            "rounds": 5,
            "tools": ["read_skill", "read_skill", "knowledge_search", "find_elements", "light_incidence"],
        }
        assert (record.channel, record.key) == ("technical", None)

    @pytest.mark.asyncio
    async def test_the_answer_carries_the_fact_out_of_the_graph(self):
        llm = MagicMock()
        llm.bind_tools = MagicMock(return_value=llm)
        llm.bind = MagicMock(return_value=llm)
        llm.ainvoke = AsyncMock(return_value=AIMessage(content="Die Antwort [1]."))
        provider = MagicMock(spec=LLMProvider)
        provider.get = MagicMock(return_value=llm)
        agent = ChatAgent(llm_provider=provider, tools=[web_search_tool], max_tool_iterations=2)

        truncated = await agent.run(ResearchAgentState(messages=[HumanMessage(content="Wie tief?")], tool_iterations=2))
        assert truncated.research_truncated is True

    @pytest.mark.asyncio
    async def test_an_answer_that_finished_its_research_claims_nothing(self):
        llm = MagicMock()
        llm.bind_tools = MagicMock(return_value=llm)
        llm.bind = MagicMock(return_value=llm)
        llm.ainvoke = AsyncMock(return_value=AIMessage(content="Die Antwort [1]."))
        provider = MagicMock(spec=LLMProvider)
        provider.get = MagicMock(return_value=llm)
        agent = ChatAgent(llm_provider=provider, tools=[web_search_tool], max_tool_iterations=3)

        finished = await agent.run(ResearchAgentState(messages=[HumanMessage(content="Kurz gefragt")]))
        assert finished.research_truncated is None

    @pytest.mark.asyncio
    async def test_a_turn_that_finishes_inside_its_budget_records_nothing(self, emitted):
        llm = MagicMock()
        llm.bind_tools = MagicMock(return_value=llm)
        llm.bind = MagicMock(return_value=llm)
        llm.ainvoke = AsyncMock(return_value=AIMessage(content="Die Antwort [1]."))
        provider = MagicMock(spec=LLMProvider)
        provider.get = MagicMock(return_value=llm)
        agent = ChatAgent(llm_provider=provider, tools=[web_search_tool], max_tool_iterations=3)

        await agent.run(ResearchAgentState(messages=[HumanMessage(content="Kurz gefragt")]))

        assert [step for step in emitted.steps if step.id == "status:budget"] == []


class TestAssistantCheckpoint:
    def test_a_sentence_before_the_calls_is_the_checkpoint(self):
        message = AIMessage(
            content="OIB 3 Pkt. 3.4.2 verweist auf den lichten Einfallswinkel.",
            tool_calls=[{"name": "knowledge_search", "args": {"query": "x"}, "id": "1"}],
        )
        assert assistant_checkpoint(message) == ("OIB 3 Pkt. 3.4.2 verweist auf den lichten Einfallswinkel.")

    def test_empty_content_is_not_invented(self):
        message = AIMessage(
            content="",
            tool_calls=[{"name": "knowledge_search", "args": {"query": "x"}, "id": "1"}],
        )
        assert assistant_checkpoint(message) is None

    def test_a_fenced_answer_is_not_a_checkpoint(self):
        message = AIMessage(content='```answer_json\n{"answer": "x", "kind": "direct"}\n```')
        assert assistant_checkpoint(message) is None


def _render_researcher_prompt(*, drafting_enabled: bool = False) -> str:

    from agent.common import render_prompt_template

    prompt = _chat_prompt_source()
    return render_prompt_template(
        prompt,
        tools=[],
        user_info=None,
        current_datetime="2026-09-10",
        available_documents=[],
        project_context=None,
        parcel_note=None,
        drafting_enabled=drafting_enabled,
    )


def _drafts_block() -> str:
    return _render_researcher_prompt(drafting_enabled=True).split("<drafts>")[1].split("</drafts>")[0]


class TestTheWorkingDirectoryBlock:
    def test_a_turn_without_the_tools_is_never_told_to_write(self):
        assert "<drafts>" not in _render_researcher_prompt(drafting_enabled=False)

    def test_the_anaphora_resolves_against_the_previous_answer(self):
        block = _drafts_block()
        assert "`daraus`/`davon`/`das`" in block
        assert "previous answer of this conversation" in block
        assert "without asking about format or content" in block

    def test_a_conversation_without_a_project_is_told_by_the_refusal(self):
        from pathlib import Path

        from agent.tools.documents import register as documents

        assert "There is no project in this conversation" in Path(documents.__file__).read_text(encoding="utf-8")
        assert "Without a project" not in _drafts_block()

    def test_the_workflow_the_tools_own_is_no_longer_in_the_prompt(self):
        block = _drafts_block()
        for teaching in ("`write_file`", "`edit_file`", "`file_draft`", "`submit=true`", "`reviewer`"):
            assert teaching not in block, teaching

    def test_the_block_follows_the_tools_and_not_a_second_switch(self):
        from agent.core.prompt import render_turn_context
        from agent.core.prompt import system_prompt_template

        state = ResearchAgentState(messages=[HumanMessage(content="Schreib den Aktenvermerk")])
        with_tools = render_turn_context(
            system_prompt_template(),
            state,
            [{"name": "write_file", "description": "Schreibt ein NEUES Dokument"}],
        )
        without = render_turn_context(
            system_prompt_template(),
            state,
            [{"name": "web_search_tool", "description": "Search"}],
        )
        assert "<drafts>" in with_tools
        assert "<drafts>" not in without


class TestTheDraftingRulesLiveInTheTools:
    @staticmethod
    def _draft_verbs() -> dict[str, str]:
        from agent.tools.documents.tools import _TOOL_DESCRIPTIONS

        return _TOOL_DESCRIPTIONS

    def test_write_file_says_a_commissioned_document_is_written_not_described(self):
        description = self._draft_verbs()["write_file"]
        for kind in ("Aktenvermerk", "Protokoll", "Checkliste", "Flächenaufstellung"):
            assert kind in description
        assert "rather than in the answer" in description
        assert "in one sentence" in description

    def test_a_revision_edits_the_file_it_already_wrote(self):
        verbs = self._draft_verbs()
        assert "an existing path is refused, and edit_file changes it" in verbs["write_file"]
        assert verbs["edit_file"].startswith("Changes part of a draft")

    def test_read_file_says_the_working_directory_is_not_a_source(self):
        verbs = self._draft_verbs()
        assert "the answer wrote itself" in verbs["read_file"]
        assert "source tools" in verbs["read_file"]
        assert "wrote itself" not in verbs["ls"]

    def test_file_draft_says_filing_happens_on_request(self):
        from agent.tools.documents.register import _FILE_DRAFT_DESCRIPTION

        for phrase in ("leg das ins Projekt", "ablegen", "abspeichern"):
            assert phrase in _FILE_DRAFT_DESCRIPTION
        assert "not on your own after every write" in _FILE_DRAFT_DESCRIPTION
        assert "DRAFT" in _FILE_DRAFT_DESCRIPTION
        assert "nobody has approved it" in _FILE_DRAFT_DESCRIPTION

    def test_submitting_needs_an_explicit_request(self):
        from agent.tools.documents.register import _FILE_DRAFT_DESCRIPTION

        assert "Call with `submit=true` only when the user asks for approval" in _FILE_DRAFT_DESCRIPTION
        assert "„ablegen“ alone is not such a request" in _FILE_DRAFT_DESCRIPTION
        assert "unchanged" in _FILE_DRAFT_DESCRIPTION
        assert "project's editors" in _FILE_DRAFT_DESCRIPTION


class TestTheDelegationRulesLiveInTheTool:
    @staticmethod
    def _description() -> str:
        from agent.tools.tasks.register import _CREATE_TASK_DESCRIPTION

        return _CREATE_TASK_DESCRIPTION

    def test_the_prompt_no_longer_teaches_delegation(self):
        assert "<delegieren>" not in _render_researcher_prompt(drafting_enabled=True)

    def test_it_names_the_delegatable_kinds(self):
        description = self._description()
        for kind in ("compliance_check", "submission_check", "document", "revision"):
            assert f"`{kind}`" in description

    def test_it_names_the_requests_a_person_actually_makes(self):
        description = self._description()
        assert "Einreichcheck bis Freitag" in description
        assert f"@{PRODUCT_NAME} prüf das" in description

    def test_the_deadline_is_a_date_and_not_a_phrase(self):
        description = self._description()
        assert "`YYYY-MM-DD`" in description
        assert "do not pass text" in description

    def test_the_answer_must_not_claim_the_work_is_done(self):
        assert "CREATED, not done" in self._description()

    def test_delegating_is_not_a_way_out_of_answering(self):
        assert "not for a question that can be answered now" in self._description()

    def test_the_precondition_is_stated_where_the_model_reads_it(self):
        description = self._description()
        assert "without a project in this conversation none is created" in description
        assert "instead of retrying" in description


class TestTheWorkingDirectoryBudget:
    def test_the_recursion_limit_derives_from_the_ceiling_alone(self):
        from agent.core.agent import _recursion_limit

        assert _recursion_limit(5) == (5 * 2) + 10

    def test_a_draft_read_back_is_never_a_source(self):
        from agent.core.agent import _capture_sources

        registry = SourceRegistry()
        for verb in ("ls", "read_file", "write_file", "edit_file"):
            _capture_sources(verb, "# Aktenvermerk\n\nGebäudeklasse 4", frozenset({verb}), registry)
        assert list(registry.all_sources()) == []


class TestAFailedCallIsNotASource:
    @pytest.fixture(autouse=True)
    def _web_search_is_a_data_source(self):
        reset_registry()
        populate_from_config(
            [
                {
                    "id": "web_search",
                    "name": "Web Search",
                    "description": "Search the web.",
                    "tools": ["web_search_tool"],
                }
            ],
        )
        yield
        reset_registry()

    @staticmethod
    def _captured(message) -> list:
        from types import SimpleNamespace

        registry = SourceRegistry()
        binding = SimpleNamespace(source_tool_names=frozenset({"web_search_tool"}))
        state = ResearchAgentState(messages=[])
        ChatAgent._capture_round(None, [message], binding, registry, state)
        return list(registry.all_sources())

    def test_an_errored_result_registers_nothing(self):
        from langchain_core.messages import ToolMessage

        message = ToolMessage(
            content=(
                "Error: the call was rejected. query: Field required. "
                "For further information visit https://errors.pydantic.dev/2.13/v/missing"
            ),
            tool_call_id="call_1",
            name="web_search_tool",
            status="error",
        )

        assert self._captured(message) == []

    def test_a_result_that_succeeded_is_still_read(self):
        from langchain_core.messages import ToolMessage

        message = ToolMessage(
            content='<Document href="https://www.oib.or.at/richtlinie-2">\n<title>\nTreffer\n</title>\n…\n</Document>',
            tool_call_id="call_2",
            name="web_search_tool",
        )

        assert [entry.url for entry in self._captured(message)] == ["https://www.oib.or.at/richtlinie-2"]


def _bind_signed_turn(monkeypatch, *, conversation_id: str) -> None:
    import base64
    import hashlib
    import hmac
    import json
    from types import SimpleNamespace

    from nat.plugin_api import Context

    secret = "graph-turn-secret"  # noqa: S105 - test fixture value  # pragma: allowlist secret
    payload = json.dumps(
        {
            "organizationId": "org_1",
            "userId": "user_1",
            "projectId": "3f8b0d2e-0000-4000-8000-000000000001",
            "conversationId": conversation_id,
            "issuedAt": 1_757_500_000_000,
        }
    )
    header = base64.urlsafe_b64encode(payload.encode("utf-8")).decode("ascii").rstrip("=")
    signature = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    monkeypatch.setenv("INTERNAL_API_TOKEN", secret)

    class _Ctx:
        metadata = SimpleNamespace(
            headers={
                "x-grid-project-id": "3f8b0d2e-0000-4000-8000-000000000001",
                "x-grid-request-context": header,
                "x-grid-request-context-sig": signature,
            }
        )
        conversation_id = None

    _Ctx.conversation_id = conversation_id
    monkeypatch.setattr(Context, "get", staticmethod(lambda: _Ctx()))


class TestATurnThatWritesADraft:
    @pytest.fixture(autouse=True)
    def _bypass_citation_pipeline(self):
        with (
            patch.object(SourceRegistry, "all_sources", return_value=[SourceEntry(url="https://example.com")]),
            patch("agent.core.answer_pipeline.verify_citations") as mock_verify,
            patch("agent.core.answer_pipeline.sanitize_report") as mock_sanitize,
        ):
            mock_verify.side_effect = lambda content, reg, reference_sources=None, **_: MagicMock(
                verified_report=content, removed_citations=[]
            )
            mock_sanitize.side_effect = lambda content: MagicMock(sanitized_report=content)
            yield

    @pytest.fixture
    def scripted_llm(self):
        llm = MagicMock()
        llm.ainvoke = AsyncMock()
        llm.bind_tools = MagicMock(return_value=llm)
        llm.bind = MagicMock(return_value=llm)
        return llm

    @pytest.fixture
    def provider(self, scripted_llm):
        provider = MagicMock(spec=LLMProvider)
        provider.get = MagicMock(return_value=scripted_llm)
        return provider

    @pytest.fixture
    def cards(self):
        from agent.cards.registry import CardRegistry
        from agent.cards.registry import reset_card_registry
        from agent.cards.registry import set_card_registry

        registry = CardRegistry()
        token = set_card_registry(registry)
        try:
            yield registry
        finally:
            reset_card_registry(token)

    @pytest.fixture
    def working_directory(self):
        from langgraph.store.memory import InMemoryStore

        from agent.tools.documents.draft_store import DraftBackend
        from agent.tools.documents.tools import draft_tools

        backend = DraftBackend(store=InMemoryStore(), conversation_id="conv-1")
        return backend, draft_tools(backend)

    @staticmethod
    def _call(name: str, args: dict, call_id: str) -> AIMessage:
        return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": call_id}])

    @pytest.mark.asyncio
    async def test_write_then_edit_leaves_one_file_and_two_cards(
        self, provider, scripted_llm, cards, working_directory
    ):
        backend, tools = working_directory
        scripted_llm.ainvoke = AsyncMock(
            side_effect=[
                self._call(
                    "write_file",
                    {
                        "file_path": "/drafts/aktenvermerk.md",
                        "content": "# Aktenvermerk\n\nPunkt 3: Fluchtweg.\n",
                    },
                    "1",
                ),
                self._call(
                    "edit_file",
                    {
                        "file_path": "/drafts/aktenvermerk.md",
                        "old_string": "Punkt 3: Fluchtweg.",
                        "new_string": "Punkt 3: Fluchtweg, gekürzt.",
                    },
                    "2",
                ),
                AIMessage(content="Der Aktenvermerk ist geschrieben."),
            ]
        )

        agent = ChatAgent(
            llm_provider=provider,
            tools=[web_search_tool, *tools],
            max_tool_iterations=3,
        )

        result = await agent.run(ResearchAgentState(messages=[HumanMessage(content="Schreib den Aktenvermerk")]))

        stored = backend._get_store().get(("conversation", "conv-1", "drafts"), "/drafts/aktenvermerk.md")
        assert stored is not None, "the turn left no file"
        assert stored.value["content"] == "# Aktenvermerk\n\nPunkt 3: Fluchtweg, gekürzt.\n"

        assert [(card["type"], card["version"], card["title"]) for card in cards.snapshot()] == [
            ("document_draft", 1, "Aktenvermerk"),
            ("document_draft", 2, "Aktenvermerk"),
        ]

        assert result.tool_iterations == 2
        assert result.research_truncated is None

    @pytest.mark.asyncio
    async def test_write_then_file_draft_files_once_and_the_card_names_the_document(
        self, provider, scripted_llm, cards, working_directory, monkeypatch
    ):
        from langchain_core.tools import StructuredTool

        from agent.tools.documents import register as filing_tools

        backend, tools = working_directory
        posted: list[dict] = []

        async def _same_backend(conversation_id: str, dsn: str | None = None):
            return backend

        monkeypatch.setattr(filing_tools, "get_draft_backend", _same_backend)
        monkeypatch.setattr(
            filing_tools,
            "post_document_version",
            lambda payload, envelope: (
                posted.append(payload),
                {"documentId": "doc-7", "version": {"id": "ver-7", "state": "draft", "contentHash": "h7"}},
            )[1],
        )
        _bind_signed_turn(monkeypatch, conversation_id="conv-1")

        file_draft_tool = StructuredTool.from_function(
            coroutine=filing_tools.run_file_draft, name="file_draft", description="legt ab"
        )

        scripted_llm.ainvoke = AsyncMock(
            side_effect=[
                self._call(
                    "write_file",
                    {"file_path": "/drafts/aktenvermerk.md", "content": "# Aktenvermerk\n\nFluchtweg.\n"},
                    "1",
                ),
                self._call("file_draft", {"path": "/drafts/aktenvermerk.md"}, "2"),
                AIMessage(content="Der Aktenvermerk liegt als Entwurf im Projekt."),
            ]
        )

        agent = ChatAgent(
            llm_provider=provider,
            tools=[web_search_tool, *tools, file_draft_tool],
            max_tool_iterations=3,
        )
        result = await agent.run(ResearchAgentState(messages=[HumanMessage(content="Leg das ins Projekt")]))

        assert [payload["op"] for payload in posted] == ["create"]
        assert posted[0]["content"] == "# Aktenvermerk\n\nFluchtweg.\n"

        drafts = [card for card in cards.snapshot() if card["type"] == "document_draft"]
        assert "document_id" not in drafts[0]
        assert (drafts[-1]["document_id"], drafts[-1]["version_id"], drafts[-1]["version_state"]) == (
            "doc-7",
            "ver-7",
            "draft",
        )

        assert result.tool_iterations == 2


def _file_verb_descriptions() -> dict[str, str]:
    from agent.tools.files import register as files_register

    return {"propose_file_change": files_register._DESCRIPTION}


class TestTheTidyingRulesLiveInTheTools:
    def test_the_prompt_no_longer_teaches_tidying(self):
        assert "<aufraeumen>" not in _render_researcher_prompt(drafting_enabled=True)

    def test_the_tool_says_it_changes_nothing(self):
        for name, description in _file_verb_descriptions().items():
            assert "PROPOSES" in description, name
            assert "changes nothing itself" in description, name
            assert "card" in description, name

    def test_the_tool_says_the_user_decides(self):
        for name, description in _file_verb_descriptions().items():
            assert "the user accepts or dismisses" in description, name

    def test_it_is_asked_for_and_not_volunteered(self):
        for name, description in _file_verb_descriptions().items():
            assert "Propose only when the user asks for it" in description, name

    def test_it_offers_no_operation_that_is_not_bound(self):
        for name, description in _file_verb_descriptions().items():
            assert "set_doc_class" not in description and "doc_class" not in description, name

    def test_every_operation_is_described(self):
        (description,) = _file_verb_descriptions().values()
        for operation in ("`move`", "`rename`", "`create_folder`", "`assign`"):
            assert operation in description

    def test_a_name_is_taken_from_the_overview_and_never_invented(self):
        (description,) = _file_verb_descriptions().values()
        assert "exactly as the overview or a listing shows it" in description


class TestTheThreeDraftingTurnShapes:
    @pytest.fixture(autouse=True)
    def _bypass_citation_pipeline(self):
        with (
            patch.object(SourceRegistry, "all_sources", return_value=[SourceEntry(url="https://example.com")]),
            patch("agent.core.answer_pipeline.verify_citations") as mock_verify,
            patch("agent.core.answer_pipeline.sanitize_report") as mock_sanitize,
        ):
            mock_verify.side_effect = lambda content, reg, reference_sources=None, **_: MagicMock(
                verified_report=content, removed_citations=[]
            )
            mock_sanitize.side_effect = lambda content: MagicMock(sanitized_report=content)
            yield

    @pytest.fixture
    def scripted_llm(self):
        llm = MagicMock()
        llm.ainvoke = AsyncMock()
        llm.bind_tools = MagicMock(return_value=llm)
        llm.bind = MagicMock(return_value=llm)
        return llm

    @pytest.fixture
    def provider(self, scripted_llm):
        provider = MagicMock(spec=LLMProvider)
        provider.get = MagicMock(return_value=scripted_llm)
        return provider

    @pytest.fixture
    def cards(self):
        from agent.cards.registry import CardRegistry
        from agent.cards.registry import reset_card_registry
        from agent.cards.registry import set_card_registry

        registry = CardRegistry()
        token = set_card_registry(registry)
        try:
            yield registry
        finally:
            reset_card_registry(token)

    @pytest.fixture
    def working_directory(self):
        from langgraph.store.memory import InMemoryStore

        from agent.tools.documents.draft_store import DraftBackend
        from agent.tools.documents.tools import draft_tools

        backend = DraftBackend(store=InMemoryStore(), conversation_id="conv-1")
        return backend, draft_tools(backend)

    @staticmethod
    def _answer(text: str) -> AIMessage:
        import json as _json

        return AIMessage(content=f"```answer_json\n{_json.dumps({'answer': text, 'kind': 'direct'})}\n```")

    @staticmethod
    def _call(name: str, args: dict, call_id: str) -> AIMessage:
        return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": call_id}])

    def _agent(self, provider, tools):
        return ChatAgent(llm_provider=provider, tools=[web_search_tool, *tools], max_tool_iterations=1)

    async def _seed(self, backend, case):
        for path, content in case.seed.items():
            await backend.awrite(path, content)

    def _file_draft_tool(self, monkeypatch, backend, posted):
        from langchain_core.tools import StructuredTool

        from agent.tools.documents import register as filing_tools

        async def _same_backend(conversation_id: str, dsn: str | None = None):
            return backend

        monkeypatch.setattr(filing_tools, "get_draft_backend", _same_backend)
        monkeypatch.setattr(
            filing_tools,
            "post_document_version",
            lambda payload, envelope: (
                posted.append(payload),
                {"documentId": "doc-7", "version": {"id": "ver-7", "state": "draft", "contentHash": "h7"}},
            )[1],
        )
        _bind_signed_turn(monkeypatch, conversation_id="conv-1")
        return StructuredTool.from_function(
            coroutine=filing_tools.run_file_draft, name="file_draft", description="legt ab"
        )

    @pytest.mark.asyncio
    async def test_a_commission_writes_the_document_and_does_not_file_it(
        self, provider, scripted_llm, cards, working_directory
    ):
        backend, tools = working_directory
        scripted_llm.ainvoke = AsyncMock(
            side_effect=[
                self._call(
                    "write_file",
                    {
                        "file_path": SEEDED_DRAFT_PATH,
                        "content": "# Aktenvermerk – Besprechung MA 37\n\n## 3. Fluchtweg\nBesprochen.\n",
                    },
                    "1",
                ),
                self._answer("Der Aktenvermerk liegt als Entwurf in dieser Unterhaltung."),
            ]
        )
        agent = self._agent(provider, tools)

        result = await agent.run(ResearchAgentState(messages=[HumanMessage(content=COMMISSION.prompt)]))

        assert_turn_shape(
            COMMISSION,
            called_tools=_scripted_tool_names(scripted_llm),
            cards=cards.snapshot(),
            answer_meta=result.answer_meta,
            escalated=result.escalation_requested,
        )
        assert draft_cards(cards.snapshot())[-1]["version"] == 1
        assert result.answer_meta["kind"] == "direct", "the envelope's kind never reached the state"

    @pytest.mark.asyncio
    async def test_a_revision_edits_the_draft_it_was_given(self, provider, scripted_llm, cards, working_directory):
        backend, tools = working_directory
        await self._seed(backend, REVISE)
        scripted_llm.ainvoke = AsyncMock(
            side_effect=[
                self._call(
                    "edit_file",
                    {
                        "file_path": SEEDED_DRAFT_PATH,
                        "old_string": "Die Behörde hält die Länge des Fluchtwegs für klärungsbedürftig und erwartet "
                        "eine Darstellung im Einreichplan, aus der die Gehweglänge bis ins Freie hervorgeht.",
                        "new_string": "Die Gehweglänge ist im Einreichplan darzustellen.",
                    },
                    "1",
                ),
                self._answer("Punkt 3 ist auf einen Satz gekürzt."),
            ]
        )
        agent = self._agent(provider, tools)

        result = await agent.run(ResearchAgentState(messages=[HumanMessage(content=REVISE.prompt)]))

        assert_turn_shape(
            REVISE,
            called_tools=_scripted_tool_names(scripted_llm),
            cards=cards.snapshot(),
            answer_meta=result.answer_meta,
            escalated=result.escalation_requested,
        )
        stored = backend._get_store().get(("conversation", "conv-1", "drafts"), SEEDED_DRAFT_PATH)
        assert "klärungsbedürftig" not in stored.value["content"]
        assert draft_cards(cards.snapshot())[-1]["version"] == 2

    @pytest.mark.asyncio
    async def test_filing_puts_the_draft_in_the_project_and_the_card_can_act(
        self, provider, scripted_llm, cards, working_directory, monkeypatch
    ):
        backend, tools = working_directory
        await self._seed(backend, FILE)
        posted: list[dict] = []
        file_draft_tool = self._file_draft_tool(monkeypatch, backend, posted)
        scripted_llm.ainvoke = AsyncMock(
            side_effect=[
                self._call("file_draft", {"path": SEEDED_DRAFT_PATH}, "1"),
                self._answer("Der Aktenvermerk liegt als Entwurf im Projekt."),
            ]
        )
        agent = self._agent(provider, [*tools, file_draft_tool])

        result = await agent.run(ResearchAgentState(messages=[HumanMessage(content=FILE.prompt)]))

        assert_turn_shape(
            FILE,
            called_tools=_scripted_tool_names(scripted_llm),
            cards=cards.snapshot(),
            answer_meta=result.answer_meta,
            escalated=result.escalation_requested,
        )
        assert [payload["op"] for payload in posted] == ["create"]


def _scripted_tool_names(scripted_llm) -> list[str]:
    names: list[str] = []
    for call in scripted_llm.ainvoke.await_args_list:
        for message in call.args[0]:
            for tool_call in getattr(message, "tool_calls", None) or []:
                name = traced_tool_name(tool_call["name"], tool_call.get("args"))
                if name not in names:
                    names.append(name)
    return names
