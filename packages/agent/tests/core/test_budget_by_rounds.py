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
from agent.common.cost_tracking import CostTracker
from agent.common.cost_tracking import UsageEvent
from agent.common.cost_tracking import cost_tracker_var
from agent.core.agent import _SYNTHESIS_ANCHOR
from agent.core.agent import ChatAgent
from agent.core.models import ResearchAgentState
from agent.core.round_split import _WIDTH_CAP_MESSAGE
from agent.core.turn_binding import _DEFAULT_MAX_CALLS_PER_ROUND
from agent.core.turn_binding import _recursion_limit

_PROMPT = "Du bist der Agent."

RAN: list[str] = []


@tool(description="Search the OIB knowledge corpus.")
def knowledge_search(query: str) -> str:
    RAN.append(f"knowledge_search:{query}")
    return f"Treffer zu: {query}"


@tool(description="Open a named passage of a known document.")
def read_passage(document: str, clause: str | None = None) -> str:
    RAN.append(f"read_passage:{document}|{clause or ''}")
    return f"Passage aus {document}"


@tool(description="Emit a UI card.")
def emit_card(kind: str) -> str:
    RAN.append(f"emit_card:{kind}")
    return "Karte erstellt"


@tool(description="Remember a durable fact.")
def remember(fact: str) -> str:
    RAN.append(f"remember:{fact}")
    return "Gemerkt"


_TOOLS = [knowledge_search, read_passage, emit_card, remember]


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


def _batch(*calls: dict, thought: str = "") -> AIMessage:
    return AIMessage(content=thought, tool_calls=list(calls))


def _agent(
    *rounds: AIMessage,
    ceiling: int = 7,
    max_input_tokens: int = 0,
    max_calls_per_round: int = 0,
) -> ChatAgent:
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
        max_input_tokens_per_turn=max_input_tokens,
        max_calls_per_round=max_calls_per_round,
    )


async def _run(agent: ChatAgent, question: str = "Was weißt du über die OIB 2?"):
    return await agent.run(ResearchAgentState(messages=[HumanMessage(content=question)]))


class TestAParallelRoundCostsOne:
    async def test_the_family_overview_costs_two_rounds_not_six(self):
        agent = _agent(
            _batch(_call("knowledge_search", "k", query="OIB 2")),
            _batch(
                *(
                    _call("read_passage", f"p{index}", document=f"OIB-Richtlinie 2 Teil {index}")
                    for index in range(1, 6)
                )
            ),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent)

        assert len(RAN) == 6, "every member was opened"
        assert result.tool_iterations == 2
        assert result.research_truncated is None

    async def test_a_round_of_cards_costs_the_same_as_a_round_of_searches(self):
        agent = _agent(
            _batch(
                _call("emit_card", "c1", kind="verdict_header"),
                _call("emit_card", "c2", kind="typed_table"),
                _call("remember", "m1", fact="Gebäudeklasse 4"),
            ),
            AIMessage(content="Die Antwort [1]."),
            ceiling=2,
        )

        result = await _run(agent)

        assert len(RAN) == 3
        assert result.tool_iterations == 1
        assert result.research_truncated is None


class TestTheCeilingIsRounds:
    async def test_the_loop_stops_after_ceiling_rounds(self, steps):

        async def _reply(messages, **_kwargs):
            if any(_SYNTHESIS_ANCHOR in str(getattr(message, "content", "")) for message in messages):
                return AIMessage(content="Die Antwort [1].")
            index = len(RAN)
            return _batch(
                _call("knowledge_search", f"a{index}", query=f"Frage {index}"),
                _call("knowledge_search", f"b{index}", query=f"Frage {index} anders"),
            )

        agent = _agent(ceiling=3)
        agent.llm_provider.get().ainvoke = AsyncMock(side_effect=_reply)

        result = await _run(agent)

        assert result.tool_iterations == 3
        assert result.research_truncated is True
        assert len(RAN) == 6
        (record,) = [step for step in steps.steps if step.id == "status:budget"]
        assert (record.detail["ceiling"], record.detail["spent"], record.detail["rounds"]) == (3, 3, 3)
        assert record.channel == turn_status.CHANNEL_TECHNICAL

    def test_the_recursion_guard_derives_from_the_round_ceiling_alone(self):
        assert _recursion_limit(7) == 24
        assert _recursion_limit(0) == 10


