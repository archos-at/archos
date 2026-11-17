from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections.abc import Iterable
from collections.abc import Mapping
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
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

from agent.citations.entries import is_look_place
from agent.citations.entries import is_look_tool
from agent.citations.extraction import extract_sources_from_tool_result
from agent.citations.registry import SourceRegistry
from agent.citations.session import begin_turn_capture
from agent.citations.session import end_turn_capture
from agent.citations.session import get_session_registry
from agent.citations.session import get_turn_captures
from agent.citations.session import record_turn_capture
from agent.citations.session import reset_session_registry
from agent.citations.session import set_session_registry
from agent.common import LLMProvider
from agent.common import LLMRole
from agent.common import content_to_text
from agent.common.cost_tracking import cost_tracker_var
from agent.common.data_sources import disabled_source_notice
from agent.common.data_sources import source_id_for_call
from agent.common.grounding_block import end_grounding_capture
from agent.common.grounding_block import strip_trace_lanes
from agent.common.licensed_recall import open_grounding_capture
from agent.common.model_vision import chat_model_scope
from agent.common.model_vision import model_name_of
from agent.common.prompt_caching import begin_stable_prefix
from agent.common.prompt_caching import end_stable_prefix
from agent.common.retrieval_rounds import assistant_checkpoint
from agent.common.retrieval_rounds import failed_call_ids
from agent.common.retrieval_rounds import ran_signatures
from agent.common.retrieval_rounds import repeat_fetches
from agent.common.retrieval_rounds import signatures_of
from agent.common.retrieval_status import emit_retrieval
from agent.common.retrieval_status import emit_synthesis
from agent.common.retrieval_status import record_round_announcement
from agent.common.steering import HELD_FOR_STEER
from agent.common.steering import AppliedSteer
from agent.common.steering import SteerInbox
from agent.common.steering import SteerNote
from agent.common.steering import current_steer_inbox
from agent.common.steering import is_write_call
from agent.common.steering import render_note
from agent.common.tool_calls import fetch_signature
from agent.common.tool_calls import is_retrieval_round
from agent.common.tool_calls import is_skill_read
from agent.common.tool_calls import tool_basename
from agent.common.tool_errors import render_tool_error
from agent.common.turn_notices import emit_family_coverage
from agent.common.turn_notices import emit_input_budget_exhausted
from agent.common.turn_notices import emit_refused_source
from agent.common.turn_notices import emit_repeat_fetch
from agent.common.turn_notices import emit_research_truncated
from agent.common.turn_notices import emit_steered_writes
from agent.common.turn_notices import emit_width_cap
from agent.common.turn_status import begin_lane_capture
from agent.common.turn_status import emit
from agent.common.turn_status import end_lane_capture
from agent.common.turn_status import get_lane_captures
from agent.common.turn_status import retrieval_round_scope
from agent.common.wire_v2 import SteerAppliedBody
from agent.common.wire_v2 import SteerAppliedValue
from agent.knowledge.already_read import merge_digest
from agent.knowledge.restricted_use import admit_tool_results
from agent.knowledge.restricted_use import report_collections_read
from agent.observability.langfuse_trace_attributes import add_trace_tag
from agent.observability.langfuse_trace_attributes import begin_turn_prompt_link
from agent.observability.langfuse_trace_attributes import end_turn_prompt_link
from agent.observability.retrieval_trace import emit_step_span
from agent.observability.turn_outcome import record_turn_facts
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

logger = logging.getLogger(__name__)

_shelf_label = shelf_label

_DEFAULT_MAX_INPUT_TOKENS_PER_TURN = 600_000

_REPEAT_FETCH_PREFIX = (
    "Repeated call: this call already ran identically in this turn and was not executed "
    "again. Below is its earlier result, unchanged — continue with a different place "
    "or a different question."
)

_REPEAT_FETCH_MESSAGE = (
    "Not executed: this call already ran identically in this turn; "
    "the result above is the answer — continue with a different place or a different question, "
    "not with a repetition"
)

