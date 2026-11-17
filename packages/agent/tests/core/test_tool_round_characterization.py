from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock
from unittest.mock import MagicMock
from unittest.mock import patch

import pytest
from agent_testing.conversation import turn
from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage
from langchain_core.messages import ToolMessage
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver

from agent.agents.deep_researcher.models import DeepResearchAgentState
from agent.citations.entries import SourceEntry
from agent.citations.registry import SourceRegistry
from agent.common import LLMProvider
from agent.common import turn_status
from agent.common.data_source_registry import populate_from_config
from agent.common.data_source_registry import reset_registry
from agent.common.data_sources import disabled_source_notice
from agent.common.steering import HELD_FOR_STEER
from agent.common.steering import SteerInbox
from agent.common.steering import SteerNote
from agent.common.steering import bind_steer_inbox
from agent.common.steering import unbind_steer_inbox
from agent.common.tool_calls import FETCH_FAILED_MARKER
from agent.common.tool_errors import FAILURE_IS_NOT_A_FACT
from agent.core.agent import _FAILED_FETCH_REPEAT_MESSAGE
from agent.core.agent import _REPEAT_FETCH_PREFIX
from agent.core.agent import _WIDTH_CAP_MESSAGE
from agent.core.agent import ChatAgent
from agent.core.agent import TurnConfig
from agent.core.conversation import ConversationGraph
from agent.core.models import ConversationState
from agent.core.models import ResearchAgentState
from agent.knowledge import restricted_use as ru
from agent.knowledge.restricted_use import WITHHELD_NOTICE
from agent.knowledge.restricted_use import RestrictedUse
from agent.knowledge.restricted_use import bind_restricted_use
from agent.knowledge.restricted_use import reset_restricted_use

_PROMPT = "Du bist der Agent."
_ANSWER = AIMessage(content='```answer_json\n{"answer": "Fertig.", "kind": "walkthrough"}\n```')

RAN: list[str] = []
FAILING_QUERIES: set[str] = set()


@tool
def knowledge_search(query: str) -> str:
    if query in FAILING_QUERIES:
        FAILING_QUERIES.discard(query)
        RAN.append(f"knowledge_search:{query}:failed")
        return f"{FETCH_FAILED_MARKER} Knowledge search failed for query={query!r}."
    RAN.append(f"knowledge_search:{query}")
    return f"Treffer zu: {query}"


@tool
def read_passage(document: str, clause: str | None = None) -> str:
    RAN.append(f"read_passage:{document}|{clause or ''}")
    return f"Passage aus {document} {clause or ''}".strip()


@tool
def web_search_tool(query: str) -> str:
    RAN.append(f"web_search_tool:{query}")
    return f"Web-Treffer zu: {query}"


@tool("canvas__mark")
def mark(target: str) -> str:
    RAN.append(f"mark:{target}")
    return f"Vorgeschlagen: {target}"


@pytest.fixture(autouse=True)
def _clean_slate():
    RAN.clear()
    FAILING_QUERIES.clear()
    turn_status._retrieval_round.set(None)
    reset_registry()
    populate_from_config(
        [{"id": "web_search", "name": "Web-Suche", "description": "Search the web.", "tools": ["web_search_tool"]}]
    )
    yield
    reset_registry()
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
def inbox():
    box = SteerInbox()
    token = bind_steer_inbox(box)
    yield box
    unbind_steer_inbox(token)


def _call(name: str, call_id: str, **args: Any) -> dict:
    return {"name": name, "args": args, "id": call_id}


def _agent(replies: Any, tools: list[Any], **kwargs: Any) -> ChatAgent:
    llm = MagicMock()
    llm.bind_tools = MagicMock(return_value=llm)
    llm.bind = MagicMock(return_value=llm)
    llm.ainvoke = AsyncMock(side_effect=replies)
    provider = MagicMock(spec=LLMProvider)
    provider.get = MagicMock(return_value=llm)
    return ChatAgent(llm_provider=provider, tools=tools, system_prompt=_PROMPT, max_tool_iterations=7, **kwargs)


def _transcript(result: ResearchAgentState) -> list[tuple[str, str]]:
    return [(str(m.tool_call_id), str(m.content)) for m in result.messages if isinstance(m, ToolMessage)]


class TestInnerGraphCheckpoints:
    async def test_the_inner_graph_checkpoints_into_the_outer_saver(self):
        inner_agent = _agent(
            [AIMessage(content="", tool_calls=[_call("knowledge_search", "k1", query="Q")]), _ANSWER],
            [knowledge_search],
        )

        async def research(state: ResearchAgentState) -> ResearchAgentState:
            return await inner_agent.run(state)

        async def deep(state: DeepResearchAgentState) -> DeepResearchAgentState:  # pragma: no cover
            raise AssertionError("deep research must not run")

        saver = InMemorySaver()
        graph = ConversationGraph(research_fn=research, deep_research_fn=deep, clarifier_fn=None, checkpointer=saver)
        await turn(graph, ConversationState(messages=[HumanMessage(content="Was steht drin?")]), thread_id="t1")

        items = [i async for i in saver.alist(None)]
        print("NS", sorted(i.config["configurable"].get("checkpoint_ns", "").split(":")[0] for i in items))
        namespaces = [item.config["configurable"].get("checkpoint_ns", "") async for item in saver.alist(None)]
        assert RAN == ["knowledge_search:Q"]
        assert namespaces.count("") == 3
        inner = [ns for ns in namespaces if ns]
        assert len(inner) == 6
        assert all(ns.startswith("shallow_research:") for ns in inner)
        assert len(set(inner)) == 1


