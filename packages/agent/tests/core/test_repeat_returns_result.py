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
from agent.common.tool_calls import FETCH_FAILED_MARKER
from agent.core.agent import _FAILED_FETCH_REPEAT_MESSAGE
from agent.core.agent import _REPEAT_FETCH_MESSAGE
from agent.core.agent import _REPEAT_FETCH_PREFIX
from agent.core.agent import ChatAgent
from agent.core.models import ResearchAgentState

_PROMPT = "Du bist der Agent."

_PASSAGE = (
    "OIB-Richtlinie 2, Punkt 3.5.2: Die Länge des Fluchtweges darf in Gebäuden der "
    "Gebäudeklasse 4 höchstens 40 m betragen, gemessen in Lauflinie."
)

RAN: list[str] = []
FAILING: set[str] = set()


@tool(description="Open a named passage of a known document.")
def read_passage(document: str, clause: str | None = None) -> str:
    RAN.append(f"read_passage:{document}|{clause or ''}")
    if document in FAILING:
        FAILING.discard(document)
        return f"{FETCH_FAILED_MARKER} Der Speicher antwortet nicht. Versuche denselben Aufruf noch einmal."
    return _PASSAGE


@tool(description="Search the OIB knowledge corpus.")
def knowledge_search(query: str) -> str:
    RAN.append(f"knowledge_search:{query}")
    return f"Treffer zu: {query}"


_TOOLS = [read_passage, knowledge_search]


@pytest.fixture(autouse=True)
def _clean_slate():
    RAN.clear()
    FAILING.clear()
    turn_status._retrieval_round.set(None)
    yield
    RAN.clear()
    FAILING.clear()
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


def _call(name: str, call_id: str, **args) -> dict:
    return {"name": name, "args": args, "id": call_id}


def _batch(*calls: dict) -> AIMessage:
    return AIMessage(content="", tool_calls=list(calls))


def _agent(*rounds: AIMessage, ceiling: int = 7) -> ChatAgent:
    llm = MagicMock()
    llm.bind_tools = MagicMock(return_value=llm)
    llm.bind = MagicMock(return_value=llm)
    llm.ainvoke = AsyncMock(side_effect=list(rounds))
    provider = MagicMock(spec=LLMProvider)
    provider.get = MagicMock(return_value=llm)
    return ChatAgent(
        llm_provider=provider,
        tools=_TOOLS,
        system_prompt=_PROMPT,
        max_tool_iterations=ceiling,
    )


async def _run(agent: ChatAgent):
    return await agent.run(ResearchAgentState(messages=[HumanMessage(content="Wie lang darf der Fluchtweg sein?")]))


def _answer_for(result, call_id: str) -> str:
    (message,) = [m for m in result.messages if isinstance(m, ToolMessage) and m.tool_call_id == call_id]
    return str(message.content)


