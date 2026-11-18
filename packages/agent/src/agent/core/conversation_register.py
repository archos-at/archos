import asyncio
import contextlib
import logging
from collections.abc import AsyncGenerator
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Annotated
from typing import Any

from langchain_core.messages import HumanMessage
from pydantic import Field

from agent.auth.request_identity import skip_clarifier_requested
from agent.citations.office_lines import set_turn_office_labels
from agent.common import AgentGroup
from agent.common import filter_tools_by_sources
from agent.common import format_tool_unavailability_error
from agent.common import get_all_tool_refs
from agent.common import get_checkpointer
from agent.common import get_langchain_llm
from agent.common import validate_tool_availability
from agent.common.agent_tools import load_agent_tools
from agent.common.fenced_checkpointer import FencedCheckpointer
from agent.common.knowledge_context import set_turn_knowledge_context
from agent.common.knowledge_context import trace_metadata as knowledge_trace_metadata
from agent.common.knowledge_context import turn_knowledge_context
from agent.common.profiler import flush_after_answer
from agent.common.profiler import track_agent_profile
from agent.common.retrieval_status import documents_loading_step
from agent.common.wire_v2 import EventBody
from agent.common.wire_v2 import RunFinishedBody
from agent.common.wire_v2 import StatusStep
from agent.common.wire_v2 import StepFinishedBody
from agent.conversation_context import register_context_appender
from agent.core.clarify import ClarifierSettings
from agent.core.clarify import build_clarifier
from agent.core.conversation import ConversationGraph
from agent.core.history import warm_token_encoder
from agent.core.models import ConversationState
from agent.core.turn_tools import set_project_models
from agent.knowledge.inventory import get_turn_documents
from agent.knowledge.inventory import set_inventory_drops
from agent.knowledge.inventory import set_norm_families
from agent.knowledge.inventory import set_turn_documents
from agent.knowledge.restricted_use import CrossProjectTurn
from agent.knowledge.restricted_use import begin_restricted_use
from agent.knowledge.restricted_use import bind_cross_project_turn
from agent.knowledge.restricted_use import bind_restricted_use
from agent.knowledge.restricted_use import without_restricted
from agent.knowledge.scoping import get_scoped_collections_from_context
from agent.memory.shown_notes import ShownNotes
from agent.observability.langfuse_trace_attributes import record_trace_metadata
from agent.observability.turn_outcome import record_turn_facts
from agent.project_context import RequestContext
from agent.stages import schedule_post_answer_stages
from agent.tools.canvas.policy import withhold_restricted_for_thread
from agent.tools.canvas.presence import begin_canvas_presence
from agent.tools.canvas.presence import leave_canvas
from agent.turn.admission import PROFILE_AGENT_NAME
from agent.turn.admission import TurnLedgers
from agent.turn.admission import TurnOutcome
from agent.turn.admission import answer_turn
from agent.turn.admission import refused
from agent.turn.admission import spanned
from agent.turn.answer_stream import answer_streaming_enabled
from agent.turn.answer_stream import bound_live_prose
from agent.turn.context import TurnContext
from agent.turn.context import load_turn_context
from agent.turn.context import settle_restriction
from agent.turn.context import thread_id_for_turn
from agent.turn.context import turn_identity
from agent.turn.context import user_info_for
from agent.turn.dispatch import build_run_commissioner
from agent.turn.inventory import Inventory
from agent.turn.inventory import load_inventory
from agent.turn.inventory import pending_uploads
from agent.turn.inventory import resolve_scope
from agent.turn.inventory import shelves_in_scope
from agent.turn.inventory import wait_for_uploads
from agent.turn.payload import TurnInputs
from agent.turn.payload import extract_turn_inputs
from agent.turn.registries import TurnRegistries
from agent.turn.registries import load_session_registry
from agent.turn.registries import load_turn_shown_notes
from agent.turn.registries import turn_registries
from agent.turn.response import answer_message_id
from agent.turn.response import build_result
from agent.turn.response import finished
from agent.turn.response import post_answer_turn_facts
from agent.turn.response import turn_answer_message_id
from agent.turn.streaming import TurnTextFold
from agent.turn.streaming import fold_turn
from agent.turn.streaming import note_settled_replaced
from agent.turn.subject_document import load_subject_document
from nat.data_models.streaming import Streaming
from nat.plugin_api import Builder
from nat.plugin_api import Context
from nat.plugin_api import FunctionBaseConfig
from nat.plugin_api import FunctionInfo
from nat.plugin_api import LLMFrameworkEnum
from nat.plugin_api import LLMRef
from nat.plugin_api import register_function

