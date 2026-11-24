from __future__ import annotations

import logging
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler

logger = logging.getLogger(__name__)

PLANNER_AGENT_NAME = "planner-agent"
WRITER_AGENT_NAME = "writer-agent"

TASK_TOOL_NAME = "task"
RESEARCH_BATCH_TOOL_NAME = "run_research_batch"

PHASE_PLANNING_STARTED = "planning_started"
PHASE_RESEARCH_STARTED = "research_started"
PHASE_WRITING_STARTED = "writing_started"
PHASE_CITATION_VERIFICATION_STARTED = "citation_verification_started"
PHASE_DONE = "done"

JOB_PHASE_EVENT_TYPE = "job.phase"


def emit_phase_event(event_store: Any, phase: str, **extra: Any) -> None:
    if event_store is None:
        return
    try:
        event_store.store({"type": JOB_PHASE_EVENT_TYPE, "data": {"phase": phase, **extra}})
    except Exception:
        logger.warning("Failed to store job.phase event %r (non-fatal)", phase, exc_info=True)


class PhaseProgressCallback(BaseCallbackHandler):
    def __init__(self, event_store: Any, max_research_concurrency: int | None = None) -> None:
        super().__init__()
        self._event_store = event_store
        self._max_research_concurrency = max_research_concurrency
        self._emitted_once: set[str] = set()
        self._run_id_subagent: dict[str, str] = {}
        self._research_batch_count = 0

    def _emit_once(self, phase: str, **extra: Any) -> None:
        if phase in self._emitted_once:
            return
        self._emitted_once.add(phase)
        emit_phase_event(self._event_store, phase, **extra)

    @staticmethod
    def _tool_name(serialized: dict | None, kwargs: dict) -> str:
        if serialized:
            return serialized.get("name", "") or ""
        return kwargs.get("name", "") or ""

    @staticmethod
    def _inputs_dict(input_str: str, kwargs: dict) -> dict | None:
        inputs = kwargs.get("inputs")
        if isinstance(inputs, dict):
            return inputs
        if not input_str:
            return None
        import ast

        try:
            parsed = ast.literal_eval(input_str)
        except Exception:
            return None
        return parsed if isinstance(parsed, dict) else None

    def on_tool_start(self, serialized: dict | None, input_str: str, **kwargs: Any) -> None:
        tool_name = self._tool_name(serialized, kwargs)
        run_id = str(kwargs.get("run_id", "")) if kwargs.get("run_id") is not None else ""

        if tool_name == TASK_TOOL_NAME:
            inputs = self._inputs_dict(input_str, kwargs)
            subagent_type = inputs.get("subagent_type") if isinstance(inputs, dict) else None
            if not isinstance(subagent_type, str):
                return
            if run_id:
                self._run_id_subagent[run_id] = subagent_type
            if subagent_type == PLANNER_AGENT_NAME:
                self._emit_once(PHASE_PLANNING_STARTED)
            elif subagent_type == WRITER_AGENT_NAME:
                self._emit_once(PHASE_WRITING_STARTED)
            return

        if tool_name == RESEARCH_BATCH_TOOL_NAME:
            inputs = self._inputs_dict(input_str, kwargs)
            queries = inputs.get("queries") if isinstance(inputs, dict) else None
            self._research_batch_count += 1
            extra: dict[str, Any] = {"batch_index": self._research_batch_count}
            if isinstance(queries, list):
                extra["batch_size"] = len(queries)
            conclusion = inputs.get("conclusion") if isinstance(inputs, dict) else None
            if isinstance(conclusion, str) and conclusion.strip():
                extra["conclusion"] = conclusion.strip()
            if self._max_research_concurrency:
                extra["max_concurrency"] = self._max_research_concurrency
            emit_phase_event(self._event_store, PHASE_RESEARCH_STARTED, **extra)

    def on_tool_end(self, output: Any, **kwargs: Any) -> None:
        run_id = str(kwargs.get("run_id", "")) if kwargs.get("run_id") is not None else ""
        subagent_type = self._run_id_subagent.pop(run_id, None) if run_id else None
        if subagent_type == WRITER_AGENT_NAME:
            self._emit_once(PHASE_CITATION_VERIFICATION_STARTED)
