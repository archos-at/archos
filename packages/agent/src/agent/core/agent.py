from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Sequence
from dataclasses import replace
from typing import Any
from typing import Protocol
from typing import runtime_checkable

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage
from langchain_core.messages import ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import BaseTool
from langgraph.graph import StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.prebuilt import ToolNode
from langgraph.prebuilt import tools_condition

from agent.citations.registry import SourceRegistry
from agent.citations.session import begin_turn_capture
from agent.citations.session import end_turn_capture
from agent.citations.session import get_session_registry
from agent.citations.session import get_turn_captures
from agent.citations.session import reset_session_registry
from agent.common import LLMProvider
from agent.common import LLMRole
from agent.common import content_to_text
from agent.common.grounding_block import end_grounding_capture
from agent.common.licensed_recall import open_grounding_capture
from agent.common.model_vision import chat_model_scope
from agent.common.model_vision import model_name_of
from agent.common.prompt_caching import begin_stable_prefix
from agent.common.prompt_caching import end_stable_prefix
from agent.common.retrieval_rounds import failed_call_ids
from agent.common.retrieval_rounds import ran_signatures
from agent.common.retrieval_status import emit_retrieval
from agent.common.retrieval_status import emit_synthesis
from agent.common.retrieval_status import record_round_announcement
from agent.common.steering import AppliedSteer
from agent.common.tool_calls import is_retrieval_round
from agent.common.tool_errors import render_tool_error
from agent.common.turn_notices import emit_input_budget_exhausted
from agent.common.turn_notices import emit_research_truncated
from agent.common.turn_status import begin_lane_capture
from agent.common.turn_status import end_lane_capture
from agent.common.turn_status import get_lane_captures
from agent.common.turn_status import retrieval_round_scope
from agent.knowledge.already_read import merge_digest
from agent.knowledge.restricted_use import admit_tool_results
from agent.knowledge.restricted_use import report_collections_read
from agent.observability.langfuse_trace_attributes import begin_turn_prompt_link
from agent.observability.langfuse_trace_attributes import end_turn_prompt_link
from agent.tools.bim.measurement_sources import begin_measurement_capture
from agent.tools.bim.measurement_sources import end_measurement_capture
from agent.tools.bim.measurement_sources import get_measurement_captures
from agent.turn.answer_stream import streaming_call

from .answer_check import turn_check
from .answer_pipeline import CardRepairFn
from .answer_pipeline import FinalAnswer
from .answer_pipeline import LiveAnswer
from .answer_pipeline import RepairFn
from .answer_pipeline import finalize_answer
from .answer_pipeline import handed_this_turn
from .envelope_call import ainvoke
from .envelope_call import ainvoke_synthesis
from .envelope_call import ainvoke_with_envelope_json_mode
from .grounding import tool_result_is_measurement
from .ledger import assemble_result
from .models import ResearchAgentState
from .prompt import TurnPrompt
from .prompt import build_tools_info
from .prompt import cached_prompt_fields
from .prompt import cached_turn_prompt
from .prompt import render_turn_prompt
from .prompt import request_messages
from .prompt import shelf_label
from .prompt import stamp_static_prompt_for_turn
from .prompt import system_prompt_template
from .quote_patch import quote_patcher
from .round_charge import SKILL_READ_SHAPE
from .round_charge import _charge_tool_calls
from .round_charge import _executing_retrieval_round
from .round_charge import _starts_synthesis
from .round_charge import _tool_call_shape
from .round_split import _fetch_results
from .round_split import _split_round
from .round_split import _without_dropped_calls
from .source_capture import _bind_registry
from .source_capture import _capture_sources
from .source_capture import _report_family_coverage
from .source_capture import _without_trace_lanes
from .turn_binding import _DEFAULT_MAX_CALLS_PER_ROUND
from .turn_binding import _DEFAULT_MAX_INPUT_TOKENS_PER_TURN
from .turn_binding import _TURN_BINDING_KEY
from .turn_binding import CUTOFF_INPUT_TOKENS
from .turn_binding import TurnBinding
from .turn_binding import TurnConfig
from .turn_binding import _recursion_limit
from .turn_binding import _turn_cutoff
from .turn_binding import _turn_input_tokens
from .turn_steering import _hold_writes_for_steer
from .turn_steering import _take_steering

