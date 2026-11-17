from __future__ import annotations

from unittest.mock import AsyncMock
from unittest.mock import MagicMock
from unittest.mock import patch

import pytest
from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage
from langchain_core.messages import ToolMessage
from langchain_core.tools import tool

from agent.citations.entries import SourceEntry
from agent.citations.registry import SourceRegistry
from agent.common import LLMProvider
from agent.common import turn_status
from agent.common.data_source_registry import populate_from_config
from agent.common.data_source_registry import reset_registry
from agent.common.data_sources import disabled_source_notice
from agent.common.data_sources import unavailable_source_ids
from agent.common.prompt_caching import prompt_cache_key
from agent.core.agent import ChatAgent
from agent.core.agent import TurnConfig
from agent.core.models import ResearchAgentState

_PROMPT = "Du bist der Agent."

RAN: list[str] = []


@tool(description="Search the web.")
def web_search_tool(query: str) -> str:
    RAN.append(f"web_search_tool:{query}")
    return f"Web-Treffer zu: {query}"


@tool(description="Search the OIB knowledge corpus.")
def knowledge_search(query: str) -> str:
    RAN.append(f"knowledge_search:{query}")
    return f"Treffer zu: {query}"


@tool(description="Look up Austrian law in RIS.")
def ris_lookup_tool(question: str) -> str:
    RAN.append(f"ris_lookup_tool:{question}")
    return f"RIS-Treffer zu: {question}"


@tool(description="Emit a UI card.")
def emit_card(kind: str) -> str:
    RAN.append(f"emit_card:{kind}")
    return "Karte erstellt"


_TOOLS = [web_search_tool, knowledge_search, ris_lookup_tool, emit_card]


@pytest.fixture(autouse=True)
def _registry():
    reset_registry()
    populate_from_config(
        [
            {
                "id": "web_search",
                "name": "Web-Suche",
                "description": "Search the web.",
                "tools": ["web_search_tool"],
            },
            {
                "id": "knowledge_layer",
                "name": "Wissensbasis",
                "description": "Search documents.",
                "tools": ["knowledge_search"],
            },
            {
                "id": "ris",
                "name": "RIS – Österreichisches Recht",
                "description": "Austrian law.",
                "tools": ["ris_lookup_tool"],
            },
        ]
    )
    yield
    reset_registry()


@pytest.fixture(autouse=True)
def _clean_slate():
    RAN.clear()
    turn_status._retrieval_round.set(None)
    yield
    RAN.clear()
    turn_status._retrieval_round.set(None)


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
def steps(emitted):
    return emitted


def _call(name: str, call_id: str, **args) -> dict:
    return {"name": name, "args": args, "id": call_id}


def _batch(*calls: dict) -> AIMessage:
    return AIMessage(content="", tool_calls=list(calls))


def _agent(*rounds: AIMessage) -> tuple[ChatAgent, MagicMock]:
    llm = MagicMock()
    llm.bind_tools = MagicMock(return_value=llm)
    llm.bind = MagicMock(return_value=llm)
    llm.ainvoke = AsyncMock(side_effect=list(rounds))
    provider = MagicMock(spec=LLMProvider)
    provider.get = MagicMock(return_value=llm)
    agent = ChatAgent(
        llm_provider=provider,
        tools=_TOOLS,
        system_prompt=_PROMPT,
        max_tool_iterations=7,
    )
    return agent, llm


async def _run(agent: ChatAgent, disabled: set[str]):
    return await agent.run(
        ResearchAgentState(messages=[HumanMessage(content="Was steht im Web dazu?")]),
        turn=TurnConfig(disabled_sources=frozenset(disabled)),
    )


def _answer_for(result, call_id: str) -> str:
    (message,) = [m for m in result.messages if isinstance(m, ToolMessage) and m.tool_call_id == call_id]
    return str(message.content)


