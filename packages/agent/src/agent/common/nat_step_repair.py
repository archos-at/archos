from __future__ import annotations

import logging
import time
import weakref
from typing import Any
from uuid import UUID

from nat.builder.intermediate_step_manager import IntermediateStepManager
from nat.data_models.intermediate_step import IntermediateStepPayload
from nat.data_models.intermediate_step import IntermediateStepState
from nat.data_models.intermediate_step import IntermediateStepType
from nat.data_models.intermediate_step import StreamEventData
from nat.data_models.intermediate_step import TraceMetadata
from nat.data_models.intermediate_step import UsageInfo
from nat.data_models.token_usage import TokenUsageBaseModel
from nat.plugin_api import ContextState
from nat.plugin_api import LLMFrameworkEnum
from nat.plugins.langchain.callback_handler import LangchainProfilerHandler

logger = logging.getLogger(__name__)


class SpanClosingProfilerHandler(LangchainProfilerHandler):
    def for_new_run(self) -> SpanClosingProfilerHandler:
        return SpanClosingProfilerHandler()

    async def on_llm_error(self, error: BaseException, *, run_id: UUID, **kwargs: Any) -> None:
        run_id_str = str(run_id)
        model_name = self._run_id_to_model_name.get(run_id_str, "")
        error_text = f"{type(error).__name__}: {error}"

        with self._lock:
            usage_stat = IntermediateStepPayload(
                span_event_timestamp=self._run_id_to_start_time.get(run_id_str, time.time()),
                event_type=IntermediateStepType.LLM_END,
                framework=LLMFrameworkEnum.LANGCHAIN,
                name=model_name,
                UUID=run_id_str,
                data=StreamEventData(
                    input=self._run_id_to_llm_input.get(run_id_str, ""),
                    output=error_text,
                ),
                usage_info=UsageInfo(token_usage=TokenUsageBaseModel()),
                metadata=TraceMetadata(error=error_text, error_type=type(error).__name__),
            )

            self.step_manager.push_intermediate_step(usage_stat)

        self._state = IntermediateStepType.LLM_END

    async def on_tool_error(self, error: BaseException, *, run_id: UUID, **kwargs: Any) -> None:
        run_id_str = str(run_id)
        tool_name = kwargs.get("name", "")
        error_text = f"{type(error).__name__}: {error}"

        stats = IntermediateStepPayload(
            event_type=IntermediateStepType.TOOL_END,
            span_event_timestamp=self._run_id_to_start_time.get(run_id_str, time.time()),
            framework=LLMFrameworkEnum.LANGCHAIN,
            name=tool_name,
            UUID=run_id_str,
            metadata=TraceMetadata(tool_outputs=error_text, error=error_text, error_type=type(error).__name__),
            usage_info=UsageInfo(token_usage=TokenUsageBaseModel()),
            data=StreamEventData(
                input=self._run_id_to_tool_input.get(run_id_str, ""),
                output=error_text,
                payload=error_text,
            ),
        )

        self.step_manager.push_intermediate_step(stats)

    async def on_retry(self, retry_state: Any, *, run_id: UUID, **kwargs: Any) -> None:
        logger.debug("LangChain run %s retrying: %s", run_id, retry_state)


_ENDED_STEPS: weakref.WeakKeyDictionary[object, set[str]] = weakref.WeakKeyDictionary()


def _drop_ended_tail(state: ContextState) -> None:
    stream = state.event_stream.get()
    ended = _ENDED_STEPS.get(stream) if stream is not None else None
    if not ended:
        return
    stack = state.active_span_id_stack.get()
    keep = len(stack)
    while keep > 1 and stack[keep - 1] in ended:
        keep -= 1
    if keep < len(stack):
        state.active_span_id_stack.set(stack[:keep])


def install_step_stack_repair() -> None:
    original = IntermediateStepManager.push_intermediate_step
    if getattr(original, "_stack_repair", False):
        return

    def push_intermediate_step(self: IntermediateStepManager, payload: IntermediateStepPayload) -> None:
        state = self._context_state
        if payload.event_state == IntermediateStepState.START:
            _drop_ended_tail(state)
        original(self, payload)
        if payload.event_state == IntermediateStepState.END:
            stream = state.event_stream.get()
            if stream is not None:
                _ENDED_STEPS.setdefault(stream, set()).add(payload.UUID)

    push_intermediate_step._stack_repair = True  # type: ignore[attr-defined]
    IntermediateStepManager.push_intermediate_step = push_intermediate_step  # type: ignore[method-assign]
