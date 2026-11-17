from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable
from collections.abc import Callable
from collections.abc import Mapping
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from typing import Self

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import BaseMessage
from langchain_core.messages import HumanMessage
from langchain_core.messages import SystemMessage
from langchain_core.messages import ToolCall
from langchain_core.messages import ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import BaseTool
from pydantic import BaseModel
from pydantic import Field
from pydantic import ValidationError

from agent.common import AgentGroup
from agent.common import LLMProvider
from agent.common import LLMRole
from agent.common import VerboseTraceCallback
from agent.common import all_mapped_tools_filtered_out
from agent.common import apply_model_override
from agent.common import apply_org_credential
from agent.common import build_human_prompt
from agent.common import content_to_text
from agent.common import extract_json
from agent.common import extract_user_response
from agent.common import filter_tools_by_sources
from agent.common import get_all_tool_refs
from agent.common import get_langchain_llm
from agent.common import get_latest_user_query
from agent.common import is_verbose
from agent.common import load_prompt
from agent.common import render_prompt_template
from agent.common import strict_json_response_format
from agent.common.agent_tools import load_agent_tools
from agent.common.plan_documents import MAX_PLAN_DOCUMENTS
from agent.common.plan_documents import PlanDocuments
from agent.common.plan_documents import documents_from_plan
from agent.common.plan_vocabulary import modernize_plan
from agent.common.request_llm_context import RequestLLMContext
from agent.common.request_llm_context import read_request_llm_context
from agent.common.turn_status import emit_step
from agent.common.wire_v2 import ClarificationStep
from agent.project_context import get_organization_id_from_context
from nat.plugin_api import Builder
from nat.plugin_api import Context
from nat.plugin_api import FunctionGroupRef
from nat.plugin_api import FunctionRef
from nat.plugin_api import LLMRef

from .models.clarify import ClarificationResponse
from .models.clarify import ClarifyRequest
from .models.clarify import ClarifyResult
from .models.clarify import PlanDecision
from .models.clarify import PlanOutcome
from .models.clarify import PlanResponse
from .plan_decisions import PlanShape
from .plan_decisions import decide_plan_shape

logger = logging.getLogger(__name__)

PROMPTS_DIR = Path(__file__).parent / "prompts"
"""Where this agent's Jinja templates live."""

CLARIFICATION_PROMPT = load_prompt(PROMPTS_DIR, "research_clarification")
PLAN_GENERATION_PROMPT = load_prompt(PROMPTS_DIR, "plan_generation")
"""Read once, at import. A deployment that ships without a prompt file fails
here, loudly, instead of running degraded on an inline stub nobody reviews."""

SKIP_COMMANDS = frozenset({"skip", "done", "exit", "quit", "proceed", "continue", "no", "n", ""})
"""Replies to a clarification QUESTION that mean "stop asking and get on with it"."""

PLAN_REPLIES: dict[str, PlanDecision] = {
    "approve": "approved",
    "shallow": "shallow",
    "cancel": "cancelled",
    "no": "shallow",
    "nein": "shallow",
    "nope": "shallow",
    "reject": "shallow",
    "stop": "cancelled",
    "abbrechen": "cancelled",
}
"""Literal reply -> decision. Everything else is feedback for a plan revision."""

FALLBACK_PLAN_TITLE = "Research Report"
FALLBACK_PLAN_SECTIONS = ("Introduction", "Background", "Analysis", "Findings", "Conclusion")
"""The outline shown when the planner returns nothing usable."""

MAX_TOOL_ROUNDS = 4
"""How many times one clarification decision may search before it must decide.

The prompt asks for "at most 1-2 searches" and no transcript has ever needed a
third, so this is a ceiling and not a budget. It exists because the loop that
replaced the LangGraph has to state its own bound: the graph's was LangGraph's
``recursion_limit`` (25 super-steps for the whole dialog), which is not a
number anybody chose for this.
"""

