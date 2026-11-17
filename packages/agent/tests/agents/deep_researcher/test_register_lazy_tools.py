from unittest.mock import AsyncMock
from unittest.mock import MagicMock
from unittest.mock import patch

import pytest
from langchain_core.tools import tool

from agent.agents.deep_researcher import register as register_module
from agent.agents.deep_researcher.models import DeepResearchAgentState
from agent.agents.deep_researcher.register import DeepResearchAgentConfig
from agent.agents.deep_researcher.register import deep_research_agent
from tests.provider_doubles import NAT_LLM_CONFIG
from tests.provider_doubles import nat_langchain_client


@tool
def web_search_tool(query: str) -> str:
    return f"results: {query}"


class _FakeBuilder:
    def __init__(self, tools_by_name):
        self._tools_by_name = tools_by_name
        self.get_tools_calls = []

    async def get_tools(self, tool_names, wrapper_type):
        self.get_tools_calls.append(list(tool_names))
        return [self._tools_by_name[n] for n in tool_names if n in self._tools_by_name]

    async def get_llm(self, ref, wrapper_type):
        return nat_langchain_client(MagicMock())

    def get_llm_config(self, ref):
        return NAT_LLM_CONFIG

    def get_function_config(self, ref):
        return None


def _make_agent_stub():

    def _factory(*args, **kwargs):
        agent = MagicMock()
        agent.run = AsyncMock(side_effect=lambda state: state)
        agent._init_tools = kwargs.get("tools")
        return agent

    return _factory


async def _get_run_fn(config, builder):
    gen = deep_research_agent.__wrapped__(config, builder)
    function_info = await gen.__anext__()
    return function_info.single_fn, gen


@pytest.mark.asyncio
async def test_inherited_tools_resolved_lazily_after_registry_populated():
    builder = _FakeBuilder({"web_search_tool": web_search_tool})
    config = DeepResearchAgentConfig(orchestrator_llm="orch_llm", tools=[])

    with patch.object(register_module, "DeepResearcherAgent", _make_agent_stub()):
        with patch.object(register_module, "get_all_tool_refs", return_value=[]):
            run_fn, gen = await _get_run_fn(config, builder)
            assert builder.get_tools_calls == []

            result = await run_fn(DeepResearchAgentState(messages=[]))
            assert result.messages  # error AIMessage placed by the runtime gate

        with patch.object(register_module, "get_all_tool_refs", return_value=["web_search_tool"]):
            result2 = await run_fn(DeepResearchAgentState(messages=[]))
            assert result2 is not None
            assert ["web_search_tool"] in builder.get_tools_calls

        await gen.aclose()


@pytest.mark.asyncio
async def test_explicit_tools_resolved_eagerly_and_registry_never_consulted():
    builder = _FakeBuilder({"web_search_tool": web_search_tool})
    config = DeepResearchAgentConfig(orchestrator_llm="orch_llm", tools=["web_search_tool"])

    get_all = MagicMock(return_value=[])
    with (
        patch.object(register_module, "DeepResearcherAgent", _make_agent_stub()),
        patch.object(register_module, "get_all_tool_refs", get_all),
    ):
        run_fn, gen = await _get_run_fn(config, builder)
        assert builder.get_tools_calls == [["web_search_tool"]]

        result = await run_fn(DeepResearchAgentState(messages=[]))
        assert result is not None
        get_all.assert_not_called()

        await gen.aclose()
