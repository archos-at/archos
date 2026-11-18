import asyncio
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
from typing import Any

from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage
from pydantic import Field
from pydantic import field_validator

from agent.citations.entries import EmptySourceRegistryError
from agent.common import AgentGroup
from agent.common import LLMProvider
from agent.common import LLMRole
from agent.common import VerboseTraceCallback
from agent.common import format_user_facing_tool_error
from agent.common import get_all_tool_refs
from agent.common import get_langchain_llm
from agent.common import is_verbose
from agent.common import unavailable_source_ids
from agent.common import validate_tool_availability
from agent.common.agent_tools import load_agent_tools
from agent.common.data_source_registry import get_all_sources
from agent.common.decisions import SKIPPED_TOO_SHORT
from agent.common.decisions import record_skipped
from agent.common.knowledge_context import corpus_country_allowed
from agent.common.law_gate import law_sources_withheld
from agent.common.openrouter import PLATFORM_FIXED
from agent.common.openrouter import pin_chat_model
from agent.common.reasoning_settings import effort_of
from agent.common.request_llm_context import read_request_llm_context
from agent.common.tool_validation import format_no_sources_message
from agent.knowledge.restricted_use import current_cross_project_turn
from agent.observability.langfuse_trace_attributes import add_trace_tag
from agent.observability.langfuse_trace_attributes import record_trace_metadata
from agent.observability.turn_phases import observed_phase
from agent.project_context import get_organization_id_from_context
from agent.skills import SkillResolver
from agent.skills import SkillRuntime
from agent.skills.events import emit_skills_offered
from agent.tools.documents.tools import filesystem_tools_for_turn
from agent.turn.admission import spanned
from nat.plugin_api import Builder
from nat.plugin_api import FunctionBaseConfig
from nat.plugin_api import FunctionGroupRef
from nat.plugin_api import FunctionInfo
from nat.plugin_api import FunctionRef
from nat.plugin_api import LLMFrameworkEnum
from nat.plugin_api import LLMRef
from nat.plugin_api import register_function

from . import ask_user as _ask_user  # noqa: F401
from .agent import ChatAgent
from .agent import TurnConfig
from .decisions import PROJECT_LOOKUP
from .decisions import SLOT as DECISION_SLOT
from .decisions import TurnDecisions
from .decisions import TurnFacts
from .decisions import attached_card_types
from .decisions import decide_turn
from .decisions import prefetch_calls
from .decisions import prefetch_query
from .models import ResearchAgentState
from .reference_fit import FIT_THRESHOLD
from .reference_fit import MIN_LINES as MIN_FIT_LINES
from .reference_fit import ReferenceFit
from .reference_fit import fit_references
from .turn_tools import tools_in_scope

logger = logging.getLogger(__name__)

_RESEARCH_TYPE = "research"

_MAX_MEMOISED_SELECTIONS = 64


