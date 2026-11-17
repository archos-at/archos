from __future__ import annotations

import sys
from typing import Any

import pytest
from knowledge_layer_testing.ingest_fixtures import _no_memory_release_between_files  # noqa: F401 - autouse
from knowledge_layer_testing.vector_store_fixtures import fresh_qdrant_store  # noqa: F401 - a store of its own
from knowledge_layer_testing.vector_store_fixtures import qdrant_store  # noqa: F401 - the shared store fixture


def _reset_shared_cache() -> None:
    cache = sys.modules.get("agent.common.cache")
    if cache is not None:
        cache.reset_local_store()


@pytest.fixture(autouse=True)
def _isolate_shared_cache():
    _reset_shared_cache()
    yield
    _reset_shared_cache()


@pytest.fixture
def strict_provider_llm():

    from agent.common.llm_factory import enforce_chat_request_contract
    from tests.provider_doubles import StrictProviderChatModel

    def _make(responses: list[Any] | None = None, *, with_contract: bool = True) -> Any:
        model = StrictProviderChatModel(responses=list(responses or []))
        return enforce_chat_request_contract(model) if with_contract else model

    return _make


@pytest.fixture(autouse=True)
def _no_retrieval_round_from_another_test():
    from agent.common import turn_status

    turn_status._retrieval_round.set(None)


@pytest.fixture(autouse=True)
def _no_live_decisions(monkeypatch):
    monkeypatch.setenv("DECISIONS_ENABLED", "false")


class Emitted(list):
    @property
    def steps(self) -> list[Any]:
        return [body.step for body in self if getattr(body, "type", "").startswith("STEP_")]

    def step(self, step_id: str) -> Any:
        matches = [step for step in self.steps if step.id == step_id]
        assert matches, f"no step {step_id!r} in {[step.id for step in self.steps]}"
        return matches[-1]


@pytest.fixture
def emitted(monkeypatch) -> Emitted:
    bodies = Emitted()
    monkeypatch.setattr("agent.common.turn_status.get_stream_writer", lambda: bodies.append)
    return bodies


async def stream_custom(work: Any) -> Emitted:
    from typing import TypedDict

    from langgraph.graph import END
    from langgraph.graph import START
    from langgraph.graph import StateGraph

    class _State(TypedDict, total=False):
        done: bool

    async def node(_state: _State) -> _State:
        await work()
        return {"done": True}

    builder = StateGraph(_State)
    builder.add_node("producer", node)
    builder.add_edge(START, "producer")
    builder.add_edge("producer", END)
    graph = builder.compile()
    return Emitted([chunk async for _mode, chunk in graph.astream({}, stream_mode=["custom"])])