logger = logging.getLogger(__name__)


class ChatDeepResearcherConfig(FunctionBaseConfig, name="chat_deepresearcher_agent"):
    max_history_tokens: int = Field(
        default=40000,
        description=(
            "Tokens of chat history kept before the agent runs (`history.trim_message_history`). "
            "The CONVERSATION is the one thing in the context nobody else can reconstruct: the "
            "system prompt is rendered from the template, the tool schemas come from the binding, "
            "the retrieved passages are in the index (the PREVIOUS turn's ride along in full, so a "
            'follow-up needs no fetch; older turns keep what was said) and the „Bereits gelesen" '
            "digest carries what was READ — but not what was SAID, and not the correction the reader "
            "made two turns ago. The old 8 000 predates the context sizes this surface runs on: one call here "
            "carries 37-84k input tokens with ~14k of static prompt in it, so the window that got "
            "cut was the only irreplaceable one, and `<project_brief>` and PROJECT_MEMORY exist "
            "partly to carry facts across the gap it created. 40 000 is a floor chosen against "
            "those measurements. The RIGHT budget is the residual — model context minus prompt "
            "minus tool schemas minus this turn's observations minus a synthesis reserve — which "
            "is the only one that means anything and is not computed anywhere yet (follow-up)."
        ),
    )
    verbose: bool = Field(default=False, description="Enable verbose logging")
    enable_clarifier: bool = Field(default=False, description="Enable clarification of research queries")
    clarifier: ClarifierSettings | None = Field(
        default=None,
        description=(
            "Models, tools and limits for the clarification step that confirms a research plan "
            "before deep research runs. Required when `enable_clarifier` is true. It is a nested "
            "block rather than its own function because the step has exactly one caller; the "
            "`clarifier` agent group it runs under is unchanged, so per-org model overrides still "
            "address it."
        ),
    )
    use_async_deep_research: bool = Field(
        default=False,
        description="Submit deep research as an async job instead of running inline",
    )
    checkpoint_db: str = Field(
        default="./checkpoints.db",
        description="SQLite database path or Postgres DSN for persistent checkpoints.",
    )
    memory_reflection_llm: LLMRef | None = Field(
        default=None,
        description=(
            "Optional LLM for the async post-answer memory-reflection stage. When set, after each "
            "answer is returned a background task reviews the turn against the project's existing "
            "memory and records any durable finding the in-turn `remember` tool missed. Unset "
            "disables reflection entirely (no extra LLM call)."
        ),
    )
    follow_ups_llm: LLMRef | None = Field(
        default=None,
        description=(
            "Optional LLM for the async post-answer follow-up-questions stage. When set, after a "
            "substantive answer is returned a background task reads the finished answer and names "
            "the two to four questions it made askable. Unset disables the stage entirely (no "
            "extra LLM call) — the capability bit of `flag AND capability`."
        ),
    )


async def _deep_research_tools(builder: Builder) -> list:
    deep_config = builder.get_function_config("deep_research_agent")
    tool_refs = deep_config.tools or get_all_tool_refs()
    return await load_agent_tools(builder, tool_refs, deep_config.exclude_tools)


def _tool_validator(deep_research_tools: list):
    def validate_deep_research_tools(data_sources: list[str] | None) -> tuple[bool, str]:
        selected = filter_tools_by_sources(deep_research_tools, data_sources)
        is_valid, _, unavailable = validate_tool_availability(
            selected, research_type="deep research", enable_logging=False
        )
        if not is_valid:
            return False, format_tool_unavailability_error("deep research", unavailable)
        return True, ""

    return validate_deep_research_tools