logger = logging.getLogger(__name__)

_shelf_label = shelf_label

_SYNTHESIS_ANCHOR = (
    "The research limit for this turn is reached; answer from what you have and say what you could not check. "
    "Answer as your ```answer_json envelope object, using the citations [1], [2] and the '## References' format. "
    "No further tool calls."
)


@runtime_checkable
class FinalReportSink(Protocol):
    def emit_final_report(self, text: str) -> None: ...


def _turn_index(state: ResearchAgentState) -> int:
    try:
        return max(1, sum(1 for message in state.messages if isinstance(message, HumanMessage)))
    except Exception:  # noqa: BLE001 — a turn number must never take a turn down
        return 1


def _live_answer(state: ResearchAgentState) -> LiveAnswer | None:
    registry = get_session_registry()
    if registry is None:
        return None
    return LiveAnswer(
        registry,
        handed=handed_this_turn(state.messages),
    )


PREFETCH_NOTE = (
    "Passages retrieved automatically for this message follow. Use them if they answer the question; "
    "search further if they don't."
)


class ChatAgent:
    state_model = ResearchAgentState

    def __init__(
        self,
        llm_provider: LLMProvider,
        tools: Sequence[BaseTool],
        *,
        system_prompt: str | None = None,
        max_tool_iterations: int = 5,
        max_input_tokens_per_turn: int = _DEFAULT_MAX_INPUT_TOKENS_PER_TURN,
        max_calls_per_round: int = _DEFAULT_MAX_CALLS_PER_ROUND,
        callbacks: list[Any] | None = None,
        envelope_json_mode_with_tools: bool = False,
        repair_pass: bool = True,
        card_repair_llm: BaseChatModel | None = None,
        claim_judge_llm: BaseChatModel | None = None,
    ) -> None:
        self.card_repair_llm = card_repair_llm
        self.claim_judge_llm = claim_judge_llm
        self.llm_provider = llm_provider
        self.tools = list(tools)
        self.max_tool_iterations = max_tool_iterations
        self.max_input_tokens_per_turn = max_input_tokens_per_turn
        self.max_calls_per_round = max_calls_per_round
        self.callbacks = callbacks or []
        self.repair_pass = repair_pass
        self.envelope_json_mode_with_tools = envelope_json_mode_with_tools
        self.system_prompt = system_prompt or system_prompt_template()
        self.tools_info = build_tools_info(self.tools)
        self._boot = self._bind_turn(self.llm_provider, tuple(self.tools))
        self._graph = self._build_graph()

    @property
    def _llm_with_tools(self) -> Any:
        return self._boot.llm_with_tools

    @property
    def tool_iteration_ceiling(self) -> int:
        return self.max_tool_iterations

    @property
    def graph(self) -> CompiledStateGraph:
        return self._graph

    def _get_llm(self) -> BaseChatModel:
        return self.llm_provider.get(LLMRole.RESEARCHER)

    def _bind_research_tools(self, llm: BaseChatModel, tools: Sequence[BaseTool]) -> Any:
        return llm.bind_tools(list(tools), parallel_tool_calls=True)

    def _bind_turn(self, provider: LLMProvider, tools: tuple[BaseTool, ...]) -> TurnBinding:
        llm = provider.get(LLMRole.RESEARCHER)
        boot_tools = tools == tuple(self.tools)
        return TurnBinding(
            llm=llm,
            llm_with_tools=self._bind_research_tools(llm, tools),
            tools=tools,
            tools_info=self.tools_info if boot_tools else build_tools_info(tools),
            tool_node=ToolNode(
                list(tools), handle_tool_errors=render_tool_error, awrap_tool_call=report_collections_read
            ),
            source_tool_names=frozenset(t.name for t in tools),
            ceiling=self.max_tool_iterations,
            max_input_tokens=self.max_input_tokens_per_turn,
            max_calls_per_round=self.max_calls_per_round,
        )

    def _resolve_turn(self, turn: TurnConfig | None) -> TurnBinding:
        if turn is None:
            return self._boot
        provider = turn.llm_provider or self.llm_provider
        tools = tuple(self.tools if turn.tools is None else turn.tools)
        boot = provider is self.llm_provider and tools == self._boot.tools
        base = self._boot if boot else self._bind_turn(provider, tools)
        if turn.disabled_sources == base.disabled_sources and not turn.prefetch:
            return base
        return replace(base, disabled_sources=frozenset(turn.disabled_sources), prefetch=tuple(turn.prefetch))

    def _build_graph(self) -> CompiledStateGraph:
        builder = StateGraph(ResearchAgentState)
        builder.set_entry_point("prefetch")
        builder.add_node("prefetch", self._prefetch_node)
        builder.add_node("agent", self._agent_node)
        builder.add_node("tools", self._tools_node)
        builder.add_edge("prefetch", "agent")
        builder.add_conditional_edges("agent", tools_condition, {"tools": "tools", "__end__": "__end__"})
        builder.add_edge("tools", "agent")
        return builder.compile()

    def _turn_binding(self, config: RunnableConfig) -> TurnBinding:
        return (config.get("configurable") or {}).get(_TURN_BINDING_KEY) or self._boot

    async def _agent_node(self, state: ResearchAgentState, config: RunnableConfig) -> dict[str, Any]:
        binding = self._turn_binding(config)
        tools_info = state.tools_info if state.tools_info else binding.tools_info
        llm_with_tools = binding.llm_with_tools
        prompt = cached_turn_prompt(state)
        if prompt is None:
            prompt = await asyncio.to_thread(render_turn_prompt, self.system_prompt, state, tools_info)
        taken = _take_steering(state)
        steering = state.steering if taken is None else taken
        cutoff = _turn_cutoff(state, binding)
        if cutoff is not None:
            return await self._forced_synthesis(state, binding, prompt, cutoff=cutoff, steering=steering)

        messages = request_messages(prompt, state.messages, steering)
        answering, call_config = streaming_call(llm_with_tools, live=_live_answer(state))
        if self.envelope_json_mode_with_tools:
            response = await ainvoke_with_envelope_json_mode(answering, messages, call_config)
        else:
            response = await ainvoke(answering, messages, call_config)
        if _starts_synthesis(response, state):
            emit_synthesis()
        rounds, retrieval_round, round_record = _charge_tool_calls(
            response, state, binding.ceiling, binding.disabled_sources, binding.max_calls_per_round
        )
        update: dict[str, Any] = {
            "messages": [response],
            "tool_iterations": rounds,
            "retrieval_round": retrieval_round,
            **cached_prompt_fields(prompt),
        }
        if round_record is not None:
            update["retrieval_rounds"] = [*state.retrieval_rounds, round_record]
        if taken is not None:
            update["steering"] = taken
        return update

    def _record_cutoff(self, state: ResearchAgentState, binding: TurnBinding, cutoff: str) -> None:
        shape = _tool_call_shape(state.messages)
        input_tokens = _turn_input_tokens()
        # nosemgrep: python.lang.security.audit.logging.logger-credential-leak.python-logger-credential-disclosure
        logger.warning(
            "Forcing synthesis (%s): ceiling=%d rounds_spent=%d input_tokens=%d/%d skill_calls=%d shape=%s",
            cutoff,
            binding.ceiling,
            state.tool_iterations,
            input_tokens,
            binding.max_input_tokens,
            shape.count(SKILL_READ_SHAPE),
            ">".join(shape) or "-",
        )
        if cutoff == CUTOFF_INPUT_TOKENS:
            emit_input_budget_exhausted(
                limit=binding.max_input_tokens,
                spent=input_tokens,
                rounds=state.tool_iterations,
                shape=shape,
            )
            return
        emit_research_truncated(
            ceiling=binding.ceiling,
            research_budget=self.max_tool_iterations,
            spent=state.tool_iterations,
            rounds=state.tool_iterations,
            shape=shape,
        )

    async def _forced_synthesis(
        self,
        state: ResearchAgentState,
        binding: TurnBinding,
        prompt: TurnPrompt,
        *,
        cutoff: str,
        steering: Sequence[AppliedSteer] = (),
    ) -> dict[str, Any]:
        self._record_cutoff(state, binding, cutoff)
        if state.tool_iterations > 0:
            emit_synthesis()
        messages = [
            *request_messages(prompt, state.messages, steering),
            HumanMessage(content=_SYNTHESIS_ANCHOR),
        ]
        response = await ainvoke_synthesis(binding, messages, _live_answer(state), self.envelope_json_mode_with_tools)
        return {
            "messages": [response],
            "tool_iterations": state.tool_iterations,
            **cached_prompt_fields(prompt),
            "research_truncated": True,
            "steering": list(steering),
        }

    async def _tools_node(self, state: ResearchAgentState, config: RunnableConfig) -> dict[str, Any]:
        binding = self._turn_binding(config)
        split = _split_round(state, binding.disabled_sources, binding.max_calls_per_round)
        executing_round = _executing_retrieval_round(state, split.ran)
        split = _hold_writes_for_steer(state, split)
        withheld = split.withheld
        with retrieval_round_scope(executing_round), chat_model_scope(model_name_of(binding.llm)):
            result = await binding.tool_node.ainvoke(_without_dropped_calls(state, withheld) if withheld else state)
        registry = get_session_registry()
        if registry is None:
            raise RuntimeError("ChatAgent graph invoked outside run(): no source registry is bound")
        ran_messages = await admit_tool_results(list(result.get("messages", [])))
        measured = self._capture_round(ran_messages, binding, registry, state)
        ran_messages = [_without_trace_lanes(message) for message in ran_messages]
        result = {**result, "messages": ran_messages}
        failed_ids = failed_call_ids(ran_messages)
        fetch_results = {**state.fetch_results, **_fetch_results(split.ran, ran_messages, failed_ids)}
        if withheld:
            result = {**result, "messages": [*ran_messages, *split.notices(fetch_results)]}
        result = {
            **result,
            "executed_fetches": [*state.executed_fetches, *ran_signatures(split.ran, failed_ids)],
            "fetch_results": fetch_results,
        }
        if measured:
            return {**result, "answer_measurement_grounded": True}
        return result

    def _capture_round(
        self,
        messages: Sequence[Any],
        binding: TurnBinding,
        registry: SourceRegistry,
        state: ResearchAgentState,
    ) -> bool:
        measured = bool(state.answer_measurement_grounded)
        for message in messages:
            if not isinstance(message, ToolMessage) or not message.content:
                continue
            if getattr(message, "status", None) == "error":
                continue
            tool_name = getattr(message, "name", "") or ""
            content = content_to_text(message.content) if isinstance(message.content, list) else str(message.content)
            measured = measured or tool_result_is_measurement(tool_name, content)
            _capture_sources(
                tool_name, content, binding.source_tool_names, registry, getattr(message, "artifact", None)
            )
        return measured

    def _graph_config(self, binding: TurnBinding) -> dict[str, Any]:
        config: dict[str, Any] = {
            "recursion_limit": _recursion_limit(binding.ceiling),
            "configurable": {_TURN_BINDING_KEY: binding},
        }
        if self.callbacks:
            config["callbacks"] = self.callbacks
        return config

    def _repairer(self) -> RepairFn | None:
        if not self.repair_pass or self.card_repair_llm is None:
            return None
        return quote_patcher(self.card_repair_llm)

    def _card_repairer(self) -> CardRepairFn | None:
        llm = self.card_repair_llm
        if llm is None:
            return None

        async def repair(card: dict[str, Any], refusal: str, answer: str) -> dict[str, Any] | None:
            from agent.cards.repair import repair_card

            return await repair_card(llm, card, refusal, answer)

        return repair

    async def _prefetch_node(self, state: ResearchAgentState, config: RunnableConfig) -> dict[str, Any]:
        binding = self._turn_binding(config)
        if not binding.prefetch:
            return {}
        bound = {tool.name for tool in binding.tools}
        turn_key = uuid.uuid4().hex[:8]
        calls = [
            {"name": str(call["name"]), "args": dict(call.get("args") or {}), "id": f"prefetch-{turn_key}-{index}"}
            for index, call in enumerate(binding.prefetch, 1)
            if isinstance(call, dict) and call.get("name") in bound
        ]
        if not calls:
            return {}
        announcement = AIMessage(content=PREFETCH_NOTE, tool_calls=calls)
        announced = state.model_copy(update={"messages": [*state.messages, announcement]})
        split = _split_round(announced, binding.disabled_sources, binding.max_calls_per_round)
        if not split.ran or not is_retrieval_round(split.ran):
            return {}
        searched = emit_retrieval(split.ran, round_index=state.retrieval_round, conclusion=None, prefetch=True)
        record = record_round_announcement(round_index=state.retrieval_round, calls=split.ran, conclusion=None)
        announced = announced.model_copy(
            update={
                "retrieval_round": state.retrieval_round + (1 if searched else 0),
                "retrieval_rounds": [*state.retrieval_rounds, *([record] if record else [])],
            }
        )
        result = await self._tools_node(announced, config)
        logger.info("Prefetched %d fetch(es) as round 0", len(split.ran))
        return {
            **{key: value for key, value in result.items() if key != "messages"},
            "messages": [announcement, *result.get("messages", [])],
            "retrieval_round": announced.retrieval_round,
            "retrieval_rounds": announced.retrieval_rounds,
        }

    def _emit_final_report(self, final: FinalAnswer) -> None:
        if not final.answered or final.content is None:
            return
        for callback in self.callbacks:
            if isinstance(callback, FinalReportSink):
                callback.emit_final_report(final.content)
                return

    async def run(
        self,
        state: ResearchAgentState,
        *,
        turn: TurnConfig | None = None,
    ) -> ResearchAgentState:
        binding = self._resolve_turn(turn)
        prompt_link = begin_turn_prompt_link()
        stable_prefix = begin_stable_prefix(await stamp_static_prompt_for_turn(state.messages))
        registry, registry_token = _bind_registry()
        turn_capture = begin_turn_capture()
        measurement_capture = begin_measurement_capture()
        lane_capture = begin_lane_capture()
        grounding_capture = await open_grounding_capture(state.licensed_text_allowed, state.messages)
        try:
            graph_result = await self._graph.ainvoke(state, config=self._graph_config(binding))
            turn_sources = get_turn_captures()
            turn_measurements = get_measurement_captures()
            lane_hits = get_lane_captures()
        finally:
            end_grounding_capture(grounding_capture)
            end_lane_capture(lane_capture)
            end_measurement_capture(measurement_capture)
            end_turn_capture(turn_capture)
            end_stable_prefix(stable_prefix)
            end_turn_prompt_link(prompt_link)
            if registry_token is not None:
                reset_session_registry(registry_token)

        _report_family_coverage(turn_sources)

        final = await finalize_answer(
            graph_result.get("messages") or [],
            registry=registry,
            tools=binding.tools,
            repair=self._repairer(),
            turn_sources=turn_sources,
            card_repair=self._card_repairer(),
            measured_values=[measurement.value_text for measurement in turn_measurements],
            check=turn_check(state, self.claim_judge_llm),
        )
        self._emit_final_report(final)
        merged_digest = merge_digest(state.already_read_digest, turn_sources, _turn_index(state))
        result = assemble_result(
            graph_result,
            final,
            turn_sources=turn_sources,
            turn_measurements=turn_measurements,
            lane_hits=lane_hits,
        )
        result.already_read_digest = merged_digest
        return result
