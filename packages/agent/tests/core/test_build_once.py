from __future__ import annotations

from unittest.mock import AsyncMock
from unittest.mock import MagicMock
from unittest.mock import patch

import pytest
from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage
from langchain_core.tools import tool

import agent.core.register as register_module
from agent.citations.entries import SourceEntry
from agent.citations.registry import SourceRegistry
from agent.common import LLMProvider
from agent.core import prompt as prompt_module
from agent.core.agent import ChatAgent
from agent.core.models import ResearchAgentState
from agent.core.register import ResearchAgentConfig
from agent.core.register import research_agent
from agent.core.turn_binding import TurnConfig
from agent.core.turn_binding import _recursion_limit
from tests.provider_doubles import NAT_LLM_CONFIG
from tests.provider_doubles import nat_langchain_client


@tool(description="Search the web.")
def web_search_tool(query: str) -> str:
    return f"results: {query}"


class _FakeBuilder:
    def __init__(self, llm):
        self._llm = llm

    async def get_tools(self, tool_names, wrapper_type):
        return [web_search_tool]

    async def get_llm(self, ref, wrapper_type):
        return nat_langchain_client(self._llm)

    def get_llm_config(self, ref):
        return NAT_LLM_CONFIG


def _mock_llm():
    llm = MagicMock()
    llm.bind_tools = MagicMock(return_value=llm)
    llm.bind = MagicMock(return_value=llm)
    llm.ainvoke = AsyncMock(return_value=AIMessage(content="Die Antwort [1]."))
    return llm


def _skill_runtime():
    from agent.skills.backend import SkillsBackend

    runtime = MagicMock()
    runtime.prompt_block.return_value = "## Skills"
    runtime.backend = SkillsBackend({})
    runtime.activated = []
    runtime.pinned = ()
    runtime.hidden_activated = ()
    return runtime


@pytest.fixture(autouse=True)
def _bypass_citation_pipeline():
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


@pytest.fixture
def counters(monkeypatch):
    counts = {"prompt_reads": 0, "graph_compiles": 0, "agents_built": 0}
    real_load = prompt_module.load_prompt
    real_build = ChatAgent._build_graph
    real_init = ChatAgent.__init__

    def counting_load(path, name):
        counts["prompt_reads"] += 1
        return real_load(path, name)

    def counting_build(self):
        counts["graph_compiles"] += 1
        return real_build(self)

    def counting_init(self, *args, **kwargs):
        counts["agents_built"] += 1
        real_init(self, *args, **kwargs)

    prompt_module.system_prompt_template.cache_clear()
    prompt_module.bundled_static_block.cache_clear()
    monkeypatch.setattr(prompt_module, "load_prompt", counting_load)
    monkeypatch.setattr(ChatAgent, "_build_graph", counting_build)
    monkeypatch.setattr(ChatAgent, "__init__", counting_init)
    yield counts
    prompt_module.system_prompt_template.cache_clear()
    prompt_module.bundled_static_block.cache_clear()


@pytest.mark.asyncio
async def test_two_skills_turns_build_one_agent_read_the_prompt_once_and_compile_once(counters):
    llm = _mock_llm()
    config = ResearchAgentConfig(llm="research_llm", tools=["web_search_tool"], skills_enabled=True)
    runtime = _skill_runtime()

    with (
        patch.object(register_module, "get_organization_id_from_context", return_value="org-1"),
        patch.object(register_module, "SkillRuntime", MagicMock(office=MagicMock(return_value=runtime))),
        patch.object(register_module, "SkillResolver") as ResolverCls,
    ):
        ResolverCls.return_value.resolve.return_value = (MagicMock(name="piloti-voice"),)
        gen = research_agent.__wrapped__(config, _FakeBuilder(llm))
        run_fn = (await gen.__anext__()).single_fn
        try:
            first = await run_fn(ResearchAgentState(messages=[HumanMessage(content="Wie tief?")]))
            second = await run_fn(ResearchAgentState(messages=[HumanMessage(content="Und wie hoch?")]))
        finally:
            await gen.aclose()

    assert first.messages[-1].content == "Die Antwort [1]."
    assert second.messages[-1].content == "Die Antwort [1]."
    assert counters == {"prompt_reads": 2, "graph_compiles": 1, "agents_built": 1}
    assert llm.bind_tools.call_count == 1 + 2
    bound_names = [[t.name for t in call.args[0]] for call in llm.bind_tools.call_args_list]
    assert bound_names[0] == ["web_search_tool"]
    assert bound_names[1] == ["web_search_tool", "read_file"]


@pytest.mark.asyncio
async def test_a_turn_that_varies_nothing_reuses_the_boot_binding():
    llm = _mock_llm()
    provider = MagicMock(spec=LLMProvider)
    provider.get = MagicMock(return_value=llm)
    agent = ChatAgent(llm_provider=provider, tools=[web_search_tool])
    llm.bind_tools.reset_mock()

    await agent.run(ResearchAgentState(messages=[HumanMessage(content="Q")]))
    await agent.run(
        ResearchAgentState(messages=[HumanMessage(content="Q")]),
        turn=TurnConfig(llm_provider=provider, tools=[web_search_tool]),
    )

    llm.bind_tools.assert_not_called()


@pytest.mark.asyncio
async def test_the_ceiling_is_the_research_budget_and_nothing_is_added_to_it():
    llm = _mock_llm()
    provider = MagicMock(spec=LLMProvider)
    provider.get = MagicMock(return_value=llm)
    agent = ChatAgent(llm_provider=provider, tools=[web_search_tool], max_tool_iterations=3)
    assert agent.tool_iteration_ceiling == 3
    assert "reserved_tool_iterations" not in TurnConfig.__dataclass_fields__

    spent = ResearchAgentState(messages=[HumanMessage(content="Wie tief?")], tool_iterations=3)
    truncated = await agent.run(spent.model_copy(deep=True))
    still_truncated = await agent.run(
        spent.model_copy(deep=True), turn=TurnConfig(llm_provider=provider, tools=[web_search_tool])
    )

    assert truncated.research_truncated is True
    assert still_truncated.research_truncated is True


def test_the_recursion_guard_is_derived_from_the_ceiling():
    for ceiling in (0, 5, 7):
        assert _recursion_limit(ceiling) > 2 * ceiling + 1
    assert _recursion_limit(5) == (5 * 2) + 10
    assert _recursion_limit(5) < _recursion_limit(7)