class TestTheInputTokenStop:
    @pytest.fixture
    def spent_tracker(self):
        tracker = CostTracker(organization_id="org-1")
        tracker.record(
            UsageEvent(
                model="m",
                requested_model="m",
                generation_id=None,
                prompt_tokens=1500,
                completion_tokens=10,
                total_tokens=1510,
                cached_tokens=0,
                reasoning_tokens=0,
                cost_usd=0.0,
                cost_source="usage_field",
                is_byok=None,
            )
        )
        token = cost_tracker_var.set(tracker)
        yield tracker
        cost_tracker_var.reset(token)

    async def test_a_turn_over_the_token_ceiling_is_forced_into_synthesis(self, spent_tracker, steps):
        agent = _agent(
            AIMessage(content="Die Antwort aus dem, was da ist [1]."),
            ceiling=7,
            max_input_tokens=1000,
        )

        result = await _run(agent)

        assert RAN == [], "the turn was stopped before it could spend another round"
        assert result.tool_iterations == 0
        assert result.research_truncated is True
        (record,) = [step for step in steps.steps if step.id == "status:budget:input"]
        assert (record.detail["limit"], record.detail["spent"], record.detail["rounds"]) == (1000, 1500, 0)
        assert record.detail["truncated"] is True
        assert record.channel == turn_status.CHANNEL_TECHNICAL
        assert "key" not in record

    async def test_it_is_a_separate_record_from_the_round_ceiling(self, spent_tracker, steps):
        agent = _agent(AIMessage(content="Die Antwort [1]."), ceiling=7, max_input_tokens=1000)

        await _run(agent)

        assert [step.id for step in steps.steps if step.id.startswith("status:budget")] == ["status:budget:input"]

    async def test_a_turn_under_the_ceiling_researches_normally(self, spent_tracker):
        agent = _agent(
            _batch(_call("knowledge_search", "k", query="OIB 2")),
            AIMessage(content="Die Antwort [1]."),
            ceiling=7,
            max_input_tokens=100_000,
        )

        result = await _run(agent)

        assert RAN == ["knowledge_search:OIB 2"]
        assert result.tool_iterations == 1
        assert result.research_truncated is None

    async def test_zero_disables_the_stop(self, spent_tracker):
        agent = _agent(
            _batch(_call("knowledge_search", "k", query="OIB 2")),
            AIMessage(content="Die Antwort [1]."),
            ceiling=7,
            max_input_tokens=0,
        )

        result = await _run(agent)

        assert result.tool_iterations == 1
        assert result.research_truncated is None

    async def test_no_tracker_means_no_budget_has_been_spent(self):
        agent = _agent(
            _batch(_call("knowledge_search", "k", query="OIB 2")),
            AIMessage(content="Die Antwort [1]."),
            ceiling=7,
            max_input_tokens=1,
        )

        result = await _run(agent)

        assert result.tool_iterations == 1
        assert result.research_truncated is None


