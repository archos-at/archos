from __future__ import annotations

import threading
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
from agent.core.agent import ChatAgent
from agent.core.models import ResearchAgentState

_PROMPT = "Du bist der Agent."


@tool
def knowledge_search(query: str) -> str:
    return f"Treffer zu: {query}"


class _RecordingStore:
    def __init__(self) -> None:
        self.threads: list[threading.Thread] = []

    def get(self, name, *, fallback):
        self.threads.append(threading.current_thread())
        return fallback


@pytest.fixture
def store():
    recording = _RecordingStore()
    with patch("agent.core.prompt.prompt_store", return_value=recording):
        yield recording


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


def _agent(*rounds: AIMessage) -> ChatAgent:
    llm = MagicMock()
    llm.bind_tools = MagicMock(return_value=llm)
    llm.bind = MagicMock(return_value=llm)
    llm.ainvoke = AsyncMock(side_effect=list(rounds))
    provider = MagicMock(spec=LLMProvider)
    provider.get = MagicMock(return_value=llm)
    return ChatAgent(llm_provider=provider, tools=[knowledge_search], system_prompt=_PROMPT)


async def _run(agent: ChatAgent):
    return await agent.run(ResearchAgentState(messages=[HumanMessage(content="Wie lang darf der Fluchtweg sein?")]))


class TestTheRenderDoesNotRunOnTheLoopThread:
    async def test_the_store_is_read_off_the_event_loop(self, store):
        loop_thread = threading.current_thread()
        agent = _agent(AIMessage(content="Die Antwort [1]."))

        await _run(agent)

        assert store.threads, "the prompt store was never read; the fake is not wired in"
        assert loop_thread not in store.threads, (
            "the static prompt was resolved on the event-loop thread, so a slow Langfuse "
            "blocks every other turn this worker is serving"
        )

    async def test_the_render_still_happens_once_per_turn(self, store):
        agent = _agent(
            AIMessage(content="", tool_calls=[{"name": "knowledge_search", "args": {"query": "a"}, "id": "1"}]),
            AIMessage(content="", tool_calls=[{"name": "knowledge_search", "args": {"query": "b"}, "id": "2"}]),
            AIMessage(content="Die Antwort [1]."),
        )

        result = await _run(agent)

        assert result.tool_iterations == 2
        assert len(store.threads) == 2
        assert threading.current_thread() not in store.threads
