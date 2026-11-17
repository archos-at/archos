from unittest.mock import AsyncMock
from unittest.mock import MagicMock

import pytest
from agent_testing.conversation import turn
from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage
from langchain_core.tools import tool

from agent.common import LLMProvider
from agent.common import render_prompt_template
from agent.common.data_source_registry import populate_from_config
from agent.core.agent import ChatAgent
from agent.core.agent import _shelf_label
from agent.core.models import ConversationState
from agent.core.models import ResearchAgentState

SUBJECT = "220724_Aufsicht_1_100.pdf"


@tool
def searching_tool(query: str) -> str:
    return ""


@tool
def remember_tool(fact: str) -> str:
    return "saved"


@pytest.fixture
def mock_llm():
    llm = MagicMock()
    llm.ainvoke = AsyncMock()
    llm.bind_tools = MagicMock(return_value=llm)
    return llm


@pytest.fixture
def mock_llm_provider(mock_llm):
    provider = MagicMock(spec=LLMProvider)
    provider.get = MagicMock(return_value=mock_llm)
    return provider


@pytest.fixture
def real_tool():
    return searching_tool


def _render(agent: ChatAgent, **overrides) -> str:
    kwargs = {
        "static_block": "",
        "tools": [{"name": "knowledge_search", "description": "Search the knowledge base"}],
        "user_info": None,
        "current_datetime": "2026-08-18",
        "available_documents": [],
        "project_context": None,
    }
    kwargs.update(overrides)
    return render_prompt_template(agent.system_prompt, **kwargs)


class TestChatAgentPromptNamesTheSubject:
    def test_focused_file_is_named_with_its_shelf(self, mock_llm_provider, real_tool):
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[real_tool])

        rendered = _render(agent, focus_file_name=SUBJECT, focus_shelf_label="Projektwissen")

        assert SUBJECT in rendered
        assert "Projektwissen" in rendered
        assert "never ask which file is meant" in rendered

    def test_the_block_states_the_fact_and_leaves_the_procedure_to_the_tool(self, mock_llm_provider, real_tool):
        from knowledge_layer.register import _KNOWLEDGE_SEARCH_DESCRIPTION

        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[real_tool])

        rendered = _render(agent, focus_file_name=SUBJECT, focus_shelf_label="Projektwissen")

        assert f'file_name="{SUBJECT}"' not in rendered
        assert "`file_name=` (an indexed name" in _KNOWLEDGE_SEARCH_DESCRIPTION

    def test_shelf_is_omitted_rather_than_invented(self, mock_llm_provider, real_tool):
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[real_tool])

        rendered = _render(agent, focus_file_name=SUBJECT, focus_shelf_label=None)

        assert f"## This turn's subject: **{SUBJECT}**\n" in rendered

    def test_no_subject_renders_no_subject_block(self, mock_llm_provider, real_tool):
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[real_tool])

        rendered = _render(agent, focus_file_name=None, focus_shelf_label=None)

        assert "This turn's subject" not in rendered

    def test_render_survives_callers_that_pass_no_focus_at_all(self, mock_llm_provider, real_tool):
        agent = ChatAgent(llm_provider=mock_llm_provider, tools=[real_tool])

        rendered = _render(agent)

        assert "This turn's subject" not in rendered


class TestShelfLabel:
    @pytest.mark.parametrize(
        ("shelf", "expected"),
        [
            ("project", "Projektwissen"),
            ("office_shelf", "Büroablage"),
            ("session", "Private Sitzung"),
            ("base", "Basiswissen"),
            (None, None),
            ("", None),
            ("nonsense", None),
        ],
    )
    def test_labels_match_the_inventory_vocabulary(self, shelf, expected):
        assert _shelf_label(shelf) == expected


class TestSubjectKeepsTheSearchTools:
    @pytest.mark.asyncio
    async def test_a_bare_summary_request_with_a_subject_has_the_search_tools(self, mock_llm_provider, mock_llm):
        populate_from_config(
            [
                {
                    "id": "web_search",
                    "name": "Web Search",
                    "description": "Search the web.",
                    "tools": ["searching_tool"],
                }
            ],
        )
        mock_llm.ainvoke = AsyncMock(side_effect=[AIMessage(content="Zusammenfassung.")])

        agent = ChatAgent(
            llm_provider=mock_llm_provider,
            tools=[searching_tool, remember_tool],
        )
        mock_llm.bind_tools.reset_mock()

        state = ResearchAgentState(
            messages=[HumanMessage(content="fass zusammen")],
            focus_file_name=SUBJECT,
            focus_shelf="project",
        )
        await agent.run(state)

        assert "searching_tool" in [tool["name"] for tool in agent._boot.tools_info]


class TestSubjectSurvivesTheGraphHandoff:
    @pytest.mark.asyncio
    async def test_shallow_node_forwards_the_subject(self):
        from agent.core.conversation import ConversationGraph

        captured: dict = {}

        async def shallow(state):
            captured["focus_file_name"] = state.focus_file_name
            captured["focus_shelf"] = state.focus_shelf
            return ResearchAgentState(
                messages=list(state.messages) + [AIMessage(content="Zusammenfassung.")],
                escalation_requested=False,
            )

        async def unused(state):  # pragma: no cover — the route never reaches these
            raise AssertionError("shallow turn must not escalate")

        agent = ConversationGraph(
            research_fn=shallow,
            deep_research_fn=unused,
            clarifier_fn=unused,
        )

        await turn(
            agent,
            ConversationState(
                messages=[HumanMessage(content="fass zusammen")],
                focus_file_name=SUBJECT,
                focus_shelf="project",
            ),
        )

        assert captured == {"focus_file_name": SUBJECT, "focus_shelf": "project"}