class ResearchAgentConfig(FunctionBaseConfig, name="research_agent"):
    llm: LLMRef = Field(..., description="LLM to use")
    tools: list[FunctionRef | FunctionGroupRef] = Field(
        default_factory=list,
        description="Explicit tool list. Empty = inherit all from data_source_registry.",
    )
    exclude_tools: list[str] = Field(
        default_factory=list,
        description="Tool names to exclude when inheriting from registry.",
    )
    max_tool_iterations: int = Field(
        default=5,
        description=(
            "The research budget in tool-calling ROUNDS — LLM decisions that emitted tool calls — "
            "before synthesis is forced. A round costs one whatever it asked for, so a batch of five "
            "parallel passage opens is one and so is a single skill read. The graph's recursion "
            "guard is derived from it; nothing else bounds the loop."
        ),
    )
    max_input_tokens_per_turn: int = Field(
        default=600_000,
        description=(
            "Cumulative INPUT tokens one turn may spend before synthesis is forced, read off the "
            "cost tracker that already meters every call. The bound that protects the person paying, "
            "since rounds no longer do: a round is one decision however many calls it fans out into. "
            "Sized well above the worst turn measured (~289k prompt tokens over eight calls), because "
            "a bound that fires on a hard question is a hobble — this one is here to stop a runaway. "
            "0 disables it."
        ),
    )
    max_calls_per_round: int = Field(
        default=12,
        description=(
            "How many tool calls of ONE round are run: a runaway guard far above any batch the prompt "
            "asks for, bounding a round of sixty parallel calls `max_input_tokens_per_turn` only sees at "
            "the next round. The calls past it are told to ask again next round, never removed. 0 disables it."
        ),
    )
    repair_pass: bool = Field(
        default=True,
        description=(
            "Correct a quotation no retrieved passage holds verbatim, when one passage comes close: "
            "the small `card_repair_llm` returns that passage's own wording and only the text "
            "between the quotation marks is replaced, then re-verified (ADR-0067). Off, or without "
            "`card_repair_llm`, ships the marker."
        ),
    )
    card_repair_llm: LLMRef | None = Field(
        default=None,
        description=(
            "The small model that fixes ONE envelope card the validator refused (`cards/repair.py`) in a "
            "few thousand tokens. Unset drops such a card, and records it, and turns off `repair_pass`."
        ),
    )
    claim_judge_llm: LLMRef | None = Field(
        default=None,
        description="Grades each answer on its turn's evidence, per turn on the follow-ups group (ADR-0139).",
    )
    verbose: bool = Field(default=False, description="Whether to enable verbose logging")
    skills_enabled: bool = Field(
        default=True,
        description=(
            "Whether agent skills are offered: the SkillsMiddleware catalog in the turn context and "
            "their SKILL.md behind `read_file` (ADR-0135). False offers no catalog and no skill read."
        ),
    )
    skill_allowlist: list[str] = Field(
        default_factory=list,
        description="Optional skill-name allowlist; empty = every resolved skill is offered.",
    )
    turn_decisions: bool = Field(
        default=True,
        description=(
            "Ask the decision model (Jev, ADR-0064) at turn start whether the message needs evidence, "
            "which corpus and which OIB families it needs, which skill it is the subject of and which "
            "card types it is likely to earn — and act on the answers only by ADDING: the named fetches "
            "run as round 0 before the first LLM call, the chosen skill's body and card shapes ride this "
            "turn's prompt. Every tool stays bound whatever it says; "
            "a decision that cannot run leaves the turn exactly as before. DECISIONS_ENABLED=false "
            "is the global switch."
        ),
    )
    prefetch: bool = Field(
        default=True,
        description=(
            "EVAL KNOB, not a product setting: false turns round 0's prefetched fetches off, so the "
            "answer suite can measure the navigation tools (`ls`, `glob`, `grep`, `read_file`) "
            "without a ranked search already in the model's first request (`suite.py --set files "
            "--arm grep`, ADR-0127, ADR-0133). Production keeps the default."
        ),
    )
    filesystem: FunctionRef | None = Field(
        default=None,
        description=(
            "The `knowledge_retrieval` instance whose scope the filesystem tools read the office's documents "
            "through (ADR-0133): `read_file` over /project/, /office/, /chat/ and /law/oib/ beside the drafts. "
            "Unset: the file verbs reach the conversation's drafts alone, as before."
        ),
    )

    @field_validator("filesystem", mode="before")
    @classmethod
    def _no_filesystem(cls, value: Any) -> Any:
        if isinstance(value, str) and value.strip().lower() in ("", "null", "none"):
            return None
        return value

    envelope_json_mode_with_tools: bool = Field(
        default=False,
        description=(
            "Whether provider JSON mode (`response_format: json_object`) for the answer envelope is "
            "bound on tool-bound research iterations, forced synthesis included, which follows the "
            "rounds (default OFF). Some OpenRouter-routed providers accept the parameter and then stop "
            "emitting tool calls — a silent degradation the per-call fallback cannot see — so turning "
            "this on is a per-deployment decision made against a provider known to honor both."
        ),
    )


@dataclass(frozen=True)
class _Deployment:
    config: ResearchAgentConfig
    agent: ChatAgent
    provider: LLMProvider
    tools: list[Any]
    estate: Any = None
    availability: dict[tuple[str, ...], tuple[bool, list[str]]] = field(default_factory=dict)


async def _load_tools(config: ResearchAgentConfig, builder: Builder) -> list[Any]:
    tool_refs = config.tools or get_all_tool_refs()
    tools = await load_agent_tools(builder, tool_refs, config.exclude_tools)
    is_valid, _, _ = validate_tool_availability(tools, research_type=_RESEARCH_TYPE)
    if not is_valid:
        logger.warning(
            "Startup check: no tools available for research. "
            "All queries will fail until at least one tool is properly configured.",
        )
    return tools


def _tool_availability(deployment: _Deployment, tools: Sequence[Any]) -> tuple[bool, list[str]]:
    key = tuple(getattr(tool, "name", "") for tool in tools)
    known = deployment.availability.get(key)
    if known is not None:
        return known
    is_valid, _, unavailable = validate_tool_availability(list(tools), research_type=_RESEARCH_TYPE)
    if len(deployment.availability) >= _MAX_MEMOISED_SELECTIONS:
        deployment.availability.clear()
    deployment.availability[key] = (is_valid, unavailable)
    return is_valid, unavailable


