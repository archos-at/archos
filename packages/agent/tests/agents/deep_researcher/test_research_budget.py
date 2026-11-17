from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock
from unittest.mock import MagicMock

import pytest
from langchain_core.messages import ToolMessage
from langchain_core.tools import tool

from agent.agents.deep_researcher.custom_middleware import SelectiveToolRetryMiddleware
from agent.agents.deep_researcher.custom_middleware import ToolResultPruningMiddleware
from agent.agents.deep_researcher.custom_middleware import is_retryable_tool_error
from agent.agents.deep_researcher.models import ResearchNotes
from agent.agents.deep_researcher.models import ResearchQuery
from agent.agents.deep_researcher.tools.research import _UNRESEARCHABLE_NARRATIVE
from agent.agents.deep_researcher.tools.research import _UNRESEARCHABLE_SUMMARY
from agent.agents.deep_researcher.tools.research import MAX_QUERY_SUBMISSIONS
from agent.agents.deep_researcher.tools.research import RESEARCH_NOTE_MAX_CHARS
from agent.agents.deep_researcher.tools.research import _research_note_files
from agent.agents.deep_researcher.tools.research import _terminal_unresearchable_note
from agent.agents.deep_researcher.tools.research import build_research_batch_tool
from agent.common import RunBudgetExceededError


@tool
def web_search_tool(query: str) -> str:
    return f"Results for: {query}"


def _make_query(text: str = "test query") -> ResearchQuery:
    return ResearchQuery(
        query=text,
        subqueries=[],
        preferred_tools=["web_search_tool"],
        fallback_tools=[],
        target_components=["test"],
        rationale="testing",
    )


def _fake_runnable(result: Any | None = None) -> Any:
    runnable = MagicMock()
    if result is not None:
        runnable.ainvoke = AsyncMock(return_value=result)
    return runnable


def _structured_response() -> dict:
    return {
        "structured_response": {
            "query_topic": "test",
            "target_components": ["test"],
            "summary": "A test note.",
            "findings": [
                {
                    "claim": "Test claim.",
                    "evidence": "Test evidence.",
                    "source_ids": [1],
                    "confidence": "high",
                    "caveats": [],
                }
            ],
            "gaps": [],
            "sources": [
                {
                    "id": 1,
                    "title": "Test",
                    "source_type": "url",
                    "locator": "https://example.test",
                }
            ],
            "narrative_notes": "Test narrative.",
            "language": "English",
            "evidence_judgment": None,
        }
    }


class TestGraphRecursionErrorIsTerminal:
    @pytest.mark.asyncio
    async def test_graph_recursion_error_yields_terminal_note(self):
        from langgraph.errors import GraphRecursionError

        runnable = MagicMock()
        runnable.ainvoke = AsyncMock(side_effect=GraphRecursionError("maximum recursion depth reached"))

        batch_tool = build_research_batch_tool(
            researcher_runnable=runnable,
            callbacks=[],
            max_research_concurrency=2,
            researcher_tool_names={"web_search_tool"},
        )

        result = await batch_tool.ainvoke({"queries": [_make_query()]})
        payload = json.loads(result)
        assert len(payload) == 1
        assert payload[0]["summary"] == _UNRESEARCHABLE_SUMMARY

    @pytest.mark.asyncio
    async def test_exhausted_worker_note_records_query_gap(self):
        from langgraph.errors import GraphRecursionError

        runnable = MagicMock()
        runnable.ainvoke = AsyncMock(side_effect=GraphRecursionError("recurse"))

        batch_tool = build_research_batch_tool(
            researcher_runnable=runnable,
            callbacks=[],
            max_research_concurrency=2,
            researcher_tool_names={"web_search_tool"},
        )

        result = await batch_tool.ainvoke({"queries": [_make_query("stuck query")]})
        payload = json.loads(result)
        assert payload[0]["narrative_notes"] == _UNRESEARCHABLE_NARRATIVE
        assert payload[0]["gaps"][0]["description"] == "Query: stuck query"

    @pytest.mark.asyncio
    async def test_run_budget_exceeded_passthrough(self):
        runnable = MagicMock()
        runnable.ainvoke = AsyncMock(side_effect=RunBudgetExceededError(ceiling=1000, used=1500))

        batch_tool = build_research_batch_tool(
            researcher_runnable=runnable,
            callbacks=[],
            max_research_concurrency=2,
            researcher_tool_names={"web_search_tool"},
        )

        with pytest.raises(RunBudgetExceededError):
            await batch_tool.ainvoke({"queries": [_make_query()]})

    @pytest.mark.asyncio
    async def test_generic_exception_still_wrapped(self):
        runnable = MagicMock()
        runnable.ainvoke = AsyncMock(side_effect=ValueError("something went wrong"))

        batch_tool = build_research_batch_tool(
            researcher_runnable=runnable,
            callbacks=[],
            max_research_concurrency=2,
            researcher_tool_names={"web_search_tool"},
        )

        with pytest.raises(RuntimeError, match="researcher worker failed"):
            await batch_tool.ainvoke({"queries": [_make_query()]})


