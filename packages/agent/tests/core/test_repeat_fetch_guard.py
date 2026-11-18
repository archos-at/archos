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
from agent.common.turn_status import current_retrieval_round
from agent.core.agent import _SYNTHESIS_ANCHOR
from agent.core.agent import ChatAgent
from agent.core.models import ResearchAgentState
from agent.core.round_split import _REPEAT_FETCH_MESSAGE
from agent.core.round_split import _REPEAT_FETCH_PREFIX

_CEILING = 7

RAN: list[str] = []

STAMPS: list[tuple[str, int | None]] = []


@tool(description="Search the OIB knowledge corpus.")
def knowledge_search(
    query: str,
    doc_class: str | None = None,
    title_contains: str | None = None,
    file_name: str | None = None,
    folder: str | None = None,
    filters: dict | None = None,
) -> str:
    if query in FAILING_QUERIES:
        FAILING_QUERIES.discard(query)
        RAN.append(f"knowledge_search:{query}|{file_name or ''}:failed")
        return (
            f"{FETCH_FAILED_MARKER} Knowledge search failed for query={query!r}. "
            "Retry once with the same query; if it fails again, say you could not search."
        )
    RAN.append(f"knowledge_search:{query}|{file_name or ''}")
    STAMPS.append(("knowledge_search", current_retrieval_round()))
    return f"Treffer zu: {query}"


@tool(description="Open a named passage of a known document.")
def read_passage(document: str, clause: str | None = None, page: int | None = None) -> str:
    RAN.append(f"read_passage:{document}|{clause or ''}|{page or ''}")
    STAMPS.append(("read_passage", current_retrieval_round()))
    return f"Passage aus {document}"


FAILING_QUERIES: set[str] = set()


@tool(description="Search Austrian law in RIS.")
def ris_search_tool(query: str) -> str:
    RAN.append(f"ris_search_tool:{query}")
    return f"RIS-Treffer zu: {query}"


@tool(description="Search the web.")
def web_search_tool(query: str) -> str:
    RAN.append(f"web_search_tool:{query}")
    return f"Web-Treffer zu: {query}"


@tool(description="Emit a UI card.")
def emit_card(kind: str) -> str:
    RAN.append(f"emit_card:{kind}")
    STAMPS.append(("emit_card", current_retrieval_round()))
    return "Karte erstellt"


_TOOLS = [knowledge_search, read_passage, ris_search_tool, web_search_tool, emit_card]


@pytest.fixture(autouse=True)
def _clean_slate():
    FAILING_QUERIES.clear()
    RAN.clear()
    STAMPS.clear()
    turn_status._retrieval_round.set(None)
    yield
    RAN.clear()
    STAMPS.clear()
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


def _agent(llm: MagicMock) -> ChatAgent:
    provider = MagicMock(spec=LLMProvider)
    provider.get = MagicMock(return_value=llm)
    return ChatAgent(llm_provider=provider, tools=_TOOLS, max_tool_iterations=_CEILING)


@pytest.fixture
def scripted_agent():

    def build(*rounds: AIMessage) -> ChatAgent:
        llm = MagicMock()
        llm.bind_tools = MagicMock(return_value=llm)
        llm.bind = MagicMock(return_value=llm)
        llm.ainvoke = AsyncMock(side_effect=list(rounds))
        return _agent(llm)

    return build


@pytest.fixture
def steps(emitted):
    return emitted


def _call(name: str, call_id: str, **args) -> dict:
    return {"name": name, "args": args, "id": call_id}


def _batch(*calls: dict, thought: str = "") -> AIMessage:
    return AIMessage(content=thought, tool_calls=list(calls))


async def _run(agent: ChatAgent, question: str = "Wie lang darf der Fluchtweg sein?"):
    return await agent.run(ResearchAgentState(messages=[HumanMessage(content=question)]))


def _tool_messages(result) -> list[ToolMessage]:
    return [m for m in result.messages if isinstance(m, ToolMessage)]


def _answer_for(result, call_id: str) -> str:
    (message,) = [m for m in _tool_messages(result) if m.tool_call_id == call_id]
    return str(message.content)


def _is_repeat_notice(text: str) -> bool:
    return text.startswith(_REPEAT_FETCH_PREFIX) or text == _REPEAT_FETCH_MESSAGE


def _asked(result) -> list[str]:
    return [call["id"] for m in result.messages if isinstance(m, AIMessage) for call in (m.tool_calls or [])]