async def _stage_llm(builder: Builder, ref: LLMRef | None, stage: str):
    if ref is None:
        return None
    try:
        return await get_langchain_llm(builder, ref)
    except Exception:  # noqa: BLE001 - a stage model is optional; the answer is not
        logger.warning("Could not build %s; that stage is disabled", stage, exc_info=True)
        return None


async def _build_clarifier(config: ChatDeepResearcherConfig, builder: Builder):
    if not config.enable_clarifier:
        return None
    if config.clarifier is None:
        raise ValueError("enable_clarifier is true but no `clarifier:` block is configured on the workflow")
    return await build_clarifier(config.clarifier, builder)


async def _build_agent(config: ChatDeepResearcherConfig, builder: Builder) -> ConversationGraph:
    research_fn_impl = await builder.get_function("shallow_research_agent")
    deep_fn = await builder.get_function("deep_research_agent")
    return ConversationGraph(
        research_fn=research_fn_impl.ainvoke,
        deep_research_fn=deep_fn.ainvoke,
        clarifier_fn=await _build_clarifier(config, builder),
        max_history_tokens=config.max_history_tokens,
        commission_run_fn=build_run_commissioner(config),
        checkpointer=FencedCheckpointer(await get_checkpointer(config.checkpoint_db)),
        validate_deep_research_tools_fn=_tool_validator(await _deep_research_tools(builder)),
    )


def _turn_state(
    inputs: TurnInputs,
    context: TurnContext,
    inventory: Inventory,
    header_scope,
    *,
    request: RequestContext,
    skip_clarifier: bool,
) -> ConversationState:
    return ConversationState(
        messages=[HumanMessage(content=inputs.query_text)],
        user_info=user_info_for(request),
        data_sources=inputs.data_sources,
        available_documents=inventory.available_documents,
        in_flight_documents=inventory.in_flight_documents,
        collection_scope=[entry.collection for entry in header_scope] if header_scope else None,
        focus_file_name=inputs.focus_file_name,
        focus_shelf=inputs.focus_shelf,
        focus_region=inputs.focus_region,
        reply_in_thread=inputs.reply_in_thread,
        trigger=inputs.trigger,
        answer_excerpt=inputs.answer_excerpt,
        skip_clarifier=skip_clarifier,
        project_context=context.project_context,
        platform_lessons=context.platform_lessons,
        org_instructions=context.org_instructions,
        reference_projects=context.reference_projects,
        workspace_block=context.workspace,
        deep_research_allowed=context.deep_research_allowed,
        tasks_allowed=context.tasks_allowed,
        licensed_text_allowed=context.licensed_text_allowed,
        confined=context.confined,
    )


def _finished(
    outcome: TurnOutcome[ConversationState],
    registries: TurnRegistries,
    context: TurnContext,
    inputs: TurnInputs,
    *,
    message_id: str,
    stage_llms: dict,
) -> RunFinishedBody:
    if inputs.focus_region is not None:
        record_turn_facts(focus_region_viewed=registries.regions_viewed > 0)
    if inputs.answer_excerpt:
        record_turn_facts(answer_excerpt_chars=len(inputs.answer_excerpt))
    if outcome.refusal is not None:
        return refused(outcome.refusal, message_id=message_id)
    assert outcome.state is not None
    cards = registries.cards.snapshot()
    facts = post_answer_turn_facts(
        context.stage_facts,
        state=outcome.state,
        query_text=inputs.query_text,
        cards=cards,
        remembered_this_turn=registries.memory_writes,
        noted_this_turn=registries.memory_notes,
        registry_collections=registries.source_collections,
        restricted_memory_writes=registries.restricted_memory_writes,
        earlier_restricted_notes=registries.shown_notes,
        listed_documents=get_turn_documents(),
    )
    schedule_post_answer_stages(facts, llms=stage_llms)
    return finished(build_result(outcome.state, cards, message_id))