class TestQueryDigestResubmissionCap:
    @pytest.mark.asyncio
    async def test_under_limit_runs_normally(self):
        runnable = _fake_runnable(_structured_response())
        batch_tool = build_research_batch_tool(
            researcher_runnable=runnable,
            callbacks=[],
            max_research_concurrency=2,
            researcher_tool_names={"web_search_tool"},
        )

        for _ in range(MAX_QUERY_SUBMISSIONS):
            result = await batch_tool.ainvoke({"queries": [_make_query("under limit")]})

        payload = json.loads(result)
        assert len(payload) == 1
        assert payload[0]["query_topic"] == "test"

    @pytest.mark.asyncio
    async def test_over_limit_returns_terminal_unresearchable(self):
        runnable = _fake_runnable(_structured_response())
        batch_tool = build_research_batch_tool(
            researcher_runnable=runnable,
            callbacks=[],
            max_research_concurrency=2,
            researcher_tool_names={"web_search_tool"},
        )

        for _ in range(MAX_QUERY_SUBMISSIONS):
            await batch_tool.ainvoke({"queries": [_make_query("over limit")]})

        result = await batch_tool.ainvoke({"queries": [_make_query("over limit")]})

        payload = json.loads(result)
        assert len(payload) == 1
        assert payload[0]["summary"] != ""
        assert "nicht recherchiert werden" in payload[0]["summary"]

    @pytest.mark.asyncio
    async def test_different_query_digests_have_independent_counters(self):
        runnable = _fake_runnable(_structured_response())
        batch_tool = build_research_batch_tool(
            researcher_runnable=runnable,
            callbacks=[],
            max_research_concurrency=2,
            researcher_tool_names={"web_search_tool"},
        )

        for _ in range(MAX_QUERY_SUBMISSIONS + 1):
            await batch_tool.ainvoke({"queries": [_make_query("query A"), _make_query("query B")]})

        result = await batch_tool.ainvoke({"queries": [_make_query("query A")]})
        payload = json.loads(result)
        assert "nicht recherchiert werden" in payload[0]["summary"]

    @pytest.mark.asyncio
    async def test_mixed_oversubscribed_and_fresh(self):
        runnable = _fake_runnable(_structured_response())
        batch_tool = build_research_batch_tool(
            researcher_runnable=runnable,
            callbacks=[],
            max_research_concurrency=2,
            researcher_tool_names={"web_search_tool"},
        )

        for _ in range(MAX_QUERY_SUBMISSIONS):
            await batch_tool.ainvoke({"queries": [_make_query("stale")]})

        result = await batch_tool.ainvoke({"queries": [_make_query("stale"), _make_query("fresh")]})

        payload = json.loads(result)
        assert len(payload) == 2
        summaries = [n["summary"] for n in payload]
        assert any("nicht recherchiert werden" in s for s in summaries)
        assert any(s == "A test note." for s in summaries)


