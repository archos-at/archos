from __future__ import annotations

from unittest import mock
from unittest.mock import AsyncMock
from unittest.mock import MagicMock

import pytest
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage
from langchain_core.tools import tool

from agent.agents.deep_researcher.agent import DeepResearcherAgent
from agent.agents.deep_researcher.factory import WRITER_AGENT
from agent.agents.deep_researcher.models import DeepResearchAgentState
from agent.common import LLMProvider
from agent.common import LLMRole
from agent.common import cache as shared_cache
from agent.skills.resolver import SkillResolver

VOICE_BODY = "# Wie eine Antwort gebaut ist\n\nDie Zahl steht im ersten Satz."


@tool
def web_search_tool(query: str) -> str:
    return f"Results for: {query}"


@pytest.fixture(autouse=True)
def _stub_researcher_construction():

    class FakeSummarizationMiddleware(AgentMiddleware):
        pass

    researcher_runnable = MagicMock(name="researcher_runnable")
    researcher_runnable.ainvoke = AsyncMock()
    with (
        mock.patch(
            "agent.agents.deep_researcher.factory.create_summarization_middleware",
            return_value=FakeSummarizationMiddleware(),
        ),
        mock.patch(
            "agent.agents.deep_researcher.factory.create_agent",
            return_value=researcher_runnable,
        ),
    ):
        yield


@pytest.fixture(autouse=True)
def _reset_cache():
    shared_cache.reset_local_store()
    yield
    shared_cache.reset_local_store()


@pytest.fixture
def llm_provider() -> LLMProvider:
    llm = MagicMock()
    provider = LLMProvider()
    provider.set_default(llm)
    for role in (LLMRole.ROUTER, LLMRole.PLANNER, LLMRole.RESEARCHER, LLMRole.REPORT_WRITER, LLMRole.ORCHESTRATOR):
        provider.configure(role, llm)
    return provider


@pytest.fixture
def graph() -> MagicMock:
    final_state = {
        "messages": [AIMessage(content="Deep research answer")],
        "files": {
            "/shared/output.md": {
                "content": "1,10 m. Ab 12 m Absturzhöhe [1].\n\n## Sources\n[1] OIB: https://example.test/oib",
                "encoding": "utf-8",
            }
        },
    }

    compiled = MagicMock()
    compiled.with_config = MagicMock(return_value=compiled)

    def _astream(*_args, **_kwargs):
        async def _generate():
            yield final_state

        return _generate()

    compiled.astream = MagicMock(side_effect=_astream)
    return compiled


def _voice_row() -> dict[str, object]:
    return {
        "name": "piloti-voice",
        "description": "Vor dem Schreiben der Antwort laden: wie eine Piloti-Antwort gebaut ist.",
        "body": VOICE_BODY,
        "metadata": {"grid-agents": "researcher,deep_researcher", "grid-hidden": "true"},
        "standard": True,
    }


def _writer_catalog(writer: dict) -> tuple[str | None, object | None]:
    from langchain.agents.middleware.types import ModelRequest

    found = [m for m in writer["middleware"] if m.__class__.__name__ == "SkillsMiddleware"]
    if not found:
        return None, None
    middleware = found[0]
    loaded = middleware.before_agent({}, None, None) or {}
    message = middleware.modify_request(ModelRequest(model=None, messages=[], state=dict(loaded))).system_message
    return (message.text if message is not None else None), middleware


async def _prepare(agent: DeepResearcherAgent, graph: MagicMock, state: DeepResearchAgentState) -> dict:
    skill_runtime = await agent._build_skill_runtime(state)
    with mock.patch(
        "agent.agents.deep_researcher.factory.create_deep_agent",
        return_value=graph,
    ) as create:
        agent._prepare_run(state, skill_runtime)
    subagents = create.call_args.kwargs["subagents"]
    return next(spec for spec in subagents if spec["name"] == WRITER_AGENT)