class TestTheRepeatGetsTheResult:
    async def test_the_second_call_carries_the_first_results_text(self):
        agent = _agent(
            _batch(_call("read_passage", "a", document="OIB-Richtlinie 2", clause="3.5.2")),
            _batch(_call("read_passage", "b", document="OIB-Richtlinie 2", clause="3.5.2")),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent)

        assert RAN == ["read_passage:OIB-Richtlinie 2|3.5.2"], "the fetch ran once"
        answer = _answer_for(result, "b")
        assert _PASSAGE in answer, "the repeat was answered with a pointer instead of the passage"
        assert answer == f"{_REPEAT_FETCH_PREFIX}\n\n{_PASSAGE}"

    async def test_the_line_in_front_says_it_is_the_earlier_result(self):
        agent = _agent(
            _batch(_call("read_passage", "a", document="OIB-Richtlinie 2")),
            _batch(_call("read_passage", "b", document="OIB-Richtlinie 2")),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent)

        assert _answer_for(result, "b").startswith(_REPEAT_FETCH_PREFIX)

    async def test_a_repeat_inside_one_batch_gets_its_own_rounds_result(self):
        agent = _agent(
            _batch(
                _call("read_passage", "a", document="OIB-Richtlinie 2", clause="3.5.2"),
                _call("read_passage", "b", document="OIB-Richtlinie 2", clause="3.5.2"),
            ),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent)

        assert len(RAN) == 1
        assert _PASSAGE in _answer_for(result, "b")

    async def test_the_repeat_is_still_not_charged_for_the_fetch(self):
        agent = _agent(
            _batch(_call("read_passage", "a", document="OIB-Richtlinie 2")),
            _batch(_call("read_passage", "b", document="OIB-Richtlinie 2")),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent)

        assert result.tool_iterations == 2
        assert result.research_truncated is None

    async def test_every_call_still_gets_exactly_one_result(self):
        agent = _agent(
            _batch(
                _call("knowledge_search", "a", query="Fluchtweg"),
                _call("knowledge_search", "b", query="Fluchtweg"),
            ),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent)

        asked = [call["id"] for m in result.messages if isinstance(m, AIMessage) for call in (m.tool_calls or [])]
        answered = [m.tool_call_id for m in result.messages if isinstance(m, ToolMessage)]
        assert sorted(answered) == sorted(asked)
        assert len(answered) == len(set(answered))


class TestWhatIsStillTheSentence:
    async def test_a_failed_fetch_caches_nothing_and_its_retry_runs(self):
        FAILING.add("OIB-Richtlinie 2")
        agent = _agent(
            _batch(_call("read_passage", "a", document="OIB-Richtlinie 2")),
            _batch(_call("read_passage", "b", document="OIB-Richtlinie 2")),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent)

        assert len(RAN) == 2, "the retry was withheld and answered with a result nothing fetched"
        assert _answer_for(result, "b") == _PASSAGE

    async def test_a_same_batch_duplicate_of_a_FAILED_fetch_is_told_it_failed(self):
        FAILING.add("OIB-Richtlinie 2")
        agent = _agent(
            _batch(
                _call("read_passage", "a", document="OIB-Richtlinie 2", clause="3.5.2"),
                _call("read_passage", "b", document="OIB-Richtlinie 2", clause="3.5.2"),
            ),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent)

        assert len(RAN) == 1, "the duplicate still does not run"
        assert _answer_for(result, "b") == _FAILED_FETCH_REPEAT_MESSAGE
        assert "failed" in _FAILED_FETCH_REPEAT_MESSAGE
        assert "next round" in _FAILED_FETCH_REPEAT_MESSAGE
        assert "Ergebnis oben" not in _FAILED_FETCH_REPEAT_MESSAGE

    async def test_the_retry_of_that_failed_fetch_runs_in_the_next_round(self):
        FAILING.add("OIB-Richtlinie 2")
        agent = _agent(
            _batch(
                _call("read_passage", "a", document="OIB-Richtlinie 2", clause="3.5.2"),
                _call("read_passage", "b", document="OIB-Richtlinie 2", clause="3.5.2"),
            ),
            _batch(_call("read_passage", "c", document="OIB-Richtlinie 2", clause="3.5.2")),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent)

        assert len(RAN) == 2
        assert _answer_for(result, "c") == _PASSAGE

    async def test_a_successful_first_call_still_hands_back_its_text(self):
        agent = _agent(
            _batch(
                _call("read_passage", "a", document="OIB-Richtlinie 2", clause="3.5.2"),
                _call("read_passage", "b", document="OIB-Richtlinie 2", clause="3.5.2"),
            ),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent)

        assert _answer_for(result, "b") == f"{_REPEAT_FETCH_PREFIX}\n\n{_PASSAGE}"

    def test_a_signature_the_turn_does_not_hold_falls_back_to_the_sentence(self):
        from agent.core.agent import _repeat_answer

        call = {"name": "read_passage", "args": {"document": "OIB-Richtlinie 2"}, "id": "x"}
        assert _repeat_answer(call, {}) == _REPEAT_FETCH_MESSAGE