class TestTerminalUnresearchableNote:
    def test_terminal_note_has_no_findings(self):
        q = _make_query("my query")
        note = _terminal_unresearchable_note(q)
        assert note.findings == []
        assert note.summary != ""

    def test_terminal_note_preserves_target_components(self):
        q = _make_query("test target")
        note = _terminal_unresearchable_note(q)
        assert note.target_components == ["test"]

    def test_terminal_note_passes_empty_check_guard(self):
        q = _make_query("empty guard check")
        note = _terminal_unresearchable_note(q)
        assert note.findings is not None
        assert note.summary.strip() != ""


class TestResearchNoteTruncation:
    def _big_note(self) -> ResearchNotes:
        return ResearchNotes(
            query_topic="big note",
            target_components=["test"],
            summary="x" * RESEARCH_NOTE_MAX_CHARS,  # oversize
            findings=[],
            gaps=[],
            sources=[],
            narrative_notes="",
            language="English",
            evidence_judgment=None,
        )

    def test_oversized_note_is_truncated(self):
        q = _make_query("big test")
        note = self._big_note()
        files = _research_note_files([q], [note])
        assert len(files) == 1
        _path, content = files[0]
        payload = content.decode("utf-8")
        assert len(payload) <= RESEARCH_NOTE_MAX_CHARS + 200
        assert "[... truncated:" in payload

    def test_truncated_note_stays_valid_json(self):
        q = _make_query("big test")
        note = self._big_note()
        _path, content = _research_note_files([q], [note])[0]
        reparsed = ResearchNotes.model_validate(json.loads(content.decode("utf-8")))
        assert "[... truncated:" in reparsed.summary

    def test_small_note_passes_through(self):
        q = _make_query("small test")
        note = ResearchNotes(
            query_topic="small",
            target_components=["test"],
            summary="Small note.",
            findings=[],
            gaps=[],
            sources=[],
            narrative_notes="",
            language="English",
            evidence_judgment=None,
        )
        files = _research_note_files([q], [note])
        _path, content = files[0]
        payload = content.decode("utf-8")
        assert "Small note." in payload
        assert "[... truncated:" not in payload


class _FakeModelRequest:
    def __init__(self, msgs):
        self.messages = msgs

    def override(self, *, messages):
        return _FakeModelRequest(messages)


class TestTotalCharBudget:
    async def _sent(self, middleware, messages):
        captured = []

        async def handler(request):
            captured[:] = list(request.messages)

        await middleware.awrap_model_call(_FakeModelRequest(messages), handler)
        return captured

    @pytest.mark.asyncio
    async def test_total_budget_truncates_oldest_oversized(self):
        middleware = ToolResultPruningMiddleware(keep_last_n=10, max_chars=100, total_char_budget=300)
        messages = [
            ToolMessage(content="x" * 200, tool_call_id=f"tc{i}", name=f"tool{i}", id=f"msg{i}") for i in range(4)
        ]

        sent = await self._sent(middleware, list(messages))

        assert sent[0].content.endswith("[... truncated ...]")

    @pytest.mark.asyncio
    async def test_under_budget_no_extra_truncation(self):
        middleware = ToolResultPruningMiddleware(keep_last_n=10, max_chars=100, total_char_budget=900)
        messages = [
            ToolMessage(content="x" * 200, tool_call_id=f"tc{i}", name=f"tool{i}", id=f"msg{i}") for i in range(4)
        ]

        sent = await self._sent(middleware, list(messages))

        assert all(len(m.content) == 200 for m in sent)

    @pytest.mark.asyncio
    async def test_zero_budget_disabled(self):
        middleware = ToolResultPruningMiddleware(keep_last_n=3, max_chars=100, total_char_budget=0)
        messages = [
            ToolMessage(content="x" * 200, tool_call_id=f"tc{i}", name=f"tool{i}", id=f"msg{i}") for i in range(4)
        ]

        sent = await self._sent(middleware, list(messages))

        assert sent[0].content.endswith("[... truncated ...]")
        assert len(sent[1].content) == 200