JSON_REMINDER_AFTER_TOOLS = (
    "Based on the search results above, now make your clarification decision. "
    "IMPORTANT: You must respond with ONLY a valid JSON object, nothing else. "
    "Do NOT write a report, summary, or analysis. "
    "Output exactly: "
    '{"needs_clarification": true, "clarification_question": "your question", "options": []} '
    "OR "
    '{"needs_clarification": false, "clarification_question": null, "options": []}'
)
"""Reminder after tool results. Only the tool-bound binding needs it: the
tool-free one gets the schema natively (see :func:`_clarifier_llm`)."""

AskUser = Callable[[str, Sequence[str]], Awaitable[str]]
"""Asks the user a question, offering ``options`` as pickable labels, and
returns their reply. Empty options means a free-text question."""

ClarifyFn = Callable[[ClarifyRequest], Awaitable[ClarifyResult]]
"""What the conversation graph holds: one call, one finished dialog."""


class ClarifierSettings(BaseModel):
    llm: LLMRef = Field(..., description="LLM to use for generating questions")
    planner_llm: LLMRef | None = Field(
        default=None,
        description="LLM to use for plan generation. If not specified, uses the main llm.",
    )
    tools: list[FunctionRef | FunctionGroupRef] = Field(
        default_factory=list,
        description="Explicit tool list. Empty = inherit all from data_source_registry.",
    )
    exclude_tools: list[str] = Field(
        default_factory=list,
        description="Tool names to exclude when inheriting from registry.",
    )
    max_turns: int = Field(default=3, description="Maximum number of clarification Q&A turns")
    enable_plan_approval: bool = Field(
        default=False,
        description="Whether to enable plan preview and approval after clarification",
    )
    max_plan_iterations: int = Field(
        default=10,
        description="Maximum number of plan feedback iterations before auto-approving",
    )
    log_response_max_chars: int = Field(default=2000, description="Max characters to log from LLM responses")
    verbose: bool = Field(default=False, description="Whether to enable verbose logging")


@dataclass(frozen=True)
class ClarifyDeps:
    llm: Any
    planner_llm: Any
    tools: Mapping[str, BaseTool]
    ask_user: AskUser
    max_turns: int
    enable_plan_approval: bool
    max_plan_iterations: int
    callbacks: tuple[Any, ...] = ()

    @property
    def run_config(self) -> RunnableConfig:
        return {"callbacks": list(self.callbacks)}


def parse_json_response[ModelT: BaseModel](content: Any, schema: type[ModelT]) -> ModelT | None:
    payload = extract_json(content_to_text(content))
    if payload is None:
        logger.warning("No JSON in the %s reply: %.200s", schema.__name__, content_to_text(content))
        return None
    try:
        return schema.model_validate(payload)
    except ValidationError as exc:
        logger.warning("Reply did not validate as %s: %s", schema.__name__, exc)
        return None


def unwrap_query(reply: str) -> str:
    try:
        data = json.loads(reply)
    except json.JSONDecodeError, TypeError:
        return reply
    if isinstance(data, dict) and isinstance(data.get("query"), str):
        return data["query"]
    return reply


def parse_plan_reply(reply: str) -> tuple[PlanDecision, str]:
    text = unwrap_query(reply).strip()
    decision = PLAN_REPLIES.get(text.lower())
    if decision is not None:
        return decision, ""
    head, _, rest = text.partition(" ")
    if head.lower() == "approve" and rest.strip().startswith("{"):
        return "approved", rest.strip()
    return "feedback", text


MAX_PLAN_SECTIONS = 12


def _parse_edits(edits_json: str) -> dict[str, Any] | None:
    try:
        edits = json.loads(edits_json)
    except ValueError:
        logger.warning("Plan edits did not parse; running the plan as shown")
        return None
    return edits if isinstance(edits, dict) else None