_FAILED_FETCH_REPEAT_MESSAGE = (
    "Not executed: this call was already included once in this round, and that first "
    "attempt failed — there is no result. You can make it again in the next round "
    "or choose a different place."
)

_DEFAULT_MAX_CALLS_PER_ROUND = 12

_WIDTH_CAP_MESSAGE = (
    "Not executed: this round requested more parallel calls than a round may "
    "run. The first calls of the round ran; this one did not. Make it again in the next "
    "round if you still need it after the results above."
)

CUTOFF_ROUNDS = "rounds"
CUTOFF_INPUT_TOKENS = "input_tokens"

_TURN_BINDING_KEY = "piloti_turn"

STEERED_TAG = "steered"

_SYNTHESIS_ANCHOR = (
    "The research limit for this turn is reached; answer from what you have and say what you could not check. "
    "Answer as your ```answer_json envelope object, using the citations [1], [2] and the '## References' format. "
    "No further tool calls."
)


@runtime_checkable
class FinalReportSink(Protocol):

    def emit_final_report(self, text: str) -> None: ...


@dataclass(frozen=True)
class TurnConfig:

    llm_provider: LLMProvider | None = None
    tools: Sequence[BaseTool] | None = None
    disabled_sources: frozenset[str] = frozenset()
    prefetch: tuple[dict[str, Any], ...] = ()


@dataclass(frozen=True)
class TurnBinding:

    llm: BaseChatModel
    llm_with_tools: Any
    tools: tuple[BaseTool, ...]
    tools_info: list[dict[str, str]]
    tool_node: ToolNode
    source_tool_names: frozenset[str]
    ceiling: int
    max_input_tokens: int = 0
    max_calls_per_round: int = 0
    prefetch: tuple[dict[str, Any], ...] = ()
    disabled_sources: frozenset[str] = frozenset()


def _call_name(call: Any) -> str:
    name = call.get("name") if isinstance(call, dict) else getattr(call, "name", None)
    return str(name or "")


def _call_args(call: Any) -> Any:
    return call.get("args") if isinstance(call, dict) else getattr(call, "args", None)


SKILL_READ_SHAPE = "read_skill"


def _call_basenames(message: Any) -> list[str]:
    names: list[str] = []
    for call in getattr(message, "tool_calls", None) or []:
        name = call.get("name") if isinstance(call, dict) else getattr(call, "name", None)
        if name:
            names.append(SKILL_READ_SHAPE if is_skill_read(call) else tool_basename(str(name)))
    return names


def _tool_call_shape(messages: Sequence[Any], *, limit: int = 24) -> list[str]:
    shape: list[str] = []
    for message in messages:
        shape.extend(_call_basenames(message))
        if len(shape) >= limit:
            return shape[:limit]
    return shape


def _over_width(running: Sequence[Any], max_calls: int) -> list[Any]:
    if max_calls <= 0 or len(running) <= max_calls:
        return []
    return list(running[max_calls:])


def _withheld_calls(
    calls: Sequence[Any],
    state: ResearchAgentState,
    disabled: frozenset[str],
    max_calls: int = 0,
) -> tuple[list[Any], list[tuple[Any, str]], list[Any]]:
    repeats = repeat_fetches(calls, state.executed_fetches)
    seen = {id(call) for call in repeats}
    refused = [
        (call, sentence)
        for call in calls
        if id(call) not in seen
        and (sentence := disabled_source_notice(_call_name(call), disabled, _call_args(call))) is not None
    ]
    seen |= {id(call) for call, _ in refused}
    over_width = _over_width([call for call in calls if id(call) not in seen], max_calls)
    return repeats, refused, over_width


