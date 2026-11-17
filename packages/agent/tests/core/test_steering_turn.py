from __future__ import annotations

from unittest.mock import AsyncMock
from unittest.mock import MagicMock
from unittest.mock import patch

import pytest
from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage
from langchain_core.messages import SystemMessage
from langchain_core.messages import ToolMessage
from langchain_core.tools import tool

from agent.citations.entries import SourceEntry
from agent.citations.registry import SourceRegistry
from agent.common import LLMProvider
from agent.common import turn_status
from agent.common.steering import HELD_FOR_STEER
from agent.common.steering import SteerInbox
from agent.common.steering import SteerNote
from agent.common.steering import bind_steer_inbox
from agent.common.steering import unbind_steer_inbox
from agent.common.wire_v2 import FocusRegion
from agent.common.wire_v2 import SteerAppliedBody
from agent.core.agent import _SYNTHESIS_ANCHOR
from agent.core.agent import ChatAgent
from agent.core.answer_pipeline import this_turn
from agent.core.models import ResearchAgentState

_PROMPT = "Du bist der Agent."
_QUESTION = "Markier die Tür im Erdgeschoss."
_NOTE = "nicht die Tür, die Treppe"

RAN: list[str] = []


@tool("look", description="Look at a page of the document.")
def look(page: int) -> str:
    RAN.append(f"look:{page}")
    return f"Seite {page}: Tür links, Treppe rechts"


@tool("canvas__mark", description="Propose an Anmerkung on the document.")
def mark(target: str) -> str:
    RAN.append(f"mark:{target}")
    return f"Vorgeschlagen: {target}"


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
def inbox():
    box = SteerInbox()
    token = bind_steer_inbox(box)
    yield box
    unbind_steer_inbox(token)


def _call(name: str, call_id: str, **args) -> dict:
    return {"name": name, "args": args, "id": call_id}


class Scripted:
    def __init__(self, *replies: AIMessage, during: dict[int, object] | None = None) -> None:
        self.replies = list(replies)
        self.requests: list[list] = []
        self.during = during or {}

    async def respond(self, messages, *_args, **_kwargs):
        self.requests.append(list(messages))
        hook = self.during.get(len(self.requests))
        if callable(hook):
            hook()
        return self.replies[len(self.requests) - 1]


def _agent(model: Scripted, *, ceiling: int = 7) -> ChatAgent:
    llm = MagicMock()
    llm.bind_tools = MagicMock(return_value=llm)
    llm.bind = MagicMock(return_value=llm)
    llm.ainvoke = AsyncMock(side_effect=model.respond)
    provider = MagicMock(spec=LLMProvider)
    provider.get = MagicMock(return_value=llm)
    return ChatAgent(llm_provider=provider, tools=[look, mark], system_prompt=_PROMPT, max_tool_iterations=ceiling)


async def _run(agent: ChatAgent) -> ResearchAgentState:
    return await agent.run(ResearchAgentState(messages=[HumanMessage(content=_QUESTION)]))


def _note(steer_id: str = "s1", region: FocusRegion | None = None) -> SteerNote:
    return SteerNote(steer_id=steer_id, text=_NOTE, author="Anna Asker", focus_region=region)


def _notes_in(request: list) -> list[int]:
    return [
        index for index, message in enumerate(request) if isinstance(message, HumanMessage) and _NOTE in message.content
    ]