async def _resolve_skill_runtime(
    config: ResearchAgentConfig,
    state: ResearchAgentState,
) -> SkillRuntime | None:
    if not config.skills_enabled:
        return None
    resolver = SkillResolver(agent="researcher")
    resolved = await asyncio.to_thread(resolver.resolve, get_organization_id_from_context())
    if config.skill_allowlist:
        allow = set(config.skill_allowlist)
        resolved = tuple(skill for skill in resolved if skill.name in allow)
    if not resolved:
        return None
    return SkillRuntime.office(resolved)


async def _active_provider(provider: LLMProvider) -> LLMProvider:
    return (await read_request_llm_context()).apply(provider)


def _turn_facts(state: ResearchAgentState, runtime: SkillRuntime | None) -> TurnFacts:
    from agent.cards.catalog import CHAT_ONLY_CARD_TYPES
    from agent.cards.catalog import card_index_entries
    from agent.cards.envelope import ENVELOPE_SHAPE_TYPES
    from agent.common.project_facts import facts_from_project_context
    from agent.common.source_kinds import Shelf
    from agent.knowledge.inventory import get_norm_families

    humans = [str(m.content) for m in state.messages if isinstance(m, HumanMessage) and isinstance(m.content, str)]
    question = humans[-1] if humans else ""
    previous = humans[-2] if len(humans) > 1 else None
    answers = [
        str(m.content)
        for m in state.messages
        if isinstance(m, AIMessage) and isinstance(m.content, str) and not getattr(m, "tool_calls", None)
    ]
    previous_answer = answers[-1] if answers else None
    documents = state.available_documents or []
    offered = tuple(runtime.skills) if runtime is not None else ()
    return TurnFacts(
        question=question,
        previous_message=previous,
        previous_answer=previous_answer,
        skills=[(skill.name, " ".join(skill.description.split())) for skill in offered],
        focus_file_name=state.focus_file_name,
        project_facts={k: str(v) for k, v in facts_from_project_context(state.project_context or "").items()},
        families=get_norm_families(),
        project_files=sum(1 for doc in documents if getattr(doc, "shelf", None) == Shelf.PROJECT),
        archive_files=sum(1 for doc in documents if getattr(doc, "shelf", None) == Shelf.OFFICE_SHELF),
        card_types=[
            entry for entry in card_index_entries(exclude=CHAT_ONLY_CARD_TYPES) if entry[0] not in ENVELOPE_SHAPE_TYPES
        ],
        reference_projects=reference_project_count(state.reference_projects),
        reference_catalog=state.reference_projects,
    )


def reference_project_count(catalog: str | None) -> int:
    return sum(1 for line in (catalog or "").splitlines() if line.startswith("- ") and " (id " in line)


async def _decide_turn(facts: TurnFacts | None) -> TurnDecisions:
    if facts is None:
        return TurnDecisions.none()
    if facts.previous_message is None and len(facts.question.split()) < 3:
        record_skipped(DECISION_SLOT, SKIPPED_TOO_SHORT)
        return TurnDecisions.none()
    try:
        return await decide_turn(facts, organization_id=get_organization_id_from_context())
    except Exception:  # noqa: BLE001 — a decision is worth less than the turn
        logger.warning("Turn decision failed; running the turn as before", exc_info=True)
        return TurnDecisions.none()


async def _fit_references(facts: TurnFacts | None) -> ReferenceFit | None:
    if facts is None or facts.reference_projects < MIN_FIT_LINES:
        return None
    if facts.previous_message is None and len(facts.question.split()) < 3:
        return None
    try:
        return await fit_references(
            facts.question, facts.reference_catalog, organization_id=get_organization_id_from_context()
        )
    except Exception:  # noqa: BLE001 — a reorder is worth less than the turn
        logger.warning("Reference fit failed; the catalog keeps its order", exc_info=True)
        return None


def _apply_reference_fit(fit: ReferenceFit | None, state: ResearchAgentState) -> None:
    if fit is None:
        return
    state.reference_projects = fit.catalog
    turn = current_cross_project_turn()
    if turn is not None:
        turn.reference_order = fit.order
    scored = [p for _, p in fit.ranked if p is not None]
    record_trace_metadata(
        reference_fit_scored=len(scored),
        reference_fit_top=round(max(scored), 3) if scored else None,
        reference_fit_fitting=sum(1 for p in scored if p >= FIT_THRESHOLD),
    )