class TestOneMixedRound:
    async def test_every_way_a_call_is_answered_in_one_round(self, inbox, emitted):
        FAILING_QUERIES.add("kaputt")
        replies = [
            AIMessage(content="", tool_calls=[_call("knowledge_search", "s0", query="Fluchtweg")]),
            AIMessage(
                content="",
                tool_calls=[
                    _call("knowledge_search", "k1", query="kaputt"),
                    _call("knowledge_search", "k2", query="kaputt"),
                    _call("knowledge_search", "r1", query="Fluchtweg"),
                    _call("web_search_tool", "w1", query="Fluchtweg"),
                    _call("canvas__mark", "m1", target="Tür"),
                    _call("read_passage", "p1", document="OIB-RL 4", clause="2.1"),
                    _call("read_passage", "p2", document="OIB-RL 4", clause="2.2"),
                ],
            ),
            _ANSWER,
        ]
        decisions: list[int] = []

        async def model(*_args: Any, **_kwargs: Any) -> AIMessage:
            decisions.append(len(decisions))
            if len(decisions) == 2:
                inbox.offer(SteerNote(steer_id="s1", text="nicht die Tür", author="Anna"))
            return replies[len(decisions) - 1]

        agent = _agent(model, [knowledge_search, read_passage, web_search_tool, mark], max_calls_per_round=3)

        result = await agent.run(
            ResearchAgentState(messages=[HumanMessage(content="Wie lang darf der Fluchtweg sein?")]),
            turn=TurnConfig(disabled_sources=frozenset({"web_search"})),
        )

        assert RAN[0] == "knowledge_search:Fluchtweg"
        assert sorted(RAN[1:]) == ["knowledge_search:kaputt:failed", "read_passage:OIB-RL 4|2.1"]
        assert _transcript(result) == [
            ("s0", "Treffer zu: Fluchtweg"),
            ("k1", f"{FETCH_FAILED_MARKER} Knowledge search failed for query='kaputt'."),
            ("p1", "Passage aus OIB-RL 4 2.1"),
            ("k2", _FAILED_FETCH_REPEAT_MESSAGE),
            ("r1", f"{_REPEAT_FETCH_PREFIX}\n\nTreffer zu: Fluchtweg"),
            ("w1", disabled_source_notice("web_search_tool", frozenset({"web_search"}), {"query": "Fluchtweg"})),
            ("p2", _WIDTH_CAP_MESSAGE),
            ("m1", HELD_FOR_STEER),
        ]
        assert "Web-Suche is switched off" in dict(_transcript(result))["w1"]
        assert result.tool_iterations == 2
        assert emitted_steps(emitted) == [
            "status:retrieval:0",
            "status:checkpoint:0",
            "status:repeat:1",
            "status:refused:1",
            "status:width:1",
            "status:retrieval:1",
            "status:checkpoint:1",
            "status:steered:2",
            "status:synthesis",
            "status:citations",
        ]


def emitted_steps(emitted: Any) -> list[str]:
    return [step.id for step in emitted.steps]


class TestTwoRestrictedResultsOneAdmission:
    async def test_one_admit_call_names_both_collections(self, monkeypatch):
        first, second = "proj_p1_r0123456789ab", "proj_p1_rba9876543210"

        @tool("knowledge_search")
        def restricted_search(query: str) -> str:
            collection = first if query == "Honorar" else second
            return (
                "Found 1 relevant document(s):\n\n--- Result 1 ---\n"
                f"Source: {query}\nCitation: {query}.pdf, p.1\nCollection: {collection}\n\nInhalt zu {query}.\n"
            )

        asked: list[dict] = []

        def post(_use, body):
            asked.append(body)
            return {"admitted": [first], "refused": [second]}

        monkeypatch.setattr(ru, "_post", post)
        use = RestrictedUse(
            organization_id="org", user_id="u1", conversation_id="c1", project_id="p1", drawable={first, second}
        )
        agent = _agent(
            [
                AIMessage(
                    content="",
                    tool_calls=[
                        _call("knowledge_search", "a", query="Honorar"),
                        _call("knowledge_search", "b", query="Termine"),
                    ],
                ),
                _ANSWER,
            ],
            [restricted_search],
        )
        token = bind_restricted_use(use)
        try:
            result = await agent.run(ResearchAgentState(messages=[HumanMessage(content="Honorar und Termine?")]))
        finally:
            reset_restricted_use(token)

        assert asked == [{"admit": sorted([first, second])}]
        transcript = dict(_transcript(result))
        assert "Inhalt zu Honorar." in transcript["a"]
        assert transcript["b"] == WITHHELD_NOTICE


class TestWhatAFailedCallSays:
    async def test_a_schema_invalid_call_and_a_raising_tool(self):
        @tool
        def explode(query: str) -> str:
            raise RuntimeError("store rejected the filter")

        agent = _agent(
            [
                AIMessage(
                    content="",
                    tool_calls=[
                        _call("read_passage", "bad", clause=3),
                        _call("explode", "boom", query="x"),
                    ],
                ),
                _ANSWER,
            ],
            [read_passage, explode],
        )

        result = await agent.run(ResearchAgentState(messages=[HumanMessage(content="Was steht in 2.1?")]))

        assert dict(_transcript(result)) == {
            "bad": (
                "Error: the call was rejected. document: Field required; clause: Input should be a valid "
                "string (got 3). Fix the arguments and call again."
            ),
            "boom": f"Error: RuntimeError: store rejected the filter. {FAILURE_IS_NOT_A_FACT}",
        }