def _drop_withheld(
    calls: list[Any],
    state: ResearchAgentState,
    disabled: frozenset[str],
    max_calls: int = 0,
) -> list[Any]:
    repeats, refused, over_width = _withheld_calls(calls, state, disabled, max_calls)
    if repeats:
        emit_repeat_fetch(round_index=state.retrieval_round, withheld=len(repeats))
        logger.info(
            "Duplicate fetch withheld: %d call(s) answered with the earlier result, %d asked for (round=%d)",
            len(repeats),
            len(calls),
            state.retrieval_round,
        )
    if refused:
        emit_refused_source(round_index=state.retrieval_round, withheld=len(refused))
        logger.info(
            "Disabled source: %d call(s) answered with the refusal notice (round=%d)",
            len(refused),
            state.retrieval_round,
        )
    if over_width:
        emit_width_cap(
            round_index=state.retrieval_round,
            kept=max_calls,
            withheld=len(over_width),
        )
        logger.warning(
            "Round width cap: %d of %d call(s) run, %d deferred to the next round (cap=%d, round=%d)",
            max_calls,
            len(calls),
            len(over_width),
            max_calls,
            state.retrieval_round,
        )
    withheld = {id(call) for call in (*repeats, *(call for call, _ in refused), *over_width)}
    if not withheld:
        return calls
    return [call for call in calls if id(call) not in withheld]


def _starts_synthesis(response: Any, state: ResearchAgentState) -> bool:
    calls = getattr(response, "tool_calls", None) or []
    if calls:
        return False
    text = " ".join(content_to_text(getattr(response, "content", "") or "").split())
    if not text:
        return False
    return state.tool_iterations > 0


def _charge_empty_round(state: ResearchAgentState, ceiling: int) -> tuple[int, int, dict[str, Any] | None]:
    rounds = state.tool_iterations + 1
    logger.info(
        "Round withheld in full (repeat or switched-off source); charged 1 round. Rounds spent: %d/%d",
        rounds,
        ceiling,
    )
    return rounds, state.retrieval_round, None


def _charge_tool_calls(
    response: Any,
    state: ResearchAgentState,
    ceiling: int,
    disabled: frozenset[str] = frozenset(),
    max_calls: int = 0,
) -> tuple[int, int, dict[str, Any] | None]:
    calls = getattr(response, "tool_calls", None) or []
    if not calls:
        return state.tool_iterations, state.retrieval_round, None
    calls = _drop_withheld(calls, state, disabled, max_calls)
    if not calls:
        return _charge_empty_round(state, ceiling)
    rounds = state.tool_iterations + 1
    logger.info(
        "Round of %d tool call(s). Rounds spent: %d/%d",
        len(calls),
        rounds,
        ceiling,
    )
    conclusion = assistant_checkpoint(response)
    searched = emit_retrieval(
        calls,
        round_index=state.retrieval_round,
        conclusion=conclusion,
    )
    retrieval_round = state.retrieval_round + (1 if searched else 0)
    record = record_round_announcement(
        round_index=state.retrieval_round,
        calls=calls,
        conclusion=conclusion,
    )
    return rounds, retrieval_round, record


def _executing_retrieval_round(state: ResearchAgentState, ran: Sequence[Any]) -> int | None:
    calls = [call for call in ran if isinstance(call, dict)]
    if not is_retrieval_round(calls):
        return None
    return max(state.retrieval_round - 1, 0)


def _opened_documents(sources: Iterable[Any]) -> set[str]:
    names: set[str] = set()
    for source in sources or ():
        key = str(getattr(source, "citation_key", "") or "")
        name = key.split(",", 1)[0].strip()
        if "(" in name:
            name = name.split("(", 1)[0].strip()
        if name:
            names.add(name)
    return names


def _report_family_coverage(turn_sources: Sequence[Any]) -> None:
    try:
        from agent.common.norm_registry import oib_family_member
        from agent.knowledge.inventory import get_norm_families

        families = get_norm_families()
        if not families:
            return
        opened = {member for name in _opened_documents(turn_sources) if (member := oib_family_member(name))}
        for family in families:
            hit = [member for member in family.members if member in opened]
            if hit:
                emit_family_coverage(family=family.key, listed=len(family.members), opened=len(hit))
    except Exception:  # noqa: BLE001 — a coverage count must never take a turn down
        logger.debug("Family-coverage record not emitted", exc_info=True)