class TestTheRoundWidthCap:
    async def test_a_round_wider_than_the_cap_runs_only_the_first_calls(self):
        agent = _agent(
            _batch(*(_call("read_passage", f"p{index}", document=f"Dok {index}") for index in range(6))),
            AIMessage(content="Die Antwort [1]."),
            max_calls_per_round=2,
        )

        result = await _run(agent)

        assert len(RAN) == 2
        assert set(RAN) == {"read_passage:Dok 0|", "read_passage:Dok 1|"}
        assert result.tool_iterations == 1

    async def test_the_deferred_calls_are_answered_not_deleted(self):
        agent = _agent(
            _batch(*(_call("read_passage", f"p{index}", document=f"Dok {index}") for index in range(4))),
            AIMessage(content="Die Antwort [1]."),
            max_calls_per_round=2,
        )

        result = await _run(agent)

        asked = [call["id"] for m in result.messages if isinstance(m, AIMessage) for call in (m.tool_calls or [])]
        answered = [m.tool_call_id for m in result.messages if isinstance(m, ToolMessage)]
        assert sorted(answered) == sorted(asked) == ["p0", "p1", "p2", "p3"]

    async def test_the_notice_says_it_may_be_issued_again_next_round(self):
        agent = _agent(
            _batch(
                _call("read_passage", "a", document="Dok A"),
                _call("read_passage", "b", document="Dok B"),
            ),
            AIMessage(content="Die Antwort [1]."),
            max_calls_per_round=1,
        )

        result = await _run(agent)

        (deferred,) = [m for m in result.messages if isinstance(m, ToolMessage) and m.tool_call_id == "b"]
        assert str(deferred.content) == _WIDTH_CAP_MESSAGE
        assert "next round" in _WIDTH_CAP_MESSAGE
        assert "Not executed" in _WIDTH_CAP_MESSAGE

    async def test_a_capped_round_leaves_its_own_technical_record(self, steps):
        agent = _agent(
            _batch(*(_call("read_passage", f"p{index}", document=f"Dok {index}") for index in range(5))),
            AIMessage(content="Die Antwort [1]."),
            max_calls_per_round=2,
        )

        await _run(agent)

        (record,) = [step for step in steps.steps if step.id.startswith("status:width")]
        assert record.id == "status:width:0"
        assert (record.detail["round"], record.detail["kept"], record.detail["withheld"]) == (0, 2, 3)
        assert record.channel == turn_status.CHANNEL_TECHNICAL
        assert "key" not in record

    async def test_the_deferred_call_runs_when_it_is_issued_again(self):
        agent = _agent(
            _batch(
                _call("read_passage", "a", document="Dok A"),
                _call("read_passage", "b", document="Dok B"),
            ),
            _batch(_call("read_passage", "b2", document="Dok B")),
            AIMessage(content="Die Antwort [1]."),
            max_calls_per_round=1,
        )

        result = await _run(agent)

        assert RAN == ["read_passage:Dok A|", "read_passage:Dok B|"]
        assert result.tool_iterations == 2

    async def test_a_round_at_the_cap_is_untouched(self, steps):
        agent = _agent(
            _batch(*(_call("read_passage", f"p{index}", document=f"Dok {index}") for index in range(5))),
            AIMessage(content="Die Antwort [1]."),
            max_calls_per_round=5,
        )

        result = await _run(agent)

        assert len(RAN) == 5
        assert result.tool_iterations == 1
        assert [step for step in steps.steps if step.id.startswith("status:width")] == []

    async def test_zero_disables_the_cap(self):
        agent = _agent(
            _batch(*(_call("read_passage", f"p{index}", document=f"Dok {index}") for index in range(20))),
            AIMessage(content="Die Antwort [1]."),
            max_calls_per_round=0,
        )

        await _run(agent)

        assert len(RAN) == 20

    async def test_the_cap_counts_what_would_RUN_not_what_was_asked(self):
        agent = _agent(
            _batch(
                _call("read_passage", "a", document="Dok A"),
                _call("read_passage", "a2", document="Dok A"),
                _call("read_passage", "b", document="Dok B"),
                _call("read_passage", "c", document="Dok C"),
            ),
            AIMessage(content="Die Antwort [1]."),
            max_calls_per_round=3,
        )

        result = await _run(agent)

        assert len(RAN) == 3
        assert result.tool_iterations == 1
        assert not any(str(m.content) == _WIDTH_CAP_MESSAGE for m in result.messages if isinstance(m, ToolMessage))

    def test_the_default_is_a_runaway_guard_not_a_doctrine(self):
        assert _DEFAULT_MAX_CALLS_PER_ROUND >= 12