_WARMING: set[asyncio.Task[None]] = set()


def _warm_question(facts: TurnFacts | None) -> None:
    if facts is None or facts.previous_message is not None:
        return
    from agent.common.norm_registry import family_query_number

    query = prefetch_query(facts.question)
    if len(query.split()) < 3 and family_query_number(query) is None:
        return
    from agent.knowledge.factory import warm_search_query

    task = asyncio.create_task(warm_search_query(query))
    _WARMING.add(task)
    task.add_done_callback(_WARMING.discard)


def _apply_decisions(decisions: TurnDecisions, state: ResearchAgentState, runtime: SkillRuntime | None) -> None:
    from agent.cards.catalog import CHAT_ONLY_CARD_TYPES
    from agent.cards.envelope import ENVELOPE_SHAPE_TYPES
    from agent.skills.models import preferred_cards

    withheld_shapes = {*ENVELOPE_SHAPE_TYPES, *CHAT_ONLY_CARD_TYPES}

    if runtime is not None and decisions.chosen_skill:
        runtime.pin(decisions.chosen_skill)
    skill_cards = {
        skill.name: [card for card in preferred_cards(skill.metadata) if card not in withheld_shapes]
        for skill in (runtime.skills if runtime is not None else ())
    }
    chosen = attached_card_types(decisions, skill_cards)
    if chosen:
        from agent.cards.catalog import render_card_details

        state.card_shapes_block = render_card_details(chosen) or None


def _report_skills(result: ResearchAgentState, runtime: SkillRuntime) -> None:
    runtime.record_applied(result.skills_applied or ())
    result.skills_activated = list(runtime.activated)
    hidden = list(runtime.hidden_activated)
    if hidden:
        result.skills_hidden = hidden


def _reply(state: ResearchAgentState, text: str) -> ResearchAgentState:
    return ResearchAgentState(messages=state.messages + [AIMessage(content=text)])


def _warn_if_nothing_is_reachable(disabled_sources: frozenset[str]) -> None:
    if not disabled_sources:
        return
    reachable = [meta.id for meta in get_all_sources() if meta.id.lower() not in disabled_sources]
    if not reachable:
        logger.warning("Research turn has every data source switched off; every retrieval call will be refused")


async def _run_turn(deployment: _Deployment, state: ResearchAgentState) -> ResearchAgentState:
    config = deployment.config
    disabled_sources = unavailable_source_ids(state.data_sources) | law_sources_withheld(reads_turn_sources=True)
    _warn_if_nothing_is_reachable(disabled_sources)
    is_valid, unavailable_tools = _tool_availability(deployment, deployment.tools)
    if not is_valid:
        return _reply(state, format_user_facing_tool_error(_RESEARCH_TYPE, unavailable_tools))

    with observed_phase("setup.skills") as skills_phase:
        runtime = await _resolve_skill_runtime(config, state)
        skills_phase["skills"] = len(runtime.skills) if runtime is not None else 0
    facts = _turn_facts(state, runtime) if config.turn_decisions else None
    _warm_question(facts)
    draft_tools, decisions, llm_provider, fit = await asyncio.gather(
        spanned(
            "setup.file_tools",
            filesystem_tools_for_turn(deployment.estate, skills=runtime.backend if runtime is not None else None),
        ),
        _decide_turn(facts),
        spanned("setup.llm_provider", _active_provider(deployment.provider)),
        _fit_references(facts),
    )
    _apply_decisions(decisions, state, runtime)
    _apply_reference_fit(fit, state)
    if runtime is not None:
        emit_skills_offered(runtime)
        record_trace_metadata(skills_offered=len(runtime.skills), skills_pinned=list(runtime.pinned) or None)
    turn_tools = tools_in_scope(list(deployment.tools) + draft_tools)
    turn = TurnConfig(
        llm_provider=llm_provider,
        tools=turn_tools,
        disabled_sources=disabled_sources,
        prefetch=_turn_prefetch(decisions, facts, state, enabled=config.prefetch),
    )
    if runtime is not None:
        state.skills_block = runtime.prompt_block()
    result = await _run_agent(deployment, state, turn)
    if isinstance(result, str):
        return _reply(state, result)
    result.reasoning_effort = effort_of(llm_provider.get(LLMRole.RESEARCHER))
    if runtime is not None:
        _report_skills(result, runtime)
    return result