class TestBudgetThroughBatchToolPath:
    def _batch_tool(self):
        runnable = MagicMock()
        runnable.ainvoke = AsyncMock(side_effect=RunBudgetExceededError(ceiling=1000, used=1500))
        return build_research_batch_tool(
            researcher_runnable=runnable,
            callbacks=[],
            max_research_concurrency=2,
            researcher_tool_names={"web_search_tool"},
        )

    def _middleware(self) -> SelectiveToolRetryMiddleware:
        return SelectiveToolRetryMiddleware(
            max_retries=3,
            backoff_factor=0.0,
            initial_delay=0.0,
            jitter=False,
            retry_on=is_retryable_tool_error,
            no_retry_tools={"run_research_batch"},
        )

    @pytest.mark.asyncio
    async def test_batch_tool_alone_reraises_budget(self):
        batch_tool = self._batch_tool()

        with pytest.raises(RunBudgetExceededError):
            await batch_tool.ainvoke({"queries": [_make_query()]})

    @pytest.mark.asyncio
    async def test_batch_through_middleware_propagates_without_retry_loop(self):
        from types import SimpleNamespace

        batch_tool = self._batch_tool()
        middleware = self._middleware()
        executions = 0

        async def handler(request):
            nonlocal executions
            executions += 1
            await batch_tool.ainvoke({"queries": [_make_query()]})
            raise AssertionError("unreachable: batch tool must raise")

        request = MagicMock()
        request.tool = SimpleNamespace(name="run_research_batch")
        request.tool_call = {"name": "run_research_batch", "id": "tc1"}

        with pytest.raises(RunBudgetExceededError) as exc_info:
            await middleware.awrap_tool_call(request, handler)

        assert executions == 1
        assert exc_info.value.ceiling == 1000
        assert exc_info.value.used == 1500


class TestAddedDocumentsReachTheOrchestrator:
    @pytest.mark.asyncio
    async def test_a_live_addition_is_announced_on_the_next_batch_result(self):
        from agent.agents.deep_researcher.control import bind_added_documents
        from agent.agents.deep_researcher.control import reset_added_documents
        from agent.agents.deep_researcher.tools.research import ADDED_DOCUMENTS_NOTICE
        from agent.common.plan_documents import PlanDocument

        runnable = _fake_runnable(_structured_response())
        batch_tool = build_research_batch_tool(
            researcher_runnable=runnable,
            callbacks=[],
            max_research_concurrency=2,
            researcher_tool_names={"web_search_tool"},
        )
        queue: list[PlanDocument] = [PlanDocument(name="nachtrag.pdf", title="Nachtrag")]
        token = bind_added_documents(queue)
        try:
            result = await batch_tool.ainvoke({"queries": [_make_query("first")]})
            assert result.startswith(ADDED_DOCUMENTS_NOTICE.split("{lines}")[0].rstrip("\n"))
            assert "- Nachtrag — nachtrag.pdf" in result
            payload = json.loads(result.split("\n\n", 1)[1])
            assert payload[0]["query_topic"] == "test"
            again = await batch_tool.ainvoke({"queries": [_make_query("second")]})
            assert not again.startswith(ADDED_DOCUMENTS_NOTICE[:20])
        finally:
            reset_added_documents(token)


class TestWriteNowIsHonouredOnlyByARefusal:
    @pytest.mark.asyncio
    async def test_a_refused_batch_is_recorded_and_a_ran_batch_is_not(self):
        import asyncio

        from agent.agents.deep_researcher.control import begin_write_now_record
        from agent.agents.deep_researcher.control import bind_write_now
        from agent.agents.deep_researcher.control import end_write_now_record
        from agent.agents.deep_researcher.control import reset_write_now
        from agent.agents.deep_researcher.control import write_now_honoured
        from agent.agents.deep_researcher.tools.research import WRITE_NOW_NOTICE

        batch_tool = build_research_batch_tool(
            researcher_runnable=_fake_runnable(_structured_response()),
            callbacks=[],
            max_research_concurrency=2,
            researcher_tool_names={"web_search_tool"},
        )
        signal = asyncio.Event()
        record = begin_write_now_record()
        token = bind_write_now(signal)
        try:
            await batch_tool.ainvoke({"queries": [_make_query("first")]})
            signal.set()
            assert write_now_honoured() is False
            assert await batch_tool.ainvoke({"queries": [_make_query("second")]}) == WRITE_NOW_NOTICE
            assert write_now_honoured() is True
        finally:
            reset_write_now(token)
            end_write_now_record(record)