class TestTheSecondIdenticalFetch:
    async def test_the_same_search_a_round_later_is_answered_not_run(self, scripted_agent, steps):
        agent = scripted_agent(
            _batch(_call("knowledge_search", "a", query="Fluchtweglänge GK4")),
            _batch(_call("knowledge_search", "b", query="Fluchtweglänge GK4")),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent)

        assert RAN == ["knowledge_search:Fluchtweglänge GK4|"]
        assert _answer_for(result, "b") == f"{_REPEAT_FETCH_PREFIX}\n\nTreffer zu: Fluchtweglänge GK4"
        assert result.tool_iterations == 2
        assert _asked(result) == ["a", "b"]
        assert [step.id for step in steps.steps if step.id.startswith("status:retrieval")] == ["status:retrieval:0"]

    async def test_the_withheld_round_is_reported_as_its_own_technical_event(self, scripted_agent, steps):
        agent = scripted_agent(
            _batch(_call("read_passage", "a", document="OIB-Richtlinie 2", clause="3.5.2")),
            _batch(_call("read_passage", "b", document="OIB-Richtlinie 2", clause="3.5.2")),
            AIMessage(content="Die Antwort [1]."),
        )

        await _run(agent)

        (record,) = [step for step in steps.steps if step.id.startswith("status:repeat")]
        assert record.id == "status:repeat:1"
        assert (record.detail["round"], record.detail["withheld"]) == (1, 1)
        assert record.channel == turn_status.CHANNEL_TECHNICAL

    async def test_two_identical_calls_in_ONE_batch_run_once(self, scripted_agent):
        agent = scripted_agent(
            _batch(
                _call("read_passage", "a", document="OIB-Richtlinie 2", clause="3.5.2"),
                _call("read_passage", "b", document="OIB-Richtlinie 2", clause="3.5.2"),
            ),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent)

        assert RAN == ["read_passage:OIB-Richtlinie 2|3.5.2|"]
        assert _answer_for(result, "b") == f"{_REPEAT_FETCH_PREFIX}\n\nPassage aus OIB-Richtlinie 2"
        assert result.tool_iterations == 1

    async def test_case_whitespace_and_a_trailing_dot_are_the_same_passage(self, scripted_agent):
        agent = scripted_agent(
            _batch(_call("read_passage", "a", document="OIB-Richtlinie 2.pdf", clause="3.5.2.")),
            _batch(_call("read_passage", "b", document="  oib-richtlinie 2.PDF ", clause="3.5.2")),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent)

        assert RAN == ["read_passage:OIB-Richtlinie 2.pdf|3.5.2.|"]
        assert _answer_for(result, "b") == f"{_REPEAT_FETCH_PREFIX}\n\nPassage aus OIB-Richtlinie 2.pdf"

    async def test_every_call_still_gets_exactly_one_result(self, scripted_agent):
        agent = scripted_agent(
            _batch(
                _call("knowledge_search", "a", query="Fluchtweg"),
                _call("knowledge_search", "b", query="fluchtweg"),
            ),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent)

        answered = [m.tool_call_id for m in _tool_messages(result)]
        assert sorted(answered) == sorted(_asked(result))
        assert len(answered) == len(set(answered)), "a call answered twice is as invalid as one answered never"


class TestWhatIsNotARepeat:
    async def test_the_same_document_at_another_page_is_another_passage(self, scripted_agent):
        agent = scripted_agent(
            _batch(_call("read_passage", "a", document="Brandschutzkonzept.pdf", page=12)),
            _batch(_call("read_passage", "b", document="Brandschutzkonzept.pdf", page=13)),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent)

        assert RAN == ["read_passage:Brandschutzkonzept.pdf||12", "read_passage:Brandschutzkonzept.pdf||13"]
        assert not any(_is_repeat_notice(str(m.content)) for m in _tool_messages(result))
        assert result.tool_iterations == 2

    async def test_the_same_query_narrowed_to_another_file_is_another_search(self, scripted_agent):
        agent = scripted_agent(
            _batch(_call("knowledge_search", "a", query="Fluchtweg")),
            _batch(_call("knowledge_search", "b", query="Fluchtweg", file_name="Brandschutz.pdf")),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent)

        assert RAN == ["knowledge_search:Fluchtweg|", "knowledge_search:Fluchtweg|Brandschutz.pdf"]
        assert not any(_is_repeat_notice(str(m.content)) for m in _tool_messages(result))
        assert result.tool_iterations == 2

    async def test_a_tool_that_is_not_a_fetch_is_never_withheld(self, scripted_agent):
        agent = scripted_agent(
            _batch(_call("emit_card", "a", kind="legal_basis")),
            _batch(_call("emit_card", "b", kind="legal_basis")),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent)

        assert RAN == ["emit_card:legal_basis", "emit_card:legal_basis"]
        assert not any(_is_repeat_notice(str(m.content)) for m in _tool_messages(result))