def _last_tool_calls(state: ResearchAgentState) -> list[dict[str, Any]]:
    last = state.messages[-1] if state.messages else None
    return [call for call in (getattr(last, "tool_calls", None) or []) if isinstance(call, dict)]


def _without_dropped_calls(state: ResearchAgentState, dropped: Sequence[Any]) -> ResearchAgentState:
    withheld = {id(call) for call in dropped}
    last = state.messages[-1]
    kept = [call for call in (getattr(last, "tool_calls", None) or []) if id(call) not in withheld]
    trimmed = last.model_copy(update={"tool_calls": kept})
    return state.model_copy(update={"messages": [*state.messages[:-1], trimmed]})


def _without_trace_lanes(message: Any) -> Any:
    if not isinstance(message, ToolMessage) or not isinstance(message.content, str):
        return message
    stripped = strip_trace_lanes(message.content)
    if stripped == message.content:
        return message
    return message.model_copy(update={"content": stripped})


def _notice(call: Any, content: str) -> ToolMessage:
    return ToolMessage(
        content=content,
        name=_call_name(call),
        tool_call_id=str(call.get("id") or ""),
    )


def _repeat_answer(call: Any, results: Mapping[str, str], attempted: frozenset[str] = frozenset()) -> str:
    signature = fetch_signature(call)
    cached = results.get(signature) if signature is not None else None
    if cached:
        return f"{_REPEAT_FETCH_PREFIX}\n\n{cached}"
    if signature is not None and signature in attempted:
        return _FAILED_FETCH_REPEAT_MESSAGE
    return _REPEAT_FETCH_MESSAGE


@dataclass(frozen=True)
class _RoundSplit:

    ran: list[Any]
    repeats: list[Any]
    refused: list[tuple[Any, str]]
    over_width: list[Any]
    steered: list[Any] = field(default_factory=list)

    @property
    def withheld(self) -> list[Any]:
        return [*self.repeats, *(call for call, _ in self.refused), *self.over_width, *self.steered]

    def held_for_steer(self) -> _RoundSplit:
        steered = [call for call in self.ran if is_write_call(call)]
        if not steered:
            return self
        held = {id(call) for call in steered}
        return replace(self, ran=[call for call in self.ran if id(call) not in held], steered=steered)

    @property
    def attempted(self) -> frozenset[str]:
        return signatures_of(self.ran)

    def notices(self, results: Mapping[str, str]) -> list[ToolMessage]:
        attempted = self.attempted
        return [
            *(_notice(call, _repeat_answer(call, results, attempted)) for call in self.repeats),
            *(_notice(call, sentence) for call, sentence in self.refused),
            *(_notice(call, _WIDTH_CAP_MESSAGE) for call in self.over_width),
            *(_notice(call, HELD_FOR_STEER) for call in self.steered),
        ]


def _split_round(state: ResearchAgentState, disabled: frozenset[str], max_calls: int = 0) -> _RoundSplit:
    calls = _last_tool_calls(state)
    repeats, refused, over_width = _withheld_calls(calls, state, disabled, max_calls)
    withheld = {id(call) for call in (*repeats, *(call for call, _ in refused), *over_width)}
    return _RoundSplit(
        ran=[call for call in calls if id(call) not in withheld],
        repeats=repeats,
        refused=refused,
        over_width=over_width,
    )


def _steer_round(state: ResearchAgentState) -> int:
    return state.tool_iterations + 1


def _announce_steer(note: SteerNote, applied: AppliedSteer, inbox: SteerInbox) -> None:
    emit(SteerAppliedBody(value=SteerAppliedValue(steer_id=note.steer_id, round=applied.round)))
    waited_ms = max(0, int((time.monotonic() - note.received_at) * 1000))
    emit_step_span(
        "turn.steer",
        {
            "round": applied.round,
            "chars": len(note.text),
            "waited_ms": waited_ms,
            "region": note.focus_region is not None,
        },
        {"applied": True, "at": applied.at},
    )
    add_trace_tag(STEERED_TAG)
    record_turn_facts(steer_count=len(inbox.applied))