class TestTheNextRoundReadsTheNote:
    async def test_a_note_typed_during_round_one_is_in_round_two_and_holds_the_door_mark_back(self, inbox, emitted):
        model = Scripted(
            AIMessage(content="", tool_calls=[_call("look", "l1", page=1), _call("canvas__mark", "m1", target="Tür")]),
            AIMessage(content="", tool_calls=[_call("canvas__mark", "m2", target="Treppe")]),
            AIMessage(content="Die Treppe ist markiert."),
            during={1: lambda: inbox.offer(_note())},
        )

        result = await _run(_agent(model))

        assert RAN == ["look:1", "mark:Treppe"]
        held = [m for m in result.messages if isinstance(m, ToolMessage) and m.tool_call_id == "m1"]
        assert [m.content for m in held] == [HELD_FOR_STEER]
        round_one = [m for m in result.messages if isinstance(m, ToolMessage) and m.tool_call_id in {"l1", "m1"}]
        assert sorted(m.tool_call_id for m in round_one) == ["l1", "m1"]

        first, second, third = model.requests
        assert _notes_in(first) == []
        assert isinstance(second[0], SystemMessage)
        assert _notes_in(second) == [len(second) - 1]
        assert isinstance(second[-2], ToolMessage)
        assert third[: len(second)] == second
        assert _notes_in(third) == _notes_in(second)
        assert 'author="Anna Asker"' in second[-1].content and "round 2" in second[-1].content

        assert not any(isinstance(m, HumanMessage) and _NOTE in str(m.content) for m in result.messages)
        assert [m.content for m in result.messages if isinstance(m, HumanMessage)] == [_QUESTION]
        assert len(this_turn(result.messages)) == len(result.messages) - 1
        assert [steer.steer_id for steer in result.steering] == ["s1"]

        applied = [body.value for body in emitted if isinstance(body, SteerAppliedBody)]
        assert [(value.steer_id, value.round) for value in applied] == [("s1", 2)]
        record = emitted.step("status:steered:0")
        assert record.detail == {"round": 0, "withheld": 1}
        assert record.channel == turn_status.CHANNEL_TECHNICAL
        assert result.tool_iterations == 2
        assert inbox.applied and not inbox.has_pending()

    async def test_a_note_that_arrives_while_tools_run_is_read_next_and_holds_nothing(self, inbox):

        @tool("look", description="Look at a page of the document.")
        def slow_look(page: int) -> str:
            RAN.append(f"look:{page}")
            inbox.offer(_note())
            return "Seite 1"

        model = Scripted(
            AIMessage(content="", tool_calls=[_call("look", "l1", page=1)]),
            AIMessage(content="Die Treppe."),
        )
        llm = MagicMock()
        llm.bind_tools = MagicMock(return_value=llm)
        llm.ainvoke = AsyncMock(side_effect=model.respond)
        provider = MagicMock(spec=LLMProvider)
        provider.get = MagicMock(return_value=llm)
        agent = ChatAgent(llm_provider=provider, tools=[slow_look, mark], system_prompt=_PROMPT)

        await _run(agent)

        assert RAN == ["look:1"]
        assert _notes_in(model.requests[1]) == [len(model.requests[1]) - 1]

    async def test_two_notes_keep_the_order_they_were_typed_in(self, inbox):
        def both():
            inbox.offer(_note("s1"))
            inbox.offer(SteerNote(steer_id="s2", text="und das Podest"))

        model = Scripted(
            AIMessage(content="", tool_calls=[_call("look", "l1", page=1)]),
            AIMessage(content="Fertig."),
            during={1: both},
        )

        await _run(_agent(model))

        tail = [m.content for m in model.requests[1][-2:]]
        assert _NOTE in tail[0] and "und das Podest" in tail[1]

    async def test_a_box_drawn_while_the_chat_agent_works_travels_with_the_note(self, inbox):
        region = FocusRegion(page=3, x=0.41, y=0.22, w=0.17, h=0.18)
        model = Scripted(
            AIMessage(content="", tool_calls=[_call("look", "l1", page=3)]),
            AIMessage(content="Fertig."),
            during={1: lambda: inbox.offer(_note(region=region))},
        )

        await _run(_agent(model))

        assert "[Region: p. 3, x 0.41–0.58, y 0.22–0.40]" in model.requests[1][-1].content

    async def test_forced_synthesis_reads_the_note_and_keeps_the_anchor_last(self, inbox):
        model = Scripted(
            AIMessage(content="", tool_calls=[_call("look", "l1", page=1)]),
            AIMessage(content="Die Antwort."),
            during={1: lambda: inbox.offer(_note())},
        )

        result = await _run(_agent(model, ceiling=1))

        synthesis = model.requests[1]
        assert synthesis[-1].content == _SYNTHESIS_ANCHOR
        assert _notes_in(synthesis) == [len(synthesis) - 2]
        assert result.research_truncated is True


class TestWithoutAnInbox:
    async def test_a_turn_outside_a_socket_is_byte_identical(self):
        model = Scripted(
            AIMessage(content="", tool_calls=[_call("look", "l1", page=1), _call("canvas__mark", "m1", target="Tür")]),
            AIMessage(content="Fertig."),
        )

        result = await _run(_agent(model))

        assert sorted(RAN) == ["look:1", "mark:Tür"]
        assert all(not isinstance(m, HumanMessage) for m in model.requests[1][3:])
        assert result.steering == []

    async def test_a_note_the_final_call_never_read_is_left_for_the_next_question(self, inbox):
        model = Scripted(AIMessage(content="Fertig."), during={1: lambda: inbox.offer(_note())})

        result = await _run(_agent(model))

        assert result.steering == []
        assert inbox.has_pending() and inbox.applied == []