class TestTheCallIsRefusedNotRemoved:
    async def test_the_tool_is_still_bound(self):
        agent, llm = _agent(AIMessage(content="Die Antwort [1]."))

        await _run(agent, {"web_search"})

        (bound,) = [call.args[0] for call in llm.bind_tools.call_args_list]
        assert [t.name for t in bound] == [
            "web_search_tool",
            "knowledge_search",
            "ris_lookup_tool",
            "emit_card",
        ]

    async def test_a_call_to_a_switched_off_source_does_not_run(self):
        agent, _llm = _agent(
            _batch(_call("web_search_tool", "w", query="OIB 2")),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent, {"web_search"})

        assert RAN == []
        answer = _answer_for(result, "w")
        assert "Web-Suche" in answer, "the refusal must name the source the reader turned off"
        assert "switched off" in answer
        assert "was not consulted" in answer

    async def test_the_rest_of_the_round_still_runs(self):
        agent, _llm = _agent(
            _batch(
                _call("web_search_tool", "w", query="OIB 2"),
                _call("knowledge_search", "k", query="OIB 2"),
            ),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent, {"web_search"})

        assert RAN == ["knowledge_search:OIB 2"]
        assert _answer_for(result, "k") == "Treffer zu: OIB 2"
        assert "switched off" in _answer_for(result, "w")

    async def test_a_tool_belonging_to_no_source_is_never_refused(self):
        agent, _llm = _agent(
            _batch(_call("emit_card", "c", kind="verdict_header")),
            AIMessage(content="Die Antwort [1]."),
        )

        await _run(agent, {"web_search", "knowledge_layer", "ris"})

        assert RAN == ["emit_card:verdict_header"]

    async def test_every_call_still_gets_exactly_one_result(self):
        agent, _llm = _agent(
            _batch(
                _call("web_search_tool", "w", query="OIB 2"),
                _call("knowledge_search", "k", query="OIB 2"),
            ),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent, {"web_search"})

        asked = [call["id"] for m in result.messages if isinstance(m, AIMessage) for call in (m.tool_calls or [])]
        answered = [m.tool_call_id for m in result.messages if isinstance(m, ToolMessage)]
        assert sorted(answered) == sorted(asked)


class TestWhatARefusedRoundCosts:
    async def test_a_refused_round_costs_one_round_and_announces_no_retrieval(self, steps):
        agent, _llm = _agent(
            _batch(_call("web_search_tool", "w", query="OIB 2")),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent, {"web_search"})

        assert result.tool_iterations == 1
        assert [step.id for step in steps.steps if step.id.startswith("status:retrieval")] == []

    async def test_the_refusal_is_reported_as_its_own_technical_event(self, steps):
        agent, _llm = _agent(
            _batch(
                _call("web_search_tool", "w", query="OIB 2"),
                _call("knowledge_search", "k", query="OIB 2"),
            ),
            AIMessage(content="Die Antwort [1]."),
        )

        await _run(agent, {"web_search"})

        (record,) = [step for step in steps.steps if step.id.startswith("status:refused")]
        assert record.id == "status:refused:0"
        assert (record.detail["round"], record.detail["withheld"]) == (0, 1)
        assert record.channel == turn_status.CHANNEL_TECHNICAL
        assert "key" not in record

    async def test_a_round_with_nothing_refused_leaves_no_record(self, steps):
        agent, _llm = _agent(
            _batch(_call("knowledge_search", "k", query="OIB 2")),
            AIMessage(content="Die Antwort [1]."),
        )

        await _run(agent, {"web_search"})

        assert [step for step in steps.steps if step.id.startswith("status:refused")] == []


class TestOneCacheShardPerOrgAndModel:
    async def test_two_turns_with_different_toggles_share_a_prompt_cache_key(self):
        agent_a, llm_a = _agent(AIMessage(content="Die Antwort [1]."))
        agent_b, llm_b = _agent(AIMessage(content="Die Antwort [1]."))

        await _run(agent_a, {"web_search"})
        await _run(agent_b, {"ris", "knowledge_layer"})

        tools_a = [t.name for t in llm_a.bind_tools.call_args_list[0].args[0]]
        tools_b = [t.name for t in llm_b.bind_tools.call_args_list[0].args[0]]
        key_a = prompt_cache_key(system_prompt=_PROMPT, tools=tools_a, organization_id="org-1", model="m")
        key_b = prompt_cache_key(system_prompt=_PROMPT, tools=tools_b, organization_id="org-1", model="m")
        assert key_a == key_b, "a toggle still splits the cache shard"

    def test_a_different_tool_set_still_splits_it(self):
        base = prompt_cache_key(system_prompt=_PROMPT, tools=["a", "b"], organization_id="org-1", model="m")
        fewer = prompt_cache_key(system_prompt=_PROMPT, tools=["a"], organization_id="org-1", model="m")
        assert base != fewer


class TestTheHelperIsTheOnePlaceThatDecides:
    def test_it_resolves_the_tool_through_the_registry(self):
        assert disabled_source_notice("web_search_tool", {"web_search"}) is not None
        assert disabled_source_notice("knowledge_search", {"web_search"}) is None
        assert disabled_source_notice("emit_card", {"web_search"}) is None

    def test_nothing_disabled_never_refuses(self):
        assert disabled_source_notice("web_search_tool", set()) is None

    def test_the_selection_and_the_org_toggle_are_one_set(self):
        assert unavailable_source_ids(["knowledge_layer"], disabled_sources=set()) == frozenset({"web_search", "ris"})
        assert unavailable_source_ids(None, disabled_sources={"web_search"}) == frozenset({"web_search"})
        assert unavailable_source_ids(["knowledge_layer"], disabled_sources={"knowledge_layer"}) == frozenset(
            {"web_search", "ris", "knowledge_layer"}
        )

    def test_selecting_nothing_switches_every_source_off(self):
        assert unavailable_source_ids([], disabled_sources=set()) == frozenset({"web_search", "knowledge_layer", "ris"})
