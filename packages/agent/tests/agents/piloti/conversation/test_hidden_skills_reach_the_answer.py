from __future__ import annotations

import pytest
from agent_testing.conversation import turn
from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage

from agent.agents.piloti.conversation import ConversationGraph
from agent.agents.piloti.markers import ESCALATION_MARKER
from agent.agents.piloti.models import ConversationState
from agent.agents.piloti.models import ResearchAgentState
from agent.turn.response import build_result

VOICE = "piloti-voice"
CARDS = "piloti-cards"
VISIBLE = "forecast-analysis"


def _agent(research_fn, deep_fn=None):
    return ConversationGraph(
        research_fn=research_fn,
        deep_research_fn=deep_fn or (lambda state: None),
        clarifier_fn=None,
    )


def _research_returning(answer: str, **fields):

    async def research(state):
        return ResearchAgentState(
            messages=list(state.messages) + [AIMessage(content=answer)],
            escalation_requested=False,
            **fields,
        )

    return research


async def _turn(research_fn, deep_fn=None):
    state = ConversationState(messages=[HumanMessage(content="Wie tief darf der Erker sein?")])
    result = await turn(_agent(research_fn, deep_fn), state, thread_id="t")
    return result, build_result(result, [], "m1")


@pytest.mark.asyncio
async def test_the_hidden_subset_rides_the_answer_it_belongs_to():
    _, finished = await _turn(
        _research_returning(
            "Antwort [1].",
            skills_activated=[VOICE, CARDS, VISIBLE],
            skills_hidden=[VOICE, CARDS],
        )
    )

    assert finished.skills_activated == [VOICE, CARDS, VISIBLE]
    assert finished.skills_hidden == [VOICE, CARDS], (
        "The agent marked piloti-voice/piloti-cards grid-hidden and the answer "
        "reached the client without saying so — the disclosure will render the house voice at "
        "full weight, which is exactly the internal vocabulary the field exists to mute"
    )


@pytest.mark.asyncio
async def test_a_turn_with_nothing_hidden_carries_no_mute_list():
    _, finished = await _turn(_research_returning("Antwort [1].", skills_activated=[VISIBLE]))

    assert finished.skills_activated == [VISIBLE]
    assert finished.skills_hidden == []


@pytest.mark.asyncio
async def test_an_escalating_turn_drops_the_mute_list_with_the_list_it_mutes():

    async def research_escalating(state):
        return ResearchAgentState(
            messages=list(state.messages) + [AIMessage(content=f"Reicht nicht. {ESCALATION_MARKER}")],
            escalation_requested=True,
            skills_activated=[VOICE],
            skills_hidden=[VOICE],
        )

    async def deep(state):
        return ResearchAgentState(messages=list(state.messages) + [AIMessage(content="Deep report.")])

    result, finished = await _turn(research_escalating, deep)

    assert result.skills_activated is None
    assert result.skills_hidden is None, (
        "the superseded research turn's mute list survived into the deep-research answer's "
        "state: it names skills that shaped an answer the reader is never shown"
    )
    assert finished.skills_activated == []
    assert finished.skills_hidden == []