class TestTheGuardIsTheOnlyOneOnTheSeam:
    async def test_a_batch_keeps_everything_but_its_own_duplicate(self, scripted_agent):
        agent = scripted_agent(
            _batch(
                _call("knowledge_search", "a", query="Fluchtweg"),
                _call("knowledge_search", "b", query="Fluchtweg"),
                _call("knowledge_search", "c", query="Treppenraum"),
            ),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent)

        assert set(RAN) == {"knowledge_search:Fluchtweg|", "knowledge_search:Treppenraum|"}
        assert len(RAN) == 2
        assert _answer_for(result, "b") == f"{_REPEAT_FETCH_PREFIX}\n\nTreffer zu: Fluchtweg"
        assert not _is_repeat_notice(_answer_for(result, "c"))
        assert result.tool_iterations == 1


class TestAFailedFetchIsNotAFetch:
    async def test_the_retry_of_a_failed_search_runs(self, scripted_agent):
        FAILING_QUERIES.add("Fluchtweglänge GK4")
        agent = scripted_agent(
            _batch(_call("knowledge_search", "a", query="Fluchtweglänge GK4")),
            _batch(_call("knowledge_search", "b", query="Fluchtweglänge GK4")),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent)

        assert RAN == [
            "knowledge_search:Fluchtweglänge GK4|:failed",
            "knowledge_search:Fluchtweglänge GK4|",
        ], "the retry the tool asked for was withheld as a repeat"
        assert not _is_repeat_notice(_answer_for(result, "b"))
        assert _answer_for(result, "b") == "Treffer zu: Fluchtweglänge GK4"

    async def test_a_third_call_after_the_retry_succeeded_is_withheld_again(self, scripted_agent):
        FAILING_QUERIES.add("Fluchtweglänge GK4")
        agent = scripted_agent(
            _batch(_call("knowledge_search", "a", query="Fluchtweglänge GK4")),
            _batch(_call("knowledge_search", "b", query="Fluchtweglänge GK4")),
            _batch(_call("knowledge_search", "c", query="Fluchtweglänge GK4")),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent)

        assert len(RAN) == 2
        assert _answer_for(result, "c") == f"{_REPEAT_FETCH_PREFIX}\n\nTreffer zu: Fluchtweglänge GK4"


class TestTheLoopStillTerminates:
    async def test_a_model_that_repeats_forever_reaches_synthesis(self):
        rounds = {"n": 0}

        async def _reply(messages, **_kwargs):
            if any(_SYNTHESIS_ANCHOR in str(getattr(message, "content", "")) for message in messages):
                return AIMessage(content="Die Antwort [1].")
            rounds["n"] += 1
            return _batch(_call("knowledge_search", f"r{rounds['n']}", query="Fluchtweglänge GK4"))

        llm = MagicMock()
        llm.bind_tools = MagicMock(return_value=llm)
        llm.bind = MagicMock(return_value=llm)
        llm.ainvoke = AsyncMock(side_effect=_reply)

        result = await _run(_agent(llm))

        assert RAN == ["knowledge_search:Fluchtweglänge GK4|"], "the fetch ran once, however often it was asked for"
        assert result.messages[-1].content == "Die Antwort [1]."
        assert result.research_truncated is True
        assert result.tool_iterations >= _CEILING
        assert rounds["n"] <= _CEILING


class TestTheNoticeItself:
    def test_the_prefix_labels_the_result_and_says_what_to_do_next(self):
        assert "already" in _REPEAT_FETCH_PREFIX
        assert "not executed again" in _REPEAT_FETCH_PREFIX
        assert "different" in _REPEAT_FETCH_PREFIX

    def test_the_fallback_still_says_the_answer_is_already_there(self):
        assert "already" in _REPEAT_FETCH_MESSAGE
        assert "result above" in _REPEAT_FETCH_MESSAGE
        assert "different" in _REPEAT_FETCH_MESSAGE


class TestWhatTheSurvivingCallIsFiledUnder:
    async def test_a_surviving_action_call_is_not_filed_under_the_last_search(self, scripted_agent):
        agent = scripted_agent(
            _batch(_call("read_passage", "a", document="OIB-Richtlinie 2", clause="3.5.2")),
            _batch(
                _call("read_passage", "b", document="OIB-Richtlinie 2", clause="3.5.2"),
                _call("emit_card", "c", kind="legal_basis"),
            ),
            AIMessage(content="Die Antwort [1]."),
        )

        await _run(agent)

        assert STAMPS == [
            ("read_passage", 0),
            ("emit_card", None),
        ]

    async def test_a_round_that_still_fetches_keeps_its_own_number(self, scripted_agent):
        agent = scripted_agent(
            _batch(_call("knowledge_search", "a", query="Fluchtweg")),
            _batch(
                _call("knowledge_search", "b", query="Fluchtweg"),
                _call("knowledge_search", "c", query="Treppenraum"),
            ),
            AIMessage(content="Die Antwort [1]."),
        )

        await _run(agent)

        assert STAMPS == [("knowledge_search", 0), ("knowledge_search", 1)]
