import os
import tempfile
from typing import Any

import aiosqlite
import pytest
from agent_testing.conversation import turn
from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.graph import END
from langgraph.graph import StateGraph
from pydantic import BaseModel

from agent.common import _build_checkpointer_serde
from agent.core.conversation import ConversationGraph
from agent.core.models import ConversationState
from agent.core.models import ResearchAgentState

THREAD = "conversation-across-the-deploy"


class _RetiredShallowResult(BaseModel):
    answer: str
    escalate_to_deep: bool
    escalation_reason: str | None = None


class _LegacyState(ConversationState):
    shallow_result: _RetiredShallowResult | None = None


def _legacy_graph(checkpointer):

    async def shallow_research(state: _LegacyState) -> dict[str, Any]:
        return {
            "messages": [AIMessage(content="Die alte Antwort.")],
            "routing_decision": "shallow",
            "shallow_result": _RetiredShallowResult(answer="Die alte Antwort.", escalate_to_deep=False),
            "deep_research_declined": True,
        }

    graph = StateGraph(_LegacyState)
    graph.add_node("shallow_research", shallow_research)
    graph.set_entry_point("shallow_research")
    graph.add_edge("shallow_research", END)
    return graph.compile(checkpointer=checkpointer)


async def _unused(state):  # pragma: no cover - the escalation route is suppressed
    raise AssertionError("must not be called")


async def _answering(state: ResearchAgentState) -> ResearchAgentState:
    return ResearchAgentState(
        messages=list(state.messages) + [AIMessage(content="Die neue Antwort.")],
        source_lookup_attempted=True,
        escalation_requested=False,
    )


@pytest.fixture
async def checkpointer():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as handle:
        db_path = handle.name
    conn = await aiosqlite.connect(db_path)
    try:
        saver = AsyncSqliteSaver(conn, serde=_build_checkpointer_serde())
        await saver.setup()
        yield saver
    finally:
        await conn.close()
        os.unlink(db_path)


@pytest.mark.asyncio
async def test_the_next_turn_after_the_deploy_answers_on_the_old_history(checkpointer):
    await _legacy_graph(checkpointer).ainvoke(
        {"messages": [HumanMessage(content="Was gilt für Brüstungen?")]},
        config={"configurable": {"thread_id": THREAD}},
    )

    agent = ConversationGraph(
        research_fn=_answering, deep_research_fn=_unused, clarifier_fn=None, checkpointer=checkpointer
    )
    result = await turn(agent, ConversationState(messages=[HumanMessage(content="Und im Keller?")]), thread_id=THREAD)

    assert [message.content for message in result.messages] == [
        "Was gilt für Brüstungen?",
        "Die alte Antwort.",
        "Und im Keller?",
        "Die neue Antwort.",
    ]
    assert result.routing_decision == "shallow"


@pytest.mark.asyncio
async def test_a_refusal_recorded_by_the_old_graph_is_still_honoured(checkpointer):
    await _legacy_graph(checkpointer).ainvoke(
        {"messages": [HumanMessage(content="Vergleich über drei Bundesländer?")]},
        config={"configurable": {"thread_id": THREAD}},
    )

    async def escalating(state: ResearchAgentState) -> ResearchAgentState:
        return ResearchAgentState(
            messages=list(state.messages) + [AIMessage(content="Teilantwort.")],
            escalation_requested=True,
            answer_escalation_reason="zu breit",
        )

    agent = ConversationGraph(
        research_fn=escalating, deep_research_fn=_unused, clarifier_fn=_unused, checkpointer=checkpointer
    )
    result = await turn(agent, ConversationState(messages=[HumanMessage(content="Und jetzt?")]), thread_id=THREAD)

    assert result.deep_research_declined is True
    assert result.escalate_to_deep is True, "the ask is recorded"
    assert result.escalation_reason is None, "but no hand-off happened, so nothing narrates one"
    assert result.messages[-1].content == "Teilantwort."