async def _load_setup(
    request: RequestContext,
    inputs: TurnInputs,
    scope: list,
    *,
    conversation_id: str | None,
    thread_id: str,
    resolve_stages: bool,
) -> tuple[TurnContext, Inventory, Any, StatusStep | None, ShownNotes]:
    context, inventory, session_registry, subject_step, shown_notes = await asyncio.gather(
        spanned(
            "setup.project_context",
            load_turn_context(
                request, conversation_id=thread_id, query_text=inputs.query_text, resolve_stages=resolve_stages
            ),
        ),
        load_inventory(without_restricted(scope)),
        spanned("setup.session_registry", load_session_registry(thread_id)),
        spanned(
            "setup.subject_document",
            load_subject_document(
                inputs.subject,
                conversation_id=conversation_id,
                organization_id=request.organization_id,
                user_id=request.user_id,
            ),
        ),
        spanned("setup.shown_restricted_notes", load_turn_shown_notes(thread_id)),
    )
    return context, inventory, session_registry, subject_step, shown_notes


@dataclass(frozen=True)
class _TurnRuntime:
    thread_id: str
    identity: dict[str, str | None]
    metadata: dict[str, Any]
    ledgers: TurnLedgers
    stage_llms: dict


@dataclass(frozen=True)
class _Turn:
    agent: ConversationGraph
    state: ConversationState
    session_registry: Any
    context: TurnContext
    inputs: TurnInputs
    request: RequestContext
    runtime: _TurnRuntime
    shown_notes: ShownNotes = ShownNotes()


async def _prepare_turn(
    agent: ConversationGraph,
    request: RequestContext,
    inputs: TurnInputs,
    header_scope,
    *,
    conversation_id: str | None,
    enable_clarifier: bool,
    resolve_stages: bool,
    runtime: _TurnRuntime,
) -> AsyncIterator[StepFinishedBody | _Turn]:
    scope = resolve_scope(header_scope, conversation_id)
    context, inventory, session_registry, subject_step, shown_notes = await _load_setup(
        request,
        inputs,
        scope,
        conversation_id=conversation_id,
        thread_id=runtime.thread_id,
        resolve_stages=resolve_stages,
    )
    context = settle_restriction(context, request)
    if subject_step is not None:
        yield StepFinishedBody(step=subject_step)
    if (waiting := pending_uploads(inventory)) is not None:
        yield StepFinishedBody(step=waiting)
        inventory = await wait_for_uploads(without_restricted(scope), inventory)
    skip_clarifier = not enable_clarifier or skip_clarifier_requested()
    set_turn_documents(inventory.all_documents or inventory.available_documents)
    set_norm_families(inventory.norm_families)
    set_inventory_drops(inventory.inventory_drops)
    set_project_models(context.project_models)  # which model files the project holds, for the tools bound
    set_turn_knowledge_context(context.knowledge_context)
    set_turn_office_labels(context.base_knowledge_labels)
    record_trace_metadata(**knowledge_trace_metadata(turn_knowledge_context()))
    state = _turn_state(inputs, context, inventory, header_scope, request=request, skip_clarifier=skip_clarifier)
    yield _Turn(agent, state, session_registry, context, inputs, request, runtime, shown_notes)


async def _answer(turn: _Turn, *, message_id: str, stream: bool) -> AsyncIterator[EventBody]:
    runtime = turn.runtime
    outcome: TurnOutcome[ConversationState] | None = None
    async with turn_registries(
        runtime.thread_id,
        turn.session_registry,
        memory_digest=turn.context.stage_facts.memory_digest,
        shown_notes=turn.shown_notes,
        restricted_scope=turn.context.restricted_scope,
        temporary=turn.context.temporary,
        personal_memory=turn.context.personal_memory,
        answer_message_id=message_id if turn.context.stage_facts.ws_parent_id else None,
    ) as registries:
        answering = answer_turn(
            turn.agent,
            turn.state,
            thread_id=runtime.thread_id,
            organization_id=turn.request.organization_id,
            identity={**runtime.identity, "message_id": message_id} if runtime.identity is not None else None,
            metadata=runtime.metadata,
            ledgers=runtime.ledgers,
        )
        live = bound_live_prose(message_id) if stream else contextlib.nullcontext()
        with live:
            async with contextlib.aclosing(answering) as items:
                async for item in items:
                    if isinstance(item, TurnOutcome):
                        outcome = item
                    else:
                        yield item
    assert outcome is not None
    yield _finished(
        outcome, registries, turn.context, turn.inputs, message_id=message_id, stage_llms=runtime.stage_llms
    )


