from __future__ import annotations

from unittest.mock import AsyncMock
from unittest.mock import MagicMock
from unittest.mock import patch

import pytest
from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage
from langchain_core.tools import tool

from agent.citations.entries import SourceEntry
from agent.citations.registry import SourceRegistry
from agent.common import LLMProvider
from agent.common import turn_status
from agent.common.turn_status import current_retrieval_round
from agent.core.agent import ChatAgent
from agent.core.models import ResearchAgentState

SEEN: list[tuple[str, int | None]] = []


@tool
def knowledge_search(query: str) -> str:
    SEEN.append(("knowledge_search", current_retrieval_round()))
    turn_status.record_lane_hit(f"{query}.pdf", title=f"Treffer zu {query}")
    return f"Treffer zu: {query}"


@tool
def read_passage(document: str, clause: str = "") -> str:
    SEEN.append(("read_passage", current_retrieval_round()))
    turn_status.record_lane_hit(f"{document}.pdf", detail=f"p.{clause}" if clause else None)
    return f"{document}, Pkt. {clause}"


@tool
def remember(text: str) -> str:
    SEEN.append(("remember", current_retrieval_round()))
    return "gemerkt"


@pytest.fixture(autouse=True)
def _clean_slate():
    SEEN.clear()
    turn_status._retrieval_round.set(None)
    yield
    SEEN.clear()
    turn_status._retrieval_round.set(None)


@pytest.fixture
def scripted_agent():

    def build(*rounds: AIMessage) -> ChatAgent:
        llm = MagicMock()
        llm.bind_tools = MagicMock(return_value=llm)
        llm.bind = MagicMock(return_value=llm)
        llm.ainvoke = AsyncMock(side_effect=list(rounds))
        provider = MagicMock(spec=LLMProvider)
        provider.get = MagicMock(return_value=llm)
        return ChatAgent(
            llm_provider=provider,
            tools=[knowledge_search, read_passage, remember],
            max_tool_iterations=6,
        )

    return build


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


def _search(call_id: str, query: str, thought: str = "") -> AIMessage:
    return AIMessage(
        content=thought,
        tool_calls=[{"name": "knowledge_search", "args": {"query": query}, "id": call_id}],
    )


class TestTheRoundStampReachesTheTool:
    @pytest.mark.asyncio
    async def test_each_search_round_stamps_its_own_number(self, scripted_agent):
        agent = scripted_agent(
            _search("k1", "Fluchtweglänge GK4", "Ich brauche zuerst die Grundregel."),
            AIMessage(content="", tool_calls=[{"name": "remember", "args": {"text": "GK4"}, "id": "r1"}]),
            _search("k2", "Treppenraum Entrauchung", "Die Grundregel steht; jetzt der Treppenraum."),
            AIMessage(content="Die Antwort [1]."),
        )

        await agent.run(ResearchAgentState(messages=[HumanMessage(content="Wie lang darf der Fluchtweg sein?")]))

        assert SEEN == [
            ("knowledge_search", 0),
            ("remember", None),
            ("knowledge_search", 1),
        ], (
            "the round stamp did not survive the agent→tools node boundary "
            "(LangGraph copies the context per node), so every hit ships "
            f"unstamped and the Herleitung falls back to stream order; saw {SEEN}"
        )

    @pytest.mark.asyncio
    async def test_a_search_then_a_locator_are_two_layers_of_one_spine(self, scripted_agent):
        agent = scripted_agent(
            _search("k1", "Fluchtweglänge GK4", "Ich brauche zuerst die Grundregel."),
            AIMessage(
                content="Die Grundregel verweist auf Pkt. 3.5.2; den habe ich noch nicht gelesen.",
                tool_calls=[
                    {
                        "name": "read_passage",
                        "args": {"document": "OIB-Richtlinie 2", "clause": "3.5.2"},
                        "id": "p1",
                    }
                ],
            ),
            AIMessage(content="Die Antwort [1]."),
        )

        await agent.run(ResearchAgentState(messages=[HumanMessage(content="Wie lang darf der Fluchtweg sein?")]))

        assert SEEN == [("knowledge_search", 0), ("read_passage", 1)]

    @pytest.mark.asyncio
    async def test_the_stamp_does_not_outlive_the_turn(self, scripted_agent):
        agent = scripted_agent(_search("k1", "Geländerhöhe"), AIMessage(content="Die Antwort [1]."))

        await agent.run(ResearchAgentState(messages=[HumanMessage(content="Wie hoch?")]))

        assert current_retrieval_round() is None