def _take_steering(state: ResearchAgentState) -> list[AppliedSteer] | None:
    inbox = current_steer_inbox()
    if inbox is None or not inbox.has_pending():
        return None
    round_index = _steer_round(state)
    at = len(state.messages)
    taken = inbox.take()
    new = [
        AppliedSteer(steer_id=note.steer_id, content=render_note(note, round_index), at=at, round=round_index)
        for note in taken
    ]
    for note, applied in zip(taken, new, strict=True):
        _announce_steer(note, applied, inbox)
    logger.info("Steering: %d note(s) read before round %d", len(new), round_index)
    return [*state.steering, *new]


def _hold_writes_for_steer(state: ResearchAgentState, split: _RoundSplit) -> _RoundSplit:
    inbox = current_steer_inbox()
    if inbox is None or not inbox.has_pending():
        return split
    held = split.held_for_steer()
    if held.steered:
        emit_steered_writes(round_index=state.retrieval_round, withheld=len(held.steered))
        logger.info("Steering: %d write call(s) held back for a note that arrived after them", len(held.steered))
    return held


def _turn_index(state: ResearchAgentState) -> int:
    try:
        return max(1, sum(1 for message in state.messages if isinstance(message, HumanMessage)))
    except Exception:  # noqa: BLE001 — a turn number must never take a turn down
        return 1


def _recursion_limit(ceiling: int) -> int:
    return (ceiling * 2) + 10


def _turn_input_tokens() -> int:
    tracker = cost_tracker_var.get()
    if tracker is None:
        return 0
    return tracker.prompt_tokens


def _live_answer(state: ResearchAgentState) -> LiveAnswer | None:
    registry = get_session_registry()
    if registry is None:
        return None
    return LiveAnswer(
        registry,
        handed=handed_this_turn(state.messages),
    )


def _turn_cutoff(state: ResearchAgentState, binding: TurnBinding) -> str | None:
    if state.tool_iterations >= binding.ceiling:
        return CUTOFF_ROUNDS
    if binding.max_input_tokens > 0 and _turn_input_tokens() >= binding.max_input_tokens:
        return CUTOFF_INPUT_TOKENS
    return None


def _fetch_results(
    ran: Sequence[Any],
    messages: Sequence[Any],
    failed_ids: set[str],
) -> dict[str, str]:
    by_id = {
        str(getattr(message, "tool_call_id", "") or ""): str(message.content or "")
        for message in messages
        if isinstance(message, ToolMessage)
    }
    results: dict[str, str] = {}
    for call in ran:
        call_id = str(call.get("id") or "")
        signature = fetch_signature(call)
        content = by_id.get(call_id)
        if call_id in failed_ids or signature is None or not content:
            continue
        results[signature] = content
    return results


def _capture_sources(
    tool_name: str,
    content: str,
    source_tool_names: frozenset[str],
    registry: SourceRegistry,
    artifact: Any = None,
) -> None:
    if tool_name not in source_tool_names:
        return
    source_id = source_id_for_call(tool_name)
    if source_id is None and not is_look_tool(tool_name):
        logger.debug("[CitationRegistry] Skipping non-data-source tool result from %s", tool_name)
        return
    sources = extract_sources_from_tool_result(tool_name, content, source_id=source_id, artifact=artifact)
    for source in sources:
        registry.add(source)
    record_turn_capture([source for source in sources if not is_look_place(source)])
    if sources:
        logger.info(
            "[CitationRegistry] Captured %d source(s) from %s: %s",
            len(sources),
            tool_name,
            [s.url or s.citation_key for s in sources],
        )


def _bind_registry() -> tuple[SourceRegistry, Any]:
    registry = get_session_registry()
    if registry is not None:
        return registry.for_turn(), None
    registry = SourceRegistry()
    return registry, set_session_registry(registry)


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
