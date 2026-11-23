from __future__ import annotations

import logging
from collections.abc import Awaitable
from collections.abc import Callable
from collections.abc import Mapping
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any
from typing import Self

from langchain_core.language_models import BaseChatModel
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import BaseTool
from pydantic import BaseModel
from pydantic import Field

from agent.common import AgentGroup
from agent.common import LLMProvider
from agent.common import LLMRole
from agent.common import VerboseTraceCallback
from agent.common import all_mapped_tools_filtered_out
from agent.common import apply_model_override
from agent.common import apply_org_credential
from agent.common import build_human_prompt
from agent.common import extract_user_response
from agent.common import filter_tools_by_sources
from agent.common import get_all_tool_refs
from agent.common import get_langchain_llm
from agent.common import get_latest_user_query
from agent.common import is_verbose
from agent.common import strict_json_response_format
from agent.common.agent_tools import load_agent_tools
from agent.common.request_llm_context import RequestLLMContext
from agent.common.request_llm_context import read_request_llm_context
from agent.common.turn_status import emit_step
from agent.common.wire_v2 import ClarificationStep
from nat.plugin_api import Builder
from nat.plugin_api import Context
from nat.plugin_api import FunctionGroupRef
from nat.plugin_api import FunctionRef
from nat.plugin_api import LLMRef

from .clarify_dialog import gather_clarification
from .clarify_plan import preview_plan
from .models.clarify import ClarificationResponse
from .models.clarify import ClarifyRequest
from .models.clarify import ClarifyResult
from .models.clarify import PlanResponse

logger = logging.getLogger(__name__)

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