class TestSynthesisAnnouncement:
    @pytest.mark.asyncio
    async def test_a_researched_turn_announces_synthesis_once(self, scripted_agent, emitted):
        agent = scripted_agent(
            _search("k1", "Fluchtweglänge GK4"),
            AIMessage(content="Die Antwort [1]."),
        )

        await agent.run(ResearchAgentState(messages=[HumanMessage(content="Wie lang?")]))

        syntheses = [step for step in emitted.steps if step.id == "status:synthesis"]
        assert [step.key for step in syntheses] == ["status.synthesis"]

    @pytest.mark.asyncio
    async def test_a_direct_reply_announces_no_synthesis(self, scripted_agent, emitted):
        agent = scripted_agent(AIMessage(content="Hallo!"))

        await agent.run(ResearchAgentState(messages=[HumanMessage(content="Hallo?")]))

        assert [step for step in emitted.steps if step.id == "status:synthesis"] == []


class TestTheLaneCaptureReachesTheLedger:
    @pytest.mark.asyncio
    async def test_a_tools_hits_join_their_round_in_the_ledger(self, scripted_agent):
        agent = scripted_agent(
            _search("k1", "OIB 2", "Ich brauche zuerst die Grundregel."),
            AIMessage(
                content="Die Grundregel steht; den Punkt noch nicht gelesen.",
                tool_calls=[{"name": "read_passage", "args": {"document": "OIB 2", "clause": "3.5.2"}, "id": "p1"}],
            ),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await agent.run(ResearchAgentState(messages=[HumanMessage(content="Was weißt du über die OIB 2?")]))

        ledger = result.retrieval_ledger
        assert ledger is not None, (
            "the tools' hits never reached the ledger — the capture did not cross the node boundary"
        )
        assert [entry["index"] for entry in ledger] == [0, 1]
        assert ledger[0]["docs"][0]["name"] == "OIB 2.pdf"
        assert ledger[1]["docs"] == [{"name": "OIB 2.pdf", "detail": "p.3.5.2", "repeat": False}]
        assert ledger[1]["new_docs"] == ["OIB 2.pdf"]

    @pytest.mark.asyncio
    async def test_the_capture_does_not_outlive_the_turn(self, scripted_agent):
        agent = scripted_agent(_search("k1", "Geländerhöhe"), AIMessage(content="Die Antwort [1]."))

        await agent.run(ResearchAgentState(messages=[HumanMessage(content="Wie hoch?")]))

        assert turn_status.get_lane_captures() == []


class TestCheckpointRate:
    @pytest.mark.asyncio
    async def test_a_turn_reports_a_checkpoint_per_round_and_whether_it_had_a_body(self, scripted_agent, emitted):
        agent = scripted_agent(
            _search("k1", "Fluchtweglänge GK4", "Ich brauche zuerst die Grundregel."),
            _search("k2", "Treppenraum", ""),
            AIMessage(content="Die Antwort [1]."),
        )

        await agent.run(ResearchAgentState(messages=[HumanMessage(content="Wie lang?")]))

        checkpoints = [step for step in emitted.steps if step.id.startswith("status:checkpoint")]
        assert [(c.detail["round"], c.detail["hasConclusion"]) for c in checkpoints] == [(0, True), (1, False)], (
            "a two-round turn must leave two countable checkpoint records, one per layer of the "
            f"spine; steps were {[step.id for step in emitted.steps]}"
        )
        assert [c.id for c in checkpoints] == ["status:checkpoint:0", "status:checkpoint:1"]

    @pytest.mark.asyncio
    async def test_the_slot_wins_over_the_prose_through_the_whole_graph(self, scripted_agent, emitted):
        agent = scripted_agent(
            AIMessage(
                content="",
                tool_calls=[
                    {"name": "knowledge_search", "args": {"query": "Fluchtweglänge GK4", "conclusion": ""}, "id": "k1"}
                ],
            ),
            AIMessage(
                content="Prosa nebenher.",
                tool_calls=[
                    {
                        "name": "knowledge_search",
                        "args": {"query": "Treppenraum", "conclusion": "Die Grundregel steht; offen ist der GK."},
                        "id": "k2",
                    }
                ],
            ),
            AIMessage(content="Die Antwort [1]."),
        )

        await agent.run(ResearchAgentState(messages=[HumanMessage(content="Wie lang?")]))

        checkpoints = [step for step in emitted.steps if step.id.startswith("status:checkpoint")]
        assert [(c.detail["round"], c.detail["hasConclusion"], c.detail["source"]) for c in checkpoints] == [
            (0, False, "none"),
            (1, True, "argument"),
        ]
        rendered = [step.reason for step in emitted.steps if step.id == "status:retrieval:1"]
        assert rendered == ["Die Grundregel steht; offen ist der GK."]