def _turn_prefetch(
    decisions: TurnDecisions, facts: TurnFacts | None, state: ResearchAgentState, *, enabled: bool = True
) -> tuple:
    if facts is None or not enabled:
        return ()
    calls = tuple(
        prefetch_calls(
            decisions,
            facts.question,
            focus_file_name=state.focus_file_name,
            focus_shelf=state.focus_shelf,
            previous_message=facts.previous_message,
            reference_projects=facts.reference_projects,
            austrian_law=corpus_country_allowed("AT"),
        )
    )
    record_reference_decision(decisions, facts.reference_projects, calls)
    return calls


def record_reference_decision(decisions: TurnDecisions, offered: int, calls: tuple) -> None:
    prefetched = any(call.get("name") == PROJECT_LOOKUP for call in calls)
    record_trace_metadata(
        reference_projects_offered=offered,
        precedent_p=round(decisions.precedent, 3) if decisions.precedent is not None else None,
        reference_prefetch=prefetched,
    )
    if prefetched:
        add_trace_tag("reference-prefetch")


async def _run_agent(deployment: _Deployment, state: ResearchAgentState, turn: TurnConfig) -> ResearchAgentState | str:
    try:
        return await deployment.agent.run(state, turn=turn)
    except EmptySourceRegistryError as exc:
        logger.warning("Research captured no sources; returning an empty-result answer.")
        scoped = bool(state.focus_file_name or state.focus_shelf)
        return format_no_sources_message(_RESEARCH_TYPE, exc.unavailable_tools, exc.available_count, scoped=scoped)


def _estate_backend(config: ResearchAgentConfig, builder: Builder) -> Any:
    if config.filesystem is None:
        return None
    from knowledge_layer.estate import EstateBackend

    return EstateBackend(builder.get_function_config(config.filesystem))


def _chat_bound(tools: list[Any], config: ResearchAgentConfig, builder: Builder) -> list[Any]:
    if config.filesystem is None:
        return tools
    from knowledge_layer.chat_binding import chat_tools

    search = builder.get_function_config(config.filesystem)
    return chat_tools(
        tools,
        top_k=int(getattr(search, "top_k", 5)),
        max_per_document=int(getattr(search, "max_chunks_per_document", 0)),
    )


@register_function(config_type=ResearchAgentConfig, framework_wrappers=[LLMFrameworkEnum.LANGCHAIN])
async def research_agent(config: ResearchAgentConfig, builder: Builder):
    llm = await get_langchain_llm(builder, config.llm)
    tools = _chat_bound(await _load_tools(config, builder), config, builder)

    provider = LLMProvider()
    provider.set_default(llm, group=AgentGroup.RESEARCH)
    callbacks = [VerboseTraceCallback()] if is_verbose(config.verbose) else []
    agent = ChatAgent(
        llm_provider=provider,
        tools=tools,
        max_tool_iterations=config.max_tool_iterations,
        max_input_tokens_per_turn=config.max_input_tokens_per_turn,
        max_calls_per_round=config.max_calls_per_round,
        callbacks=callbacks,
        envelope_json_mode_with_tools=config.envelope_json_mode_with_tools,
        repair_pass=config.repair_pass,
        card_repair_llm=(
            pin_chat_model(await get_langchain_llm(builder, config.card_repair_llm), PLATFORM_FIXED)
            if config.card_repair_llm
            else None
        ),
        claim_judge_llm=await get_langchain_llm(builder, config.claim_judge_llm) if config.claim_judge_llm else None,
    )
    deployment = _Deployment(
        config=config, agent=agent, provider=provider, tools=tools, estate=_estate_backend(config, builder)
    )

    async def _run(state: ResearchAgentState) -> ResearchAgentState:
        return await _run_turn(deployment, state)

    yield FunctionInfo.from_fn(_run, description="Research agent for fast, bounded research.")


class ResearchWorkflowConfig(FunctionBaseConfig, name="research_workflow"): ...


@register_function(config_type=ResearchWorkflowConfig, framework_wrappers=[LLMFrameworkEnum.LANGCHAIN])
async def research_workflow(config: ResearchWorkflowConfig, builder: Builder):
    research_agent_fn = await builder.get_function("shallow_research_agent")

    async def _run(query: str, project_context: str | None = None) -> str:
        result = await research_agent_fn.ainvoke(
            ResearchAgentState(messages=[HumanMessage(content=query)], project_context=project_context)
        )
        return str(result.messages[-1].content)

    yield FunctionInfo.from_fn(_run, description="Research workflow for evaluation (accepts string query).")