def _turn_runner(agent: ConversationGraph, config: ChatDeepResearcherConfig, stage_llms: dict):
    any_stage_llm = any(llm is not None for llm in stage_llms.values())

    async def _run(query: object) -> Annotated[AsyncGenerator[EventBody], Streaming(convert=fold_turn)]:
        conversation_id = Context.get().conversation_id
        thread_id = thread_id_for_turn(conversation_id)
        request = RequestContext.from_context()
        inputs = extract_turn_inputs(query)
        logger.info("ChatDeepResearcherAgent: %s (data sources: %s)", inputs.query_text, inputs.data_sources)
        bind_restricted_use(
            await spanned(
                "setup.restricted_use",
                begin_restricted_use(
                    request, conversation_id, answer_message_id=turn_answer_message_id(conversation_id)
                ),
            )
        )
        if inputs.reply_in_thread:
            withhold_restricted_for_thread()
        bind_cross_project_turn(CrossProjectTurn())
        header_scope = get_scoped_collections_from_context()
        if (loading := documents_loading_step(shelves_in_scope(header_scope or ()))) is not None:
            yield StepFinishedBody(step=loading)
        turn_metadata: dict[str, Any] = {}
        identity = turn_identity(request, conversation_id)
        profiler = None
        ledgers = TurnLedgers()
        fold = TurnTextFold()
        terminal: RunFinishedBody | None = None
        presence = begin_canvas_presence()
        try:
            with track_agent_profile(
                agent_name=PROFILE_AGENT_NAME, identity=identity, metadata=turn_metadata, inline_flush=False
            ) as profiler:
                setup = _prepare_turn(
                    agent,
                    request,
                    inputs,
                    header_scope,
                    conversation_id=conversation_id,
                    enable_clarifier=config.enable_clarifier,
                    resolve_stages=any_stage_llm,
                    runtime=_TurnRuntime(thread_id, identity, turn_metadata, ledgers, stage_llms),
                )
                async with contextlib.aclosing(setup) as items:
                    async for item in items:
                        if isinstance(item, _Turn):
                            turn = item
                        else:
                            yield item
                message_id = answer_message_id(conversation_id, turn.context.stage_facts.ws_parent_id)
                stream = await spanned("setup.answer_streaming", asyncio.to_thread(answer_streaming_enabled))
                async with contextlib.aclosing(_answer(turn, message_id=message_id, stream=stream)) as bodies:
                    async for body in bodies:
                        if isinstance(body, RunFinishedBody):
                            terminal = body
                            continue
                        fold.add(body)
                        yield body
            assert terminal is not None
            note_settled_replaced(fold.settled, terminal.result.text)
            yield terminal
        finally:
            await flush_after_answer(profiler, ledgers.cost_tracker)
            await leave_canvas(presence)

    return _run


@register_function(config_type=ChatDeepResearcherConfig, framework_wrappers=[LLMFrameworkEnum.LANGCHAIN])
async def chat_deepresearcher_agent(config: ChatDeepResearcherConfig, builder: Builder):
    stage_llms = {
        AgentGroup.MEMORY_REFLECTION: await _stage_llm(builder, config.memory_reflection_llm, "memory_reflection_llm"),
        AgentGroup.FOLLOW_UPS: await _stage_llm(builder, config.follow_ups_llm, "follow_ups_llm"),
    }
    agent = await _build_agent(config, builder)
    await asyncio.to_thread(warm_token_encoder)
    register_context_appender(agent.append_context_message)
    run = _turn_runner(agent, config, stage_llms)
    yield FunctionInfo.from_fn(run, description="Piloti: one answering agent, escalation to deep research.")
