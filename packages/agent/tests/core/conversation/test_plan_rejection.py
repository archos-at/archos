from unittest.mock import MagicMock

import pytest
from agent_testing.conversation import turn
from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.memory import MemorySaver

from agent.core.conversation import ConversationGraph
from agent.core.markers import ESCALATION_MARKER
from agent.core.models import ClarifyResult
from agent.core.models import ConversationState
from agent.core.models import ResearchAgentState

PROCEDURAL_QUESTION = "Wie läuft das Baubewilligungsverfahren in Wien ab?"
SHALLOW_ANSWER = "Das Verfahren läuft in fünf Schritten ab [1]."


def _research_result(messages, *, escalating: bool = False):
    answer = SHALLOW_ANSWER + (f"\n{ESCALATION_MARKER}" if escalating else "")
    return ResearchAgentState(
        messages=list(messages) + [AIMessage(content=answer)],
        escalation_requested=escalating,
        source_lookup_attempted=True,
    )


def _is_fresh_question(messages) -> bool:
    return bool(messages) and isinstance(messages[-1], HumanMessage)


@pytest.fixture
def parts():
    calls = {"research": 0, "deep": 0, "clarifier": 0}

    async def research(state_input):
        calls["research"] += 1
        return _research_result(state_input.messages, escalating=_is_fresh_question(state_input.messages))

    async def deep(state):
        calls["deep"] += 1
        result = MagicMock()
        result.messages = list(state.messages) + [AIMessage(content="Comprehensive report.")]
        result.citations_removed = None
        return result

    async def rejecting_clarifier(request):
        calls["clarifier"] += 1
        return ClarifyResult(research_context="planned", outcome="shallow")

    return calls, research, deep, rejecting_clarifier


def _build(research, deep, clarifier, **kwargs):
    kwargs.setdefault("checkpointer", MemorySaver())
    return ConversationGraph(
        research_fn=research,
        deep_research_fn=deep,
        clarifier_fn=clarifier,
        **kwargs,
    )


class TestRejectionDegradesToAnAnswer:
    @pytest.mark.asyncio
    async def test_rejected_plan_is_answered_on_the_shallow_path(self, parts):
        calls, research, deep, clarifier = parts
        agent = _build(research, deep, clarifier)

        result = await turn(
            agent,
            ConversationState(messages=[HumanMessage(content=PROCEDURAL_QUESTION)]),
            thread_id="reject-1",
        )

        assert calls["clarifier"] == 1
        assert calls["deep"] == 0, "a rejected plan must not run deep research anyway"
        assert calls["research"] == 2, "the answer that asked for the plan, then the answer given instead of it"

        answers = [m.content for m in result.messages if isinstance(m, AIMessage)]
        assert SHALLOW_ANSWER in answers
        assert not any("start a new research query" in c.lower() for c in answers), (
            "the dead-end notice must be gone: the question was already known and answerable"
        )

    @pytest.mark.asyncio
    async def test_chat_agent_receives_the_original_question(self, parts):
        calls, _research, deep, clarifier = parts
        seen: dict[str, object] = {}

        async def capturing_research(state_input):
            calls["research"] += 1
            seen["messages"] = list(state_input.messages)
            return _research_result(state_input.messages, escalating=_is_fresh_question(state_input.messages))

        agent = _build(capturing_research, deep, clarifier)
        await turn(
            agent,
            ConversationState(messages=[HumanMessage(content=PROCEDURAL_QUESTION)]),
            thread_id="reject-2",
        )

        assert [m.content for m in seen["messages"] if isinstance(m, HumanMessage)] == [PROCEDURAL_QUESTION]
        assert all(isinstance(m, (HumanMessage, AIMessage)) for m in seen["messages"])
        assert not any("planned" in str(m.content) for m in seen["messages"])

    @pytest.mark.asyncio
    async def test_the_answer_is_reported_as_shallow_not_deep(self, parts):
        calls, research, deep, clarifier = parts
        agent = _build(research, deep, clarifier)

        result = await turn(
            agent,
            ConversationState(messages=[HumanMessage(content=PROCEDURAL_QUESTION)]),
            thread_id="reject-3",
        )

        assert result.routing_decision != "deep"
        assert result.routing_decision == "shallow"
        assert result.escalation_reason is None, "a decline is not an escalation"


