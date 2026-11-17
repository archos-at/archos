from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock
from unittest.mock import MagicMock

import pytest

from agent.agents.deep_researcher.models import ResearchQuery
from agent.agents.deep_researcher.tools.research import RetrievalRounds
from agent.agents.deep_researcher.tools.research import build_research_batch_tool
from agent.common.retrieval_ledger import build_retrieval_ledger
from agent.common.turn_status import begin_lane_capture
from agent.common.turn_status import end_lane_capture
from agent.common.turn_status import get_lane_captures
from agent.common.turn_status import lane_tool_scope
from agent.common.turn_status import record_lane_hit

FIXTURE = Path(__file__).resolve().parents[5] / "tests/fixtures/derivation/retrieval_ledger_wire.json"


def _query(text: str, tool: str = "knowledge_search") -> ResearchQuery:
    return ResearchQuery(
        query=text,
        subqueries=[],
        preferred_tools=[tool],
        fallback_tools=[],
        target_components=["fire_safety"],
        rationale="coverage",
    )


def _note(topic: str) -> dict[str, Any]:
    return {
        "structured_response": {
            "query_topic": topic,
            "target_components": ["fire_safety"],
            "summary": f"Notes on {topic}.",
            "findings": [],
            "gaps": [],
            "sources": [],
            "narrative_notes": f"Narrative on {topic}.",
            "language": "Deutsch",
            "evidence_judgment": None,
        }
    }


def _runnable_recording(hits: dict[str, list[tuple[str, str]]]) -> Any:

    async def _invoke(state: dict[str, Any], config: dict[str, Any] | None = None) -> dict[str, Any]:
        text = str(state["messages"][0].content)
        topic = next(key for key in hits if key in text)
        with lane_tool_scope("knowledge_search"):
            for name, detail in hits[topic]:
                record_lane_hit(name, detail=detail)
        return _note(topic)

    runnable = MagicMock()
    runnable.ainvoke = AsyncMock(side_effect=_invoke)
    return runnable


def _batch_tool(runnable: Any, rounds: RetrievalRounds):
    return build_research_batch_tool(
        researcher_runnable=runnable,
        callbacks=[],
        max_research_concurrency=4,
        researcher_tool_names={"knowledge_search"},
        rounds=rounds,
    )


class TestTwoBatchesAreTwoRounds:
    @pytest.mark.asyncio
    async def test_each_batch_announces_its_own_round(self):
        rounds = RetrievalRounds()
        tool = _batch_tool(_runnable_recording({"Fluchtweg": [], "Brandabschnitt": []}), rounds)

        await tool.ainvoke({"queries": [_query("Fluchtweglänge GK4 Fluchtweg")], "conclusion": ""})
        await tool.ainvoke(
            {"queries": [_query("Brandabschnitt Trennung")], "conclusion": "Die Grundregel steht."},
        )

        assert [entry["index"] for entry in rounds.announcements] == [0, 1]
        assert rounds.announcements[0]["corpora"] == ["knowledge"]
        assert "reason" not in rounds.announcements[0]
        assert rounds.announcements[1]["reason"] == "Die Grundregel steht."

    @pytest.mark.asyncio
    async def test_the_hits_of_a_batch_land_under_the_round_that_fetched_them(self):
        rounds = RetrievalRounds()
        runnable = _runnable_recording(
            {
                "Fluchtweg": [("OIB-RL_2.pdf", "p.12")],
                "Brandabschnitt": [("Brandschutzkonzept.pdf", "p.3")],
            }
        )
        tool = _batch_tool(runnable, rounds)

        token = begin_lane_capture()
        try:
            await tool.ainvoke({"queries": [_query("Fluchtweglänge GK4 Fluchtweg")], "conclusion": ""})
            await tool.ainvoke({"queries": [_query("Brandabschnitt Trennung")], "conclusion": "Weiter."})
            captures = get_lane_captures()
        finally:
            end_lane_capture(token)

        assert [(hit["round"], hit["name"]) for hit in captures] == [
            (0, "OIB-RL_2.pdf"),
            (1, "Brandschutzkonzept.pdf"),
        ]

        ledger = build_retrieval_ledger(rounds.announcements, captures)
        assert [entry["new_docs"] for entry in ledger] == [["OIB-RL_2.pdf"], ["Brandschutzkonzept.pdf"]]


class TestTheLedgerIsTheSharedWireShape:
    @pytest.mark.asyncio
    async def test_every_key_the_run_writes_is_a_key_the_fixture_holds(self):
        fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        entry_keys = {key for entry in fixture for key in entry}
        doc_keys = {key for entry in fixture for doc in entry["docs"] for key in doc}

        rounds = RetrievalRounds()
        runnable = _runnable_recording({"Fluchtweg": [("OIB-RL_2.pdf", "p.12")]})
        tool = _batch_tool(runnable, rounds)
        token = begin_lane_capture()
        try:
            await tool.ainvoke(
                {"queries": [_query("Fluchtweglänge GK4 Fluchtweg")], "conclusion": "Die Grundregel steht."}
            )
            ledger = build_retrieval_ledger(rounds.announcements, get_lane_captures())
        finally:
            end_lane_capture(token)

        assert ledger is not None
        for entry in ledger:
            assert set(entry) <= entry_keys, f"unknown ledger key: {set(entry) - entry_keys}"
            for doc in entry["docs"]:
                assert set(doc) <= doc_keys, f"unknown doc key: {set(doc) - doc_keys}"
            assert isinstance(entry["hits"], int)
            assert isinstance(entry["documents"], int)
        assert ledger[0]["docs"] == [{"name": "OIB-RL_2.pdf", "detail": "p.12", "repeat": False}]