@pytest.mark.asyncio
async def test_a_platform_skill_reaches_the_writer_as_a_catalog_line_and_a_body(llm_provider, graph):
    agent = DeepResearcherAgent(llm_provider=llm_provider, tools=[web_search_tool])
    state = DeepResearchAgentState(
        messages=[HumanMessage(content="Wie hoch muss das Geländer sein?")],
        organization_id="org-1",
    )

    with mock.patch.object(SkillResolver, "_fetch_org_skills", return_value=[_voice_row()]):
        skill_runtime = await agent._build_skill_runtime(state)
        with mock.patch("agent.agents.deep_researcher.factory.create_deep_agent", return_value=graph) as create:
            agent._prepare_run(state, skill_runtime)
    writer = next(spec for spec in create.call_args.kwargs["subagents"] if spec["name"] == WRITER_AGENT)

    catalog, middleware = _writer_catalog(writer)
    assert middleware.sources == ["/skills/office/"]
    assert "- **piloti-voice**:" in (catalog or "")
    assert "Read `/skills/office/piloti-voice/SKILL.md`" in (catalog or "")
    assert "Active skills" not in (catalog or "")
    assert VOICE_BODY not in (catalog or "")

    read = middleware._backend.read("/skills/office/piloti-voice/SKILL.md", 0, 1000)
    assert VOICE_BODY in read.file_data["content"]
    assert skill_runtime.activated == ("piloti-voice",)
    assert skill_runtime.hidden_activated == ("piloti-voice",)
    sanitizer = next(m for m in writer["middleware"] if m.__class__.__name__ == "ToolNameSanitizationMiddleware")
    assert "read_file" in sanitizer.valid_tool_names
    assert [item.name for item in writer["tools"]] == ["think", "get_verified_sources"]


@pytest.mark.asyncio
async def test_the_writer_keeps_its_own_lead_rule_alongside_the_voice(llm_provider, graph):
    agent = DeepResearcherAgent(llm_provider=llm_provider, tools=[web_search_tool])
    state = DeepResearchAgentState(messages=[HumanMessage(content="q")], organization_id="org-1")

    with mock.patch.object(SkillResolver, "_fetch_org_skills", return_value=[_voice_row()]):
        writer = await _prepare(agent, graph, state)

    assert "- Open with the answer." in writer["system_prompt"]


@pytest.mark.asyncio
async def test_the_writer_prompt_carries_the_diagram_contract(llm_provider, graph):
    agent = DeepResearcherAgent(llm_provider=llm_provider, tools=[web_search_tool])
    state = DeepResearchAgentState(messages=[HumanMessage(content="q")], organization_id="org-1")

    with mock.patch.object(SkillResolver, "_fetch_org_skills", return_value=[_voice_row()]):
        writer = await _prepare(agent, graph, state)

    prompt = writer["system_prompt"]
    assert "```mermaid" in prompt
    assert "`stateDiagram-v2`" in prompt
    assert "Never draw with ASCII box art" in prompt
    assert "never in colour or styling" in prompt
    assert "No label may carry a claim the report has not grounded" in prompt


@pytest.mark.asyncio
async def test_a_chat_only_platform_skill_is_not_offered_to_the_writer(llm_provider, graph):
    agent = DeepResearcherAgent(llm_provider=llm_provider, tools=[web_search_tool])
    state = DeepResearchAgentState(messages=[HumanMessage(content="q")], organization_id="org-1")
    chat_only = {**_voice_row(), "name": "chat-voice", "metadata": {"grid-agents": "researcher"}}

    with mock.patch.object(SkillResolver, "_fetch_org_skills", return_value=[chat_only]):
        writer = await _prepare(agent, graph, state)

    assert "chat-voice" not in writer["system_prompt"]
    assert _writer_catalog(writer) == (None, None)
    assert [item.name for item in writer["tools"]] == ["think", "get_verified_sources"]


@pytest.mark.asyncio
async def test_the_report_is_still_written_when_skills_cannot_be_resolved(llm_provider, graph):
    agent = DeepResearcherAgent(
        llm_provider=llm_provider,
        tools=[web_search_tool],
        enable_citation_verification=False,
    )
    state = DeepResearchAgentState(messages=[HumanMessage(content="q")], organization_id="org-1")

    with mock.patch.object(SkillResolver, "_fetch_org_skills", side_effect=RuntimeError("frontend unreachable")):
        writer = await _prepare(agent, graph, state)

        assert _writer_catalog(writer) == (None, None)
        assert [item.name for item in writer["tools"]] == ["think", "get_verified_sources"]

        with mock.patch(
            "agent.agents.deep_researcher.factory.create_deep_agent",
            return_value=graph,
        ):
            result = await agent.run(state)

    assert "1,10 m." in result.messages[-1].content