class TestCancellationEndsTheTurnWithAReceipt:
    @pytest.fixture
    def cancelling_parts(self, parts):
        calls, research, deep, _rejecting = parts

        async def cancelling_clarifier(request):
            calls["clarifier"] += 1
            return ClarifyResult(research_context="planned", outcome="cancelled")

        return calls, research, deep, cancelling_clarifier

    @pytest.mark.asyncio
    async def test_cancel_runs_no_research_and_leaves_a_receipt(self, cancelling_parts):
        calls, research, deep, clarifier = cancelling_parts
        agent = _build(research, deep, clarifier)

        result = await turn(
            agent,
            ConversationState(messages=[HumanMessage(content=PROCEDURAL_QUESTION)]),
            thread_id="cancel-1",
        )

        assert calls["clarifier"] == 1
        assert calls["deep"] == 0, "a cancelled plan must not run deep research"
        assert calls["research"] == 1, "a cancellation is not a decline: no second shallow answer was asked for"

        answers = [m.content for m in result.messages if isinstance(m, AIMessage)]
        assert any("verworfen" in c for c in answers), "the cancellation needs a visible receipt"
        assert not any("start a new research query" in c.lower() for c in answers)

    @pytest.mark.asyncio
    async def test_cancel_is_reported_as_a_direct_reply_not_deep(self, cancelling_parts):
        calls, research, deep, clarifier = cancelling_parts
        agent = _build(research, deep, clarifier)

        result = await turn(
            agent,
            ConversationState(messages=[HumanMessage(content=PROCEDURAL_QUESTION)]),
            thread_id="cancel-2",
        )

        assert result.routing_decision == "meta"
        assert result.escalation_reason is None, "a cancellation is not an escalation"

    @pytest.mark.asyncio
    async def test_cancel_declines_deep_for_the_conversation(self, cancelling_parts):
        calls, research, deep, clarifier = cancelling_parts
        agent = _build(research, deep, clarifier)

        result = await turn(
            agent,
            ConversationState(messages=[HumanMessage(content=PROCEDURAL_QUESTION)]),
            thread_id="cancel-3",
        )
        assert result.deep_research_declined is True

        result = await turn(
            agent,
            ConversationState(messages=[HumanMessage(content=PROCEDURAL_QUESTION)]),
            thread_id="cancel-3",
        )

        assert calls["clarifier"] == 1, "no second plan after a cancellation"
        assert calls["deep"] == 0
        assert calls["research"] == 2, "the re-asked question is answered on the shallow path"
        assert result.messages[-1].content == SHALLOW_ANSWER


class TestRejectionIsRemembered:
    @pytest.mark.asyncio
    async def test_the_rejection_is_recorded_on_the_conversation(self, parts):
        calls, research, deep, clarifier = parts
        agent = _build(research, deep, clarifier)

        result = await turn(
            agent,
            ConversationState(messages=[HumanMessage(content=PROCEDURAL_QUESTION)]),
            thread_id="sticky-1",
        )

        assert result.deep_research_declined is True

    @pytest.mark.asyncio
    async def test_a_later_escalating_turn_in_the_same_thread_stays_shallow(self, parts):
        calls, research, deep, clarifier = parts
        agent = _build(research, deep, clarifier)

        await turn(
            agent,
            ConversationState(messages=[HumanMessage(content=PROCEDURAL_QUESTION)]),
            thread_id="sticky-2",
        )
        assert calls["clarifier"] == 1

        result = await turn(
            agent,
            ConversationState(messages=[HumanMessage(content="Und wie lange dauert die Bauverhandlung?")]),
            thread_id="sticky-2",
        )

        assert calls["clarifier"] == 1, "a second plan must not be offered after a rejection"
        assert calls["deep"] == 0
        assert calls["research"] == 3
        assert result.messages[-1].content == SHALLOW_ANSWER, "the marker is stripped and the answer stands"

    @pytest.mark.asyncio
    async def test_a_new_conversation_can_still_reach_deep_research(self, parts):
        calls, research, deep, clarifier = parts

        async def approving_clarifier(request):
            calls["clarifier"] += 1
            return ClarifyResult(research_context="planned", outcome="approved")

        agent = _build(research, deep, clarifier)
        await turn(
            agent,
            ConversationState(messages=[HumanMessage(content=PROCEDURAL_QUESTION)]),
            thread_id="thread-a",
        )
        assert calls["deep"] == 0

        agent2 = _build(research, deep, approving_clarifier)
        await turn(
            agent2,
            ConversationState(messages=[HumanMessage(content="Umfassende Studie zum Holzbau in der DACH-Region")]),
            thread_id="thread-b",
        )

        assert calls["deep"] == 1, "a different conversation must not inherit the rejection"

    @pytest.mark.asyncio
    async def test_escalation_is_suppressed_after_a_rejection(self, parts):
        calls, _research, deep, clarifier = parts

        async def escalating_research(state_input):
            calls["research"] += 1
            return _research_result(state_input.messages, escalating=True)

        agent = _build(escalating_research, deep, clarifier)

        await turn(
            agent,
            ConversationState(messages=[HumanMessage(content=PROCEDURAL_QUESTION)]),
            thread_id="escalate-1",
        )
        result = await turn(
            agent,
            ConversationState(messages=[HumanMessage(content="Und die Fristen?")]),
            thread_id="escalate-1",
        )

        assert calls["clarifier"] == 1, "only the rejected plan itself; never a second trip through the clarifier"
        assert calls["deep"] == 0
        assert calls["research"] == 3
        assert any(SHALLOW_ANSWER in m.content for m in result.messages if isinstance(m, AIMessage))