def _names(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [v.strip() for v in value if isinstance(v, str) and v.strip()][:MAX_PLAN_DOCUMENTS]


def apply_plan_edits(plan: PlanResponse, edits_json: str) -> PlanResponse:
    edits = _parse_edits(edits_json)
    if edits is None:
        return plan
    edits = modernize_plan(edits)
    data = plan.model_dump()
    sections = edits.get("sections")
    if isinstance(sections, list):
        kept = [s.strip()[:200] for s in sections if isinstance(s, str) and s.strip()][:MAX_PLAN_SECTIONS]
        if kept:
            data["sections"] = kept
    for key in ("genre", "depth"):
        if isinstance(edits.get(key), str):
            data[key] = edits[key]
    for key in ("basis", "excluded"):
        if isinstance(edits.get(key), list):
            data[key] = _names(edits[key])
    try:
        return PlanResponse.model_validate(data)
    except ValidationError as exc:
        logger.warning("Plan edits did not validate (%s); running the plan as shown", exc)
        return plan


def plan_data_sources(edits_json: str) -> list[str] | None:
    edits = _parse_edits(edits_json) if edits_json else None
    if edits is None or not isinstance(edits.get("data_sources"), list):
        return None
    return [s.strip() for s in edits["data_sources"] if isinstance(s, str) and s.strip()]


def plan_documents(plan: PlanResponse, inventory: list[dict[str, Any]] | None) -> PlanDocuments | None:
    return documents_from_plan(plan.basis, plan.excluded, inventory)


def _inventory_rows(inventory: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in inventory or []:
        if not isinstance(row, dict) or not isinstance(row.get("file_name"), str):
            continue
        entry: dict[str, Any] = {"name": row["file_name"]}
        if isinstance(row.get("display_title"), str) and row["display_title"].strip():
            entry["title"] = row["display_title"].strip()
        if isinstance(row.get("shelf"), str) and row["shelf"]:
            entry["shelf"] = row["shelf"]
        rows.append(entry)
        if len(rows) >= MAX_PLAN_INVENTORY_ROWS:
            break
    return rows


MAX_PLAN_INVENTORY_ROWS = 200


def format_plan_for_user(plan: PlanResponse, inventory: list[dict[str, Any]] | None = None) -> str:
    sections_text = "\n".join(f"  {i + 1}. {s}" for i, s in enumerate(plan.sections))
    payload: dict[str, Any] = plan.model_dump()
    rows = _inventory_rows(inventory)
    if rows:
        payload["documents"] = rows
    plan_json = json.dumps(payload, ensure_ascii=False)
    return (
        f"**Research Plan Preview**\n\n"
        f"**Title:** {plan.title}\n\n"
        f"**Sections:**\n{sections_text}\n\n"
        f"```plan_json\n{plan_json}\n```\n\n"
        f"---\n"
        f"Reply **approve** to proceed, **shallow** for a quick answer instead, "
        f"**cancel** to dismiss, or provide feedback to revise the plan."
    )


def fallback_clarification(query: str | None) -> ClarificationResponse:
    if not query:
        return ClarificationResponse(
            needs_clarification=True,
            clarification_question=(
                "I'd like to help with your research. Could you provide more details about:\n\n"
                "1. What specific aspects interest you most?\n"
                "2. Who is this report for?\n"
                "3. How detailed should it be?"
            ),
            options=[],
        )
    topic_snippet = query[:80].strip() + ("..." if len(query) > 80 else "")
    return ClarificationResponse(
        needs_clarification=True,
        clarification_question=(
            f'To help with your research on: "{topic_snippet}"\n\n'
            "Could you specify:\n"
            "1. Which specific aspects are most important to you?\n"
            "2. What level of detail do you need?\n"
            "3. Or type 'skip' to proceed with a general approach."
        ),
        options=[],
    )


def question_for(response: ClarificationResponse | None, messages: Sequence[BaseMessage]) -> ClarificationResponse:
    if response is not None and response.is_valid():
        return response
    logger.warning("Unusable clarification from the model, asking the fallback question instead")
    return fallback_clarification(get_latest_user_query(list(messages)))


def _document_lines(docs: list[Any]) -> str:
    lines = []
    for doc in docs:
        where = f" [{doc.shelf}]" if doc.shelf else ""
        title = f"{doc.title} — " if doc.title and doc.title != doc.name else ""
        lines.append(f"- {title}{doc.name}{where}")
    return "\n".join(lines)


def approved_plan_context(plan: PlanResponse, documents: PlanDocuments | None = None) -> str:
    sections_text = "\n".join(f"- {s}" for s in plan.sections)
    text = (
        f"**Approved Research Plan**\n\nTitle: {plan.title}\nGenre: {plan.genre}\nDepth: {plan.depth}\n\n"
        f"Sections (required components, in this order):\n{sections_text}"
    )
    if documents and documents.basis:
        text += (
            "\n\nGrundlage (documents to read in full, each through its own research query; "
            f"a report that could not reach one names it as unread):\n{_document_lines(documents.basis)}"
        )
    if documents and documents.excluded:
        text += (
            "\n\nAusgeschlossen (documents that may not be used: never searched, never cited):\n"
            f"{_document_lines(documents.excluded)}"
        )
    return text


def _fallback_plan() -> PlanResponse:
    return PlanResponse(title=FALLBACK_PLAN_TITLE, sections=list(FALLBACK_PLAN_SECTIONS))


def _clarification_messages(
    request: ClarifyRequest, deps: ClarifyDeps, messages: Sequence[BaseMessage], log: str
) -> list[BaseMessage]:
    system_prompt = render_prompt_template(
        CLARIFICATION_PROMPT,
        clarifier_result=log,
        project_context=request.project_context,
        available_documents=request.available_documents or [],
        max_turns=deps.max_turns,
    )
    outgoing: list[BaseMessage] = [SystemMessage(content=system_prompt), *messages]
    if messages and isinstance(messages[-1], ToolMessage):
        outgoing.append(HumanMessage(content=JSON_REMINDER_AFTER_TOOLS))
    return outgoing


async def _run_one_tool(deps: ClarifyDeps, call: ToolCall) -> ToolMessage:
    call_id = call.get("id") or ""
    tool = deps.tools.get(call.get("name") or "")
    if tool is None:
        logger.warning("Clarifier: the model called an unknown tool %r", call.get("name"))
        return ToolMessage(content=f"Error: no tool named {call.get('name')!r}", tool_call_id=call_id)
    try:
        return await tool.ainvoke(call, config=deps.run_config)
    except Exception as exc:  # noqa: BLE001 - handed to the model as a tool result
        logger.exception("Clarifier: tool %s failed", tool.name)
        return ToolMessage(content=f"Error: {exc}", tool_call_id=call_id, status="error")


async def run_tool_calls(deps: ClarifyDeps, calls: Sequence[ToolCall]) -> list[ToolMessage]:
    return list(await asyncio.gather(*(_run_one_tool(deps, call) for call in calls)))


async def _decide(
    request: ClarifyRequest, deps: ClarifyDeps, messages: list[BaseMessage], log: str
) -> tuple[ClarificationResponse | None, list[BaseMessage]]:
    for _ in range(MAX_TOOL_ROUNDS + 1):
        reply = await deps.llm.ainvoke(_clarification_messages(request, deps, messages, log), config=deps.run_config)
        messages = [*messages, reply]
        if not getattr(reply, "tool_calls", None):
            return parse_json_response(reply.content, ClarificationResponse), messages
        messages = [*messages, *await run_tool_calls(deps, reply.tool_calls)]
    logger.warning("Clarifier: the model kept searching past %d rounds; proceeding without a question", MAX_TOOL_ROUNDS)
    return ClarificationResponse.complete(), messages


async def gather_clarification(request: ClarifyRequest, deps: ClarifyDeps) -> str:
    messages = list(request.messages)
    log = ""
    for turn in range(1, deps.max_turns + 1):
        response, messages = await _decide(request, deps, messages, log)
        if response is not None and not response.needs_clarification:
            return log
        clarification = question_for(response, messages)
        question = clarification.clarification_question or ""
        log = f"{log}\n**Turn {turn} - Assistant:**\n{question}"
        reply = await deps.ask_user(question, clarification.options)
        if reply.strip().lower() in SKIP_COMMANDS:
            logger.info("Clarifier: User requested to skip clarification")
            return f"{log}\n**Turn {turn} - User:** [Skipped clarification]"
        messages = [*messages, HumanMessage(content=reply)]
        log = f"{log}\n**Turn {turn} - User:**\n{reply}"
    return log


async def generate_plan(
    request: ClarifyRequest, deps: ClarifyDeps, log: str, feedback_history: list[str]
) -> PlanResponse:
    query = get_latest_user_query(list(request.messages)) or ""
    shape = await decide_plan_shape(query, request.project_context, organization_id=get_organization_id_from_context())
    system_prompt = render_prompt_template(
        PLAN_GENERATION_PROMPT,
        project_context=request.project_context,
        clarifier_context=log,
        feedback_history=feedback_history or None,
        preselected=_preselection_text(shape),
        available_documents=request.available_documents or [],
    )
    anchor = HumanMessage(
        content=(
            "Generate a research plan for the user's CURRENT request below. "
            "Earlier messages are background context only — do NOT plan around "
            "topics from earlier turns that the current request does not ask about.\n\n"
            f"Current request: {get_latest_user_query(list(request.messages))}"
        )
    )
    outgoing = [SystemMessage(content=system_prompt), *request.messages, anchor]
    response = await deps.planner_llm.ainvoke(outgoing, config=deps.run_config)
    plan = parse_json_response(response.content, PlanResponse)
    if plan is None or not plan.title or not plan.sections:
        logger.warning("Planner returned no usable plan; showing the generic outline")
        return _fallback_plan()
    return plan


def _preselection_text(shape: PlanShape) -> str | None:
    lines = []
    if shape.genre:
        lines.append(f"genre: {shape.genre}")
    if shape.depth:
        lines.append(f"depth: {shape.depth}")
    return "\n".join(lines) or None


def _outcome(
    log: str,
    plan: PlanResponse,
    outcome: PlanOutcome,
    *,
    inventory: list[dict[str, Any]] | None = None,
    data_sources: list[str] | None = None,
) -> ClarifyResult:
    if outcome != "approved":
        return ClarifyResult(research_context=log, outcome=outcome)
    documents = plan_documents(plan, inventory)
    return ClarifyResult(
        research_context=f"{log}\n\n{approved_plan_context(plan, documents)}",
        outcome="approved",
        data_sources=data_sources,
        documents=documents,
    )


async def preview_plan(request: ClarifyRequest, deps: ClarifyDeps, log: str) -> ClarifyResult:
    feedback_history: list[str] = []
    plan = _fallback_plan()

    for _ in range(deps.max_plan_iterations):
        plan = await generate_plan(request, deps, log, feedback_history)
        shown = format_plan_for_user(plan, request.available_documents)
        decision, feedback = parse_plan_reply(await deps.ask_user(shown, ()))
        if decision != "feedback":
            data_sources = None
            if decision == "approved" and feedback:
                plan = apply_plan_edits(plan, feedback)
                data_sources = plan_data_sources(feedback)
            logger.info("Clarifier: plan %s by user", decision)
            return _outcome(log, plan, decision, inventory=request.available_documents, data_sources=data_sources)
        logger.info("Clarifier: User provided feedback, regenerating plan")
        feedback_history.append(feedback)

    logger.warning("Clarifier: Max plan iterations reached, auto-approving")
    return _outcome(log, plan, "approved", inventory=request.available_documents)


async def clarify(request: ClarifyRequest, deps: ClarifyDeps) -> ClarifyResult:
    logger.info("Clarifier: Starting (max %d turns)", deps.max_turns)
    query = get_latest_user_query(list(request.messages))
    logger.info("User's query: %s...", str(query)[:100] if query else "")
    if deps.max_turns:
        emit_step(ClarificationStep(id="clarification", max_turns=deps.max_turns))
    log = await gather_clarification(request, deps)
    if not deps.enable_plan_approval:
        return ClarifyResult(research_context=log)
    return await preview_plan(request, deps, log)


async def ask_through_nat(question: str, options: Sequence[str] = ()) -> str:
    user_input_manager = Context.get().user_interaction_manager
    response = await user_input_manager.prompt_user_input(build_human_prompt(question, list(options)))
    return extract_user_response(response)


async def resolve_tools(settings: ClarifierSettings, builder: Builder) -> list[BaseTool]:
    return await load_agent_tools(builder, settings.tools or get_all_tool_refs(), settings.exclude_tools)


def _clarifier_llm(llm: BaseChatModel, tools: Sequence[BaseTool]) -> Any:
    if tools:
        return llm.bind_tools(tools, parallel_tool_calls=True)
    return llm.bind(response_format=strict_json_response_format(ClarificationResponse))


def build_deps(
    provider: LLMProvider,
    tools: Sequence[BaseTool],
    planner_llm: BaseChatModel | None,
    settings: ClarifierSettings,
    ask_user: AskUser,
    callbacks: tuple[Any, ...] = (),
) -> ClarifyDeps:
    llm = provider.get(LLMRole.CLARIFIER)
    planner = planner_llm or llm
    return ClarifyDeps(
        llm=_clarifier_llm(llm, tools),
        planner_llm=planner.bind(response_format=strict_json_response_format(PlanResponse)),
        tools={tool.name: tool for tool in tools},
        ask_user=ask_user,
        max_turns=settings.max_turns,
        enable_plan_approval=settings.enable_plan_approval,
        max_plan_iterations=settings.max_plan_iterations,
        callbacks=callbacks,
    )


def _request_planner(planner_llm: BaseChatModel | None, context: RequestLLMContext) -> BaseChatModel | None:
    if planner_llm is None:
        return None
    return apply_model_override(
        apply_org_credential(planner_llm, context.credential),
        AgentGroup.CLARIFIER,
        context.model_overrides,
        zdr_only=context.zdr_only,
        reasoning_effort=context.reasoning_efforts.get(AgentGroup.CLARIFIER.value, ""),
    )


@dataclass(frozen=True)
class Clarifier:
    provider: LLMProvider
    tools: tuple[BaseTool, ...]
    planner_llm: BaseChatModel | None
    settings: ClarifierSettings
    ask_user: AskUser
    callbacks: tuple[Any, ...]
    boot: ClarifyDeps

    @classmethod
    def build(
        cls,
        provider: LLMProvider,
        tools: Sequence[BaseTool],
        planner_llm: BaseChatModel | None,
        settings: ClarifierSettings,
        ask_user: AskUser = ask_through_nat,
        callbacks: tuple[Any, ...] = (),
    ) -> Self:
        return cls(
            provider=provider,
            tools=tuple(tools),
            planner_llm=planner_llm,
            settings=settings,
            ask_user=ask_user,
            callbacks=callbacks,
            boot=build_deps(provider, tools, planner_llm, settings, ask_user, callbacks),
        )

    async def deps_for(self, request: ClarifyRequest) -> ClarifyDeps:
        selected = filter_tools_by_sources(list(self.tools), request.data_sources)
        if all_mapped_tools_filtered_out(list(self.tools), selected, request.data_sources):
            logger.warning("Clarifier received data_sources with no matching tools")
        context = await read_request_llm_context()
        active = context.apply(self.provider)
        if active is self.provider and selected == list(self.tools):
            return self.boot
        planner = _request_planner(self.planner_llm, context)
        return build_deps(active, selected, planner, self.settings, self.ask_user, self.callbacks)

    async def __call__(self, request: ClarifyRequest) -> ClarifyResult:
        return await clarify(request, await self.deps_for(request))


async def build_clarifier(settings: ClarifierSettings, builder: Builder) -> ClarifyFn:
    llm = await get_langchain_llm(builder, settings.llm)
    planner_llm = await get_langchain_llm(builder, settings.planner_llm) if settings.planner_llm else None
    tools = await resolve_tools(settings, builder)

    provider = LLMProvider()
    provider.set_default(llm, group=AgentGroup.CLARIFIER)

    verbose = is_verbose(settings.verbose)
    callbacks = (
        (VerboseTraceCallback(log_reasoning=True, max_chars=settings.log_response_max_chars),) if verbose else ()
    )
    return Clarifier.build(provider, tools, planner_llm, settings, callbacks=callbacks)
