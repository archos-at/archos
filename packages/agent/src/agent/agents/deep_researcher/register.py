import asyncio
import logging
from dataclasses import dataclass
from dataclasses import field
from typing import Any

from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage
from langgraph.types import Checkpointer
from pydantic import ConfigDict
from pydantic import Field
from pydantic import field_validator

from agent.common import AgentGroup
from agent.common import LLMProvider
from agent.common import LLMRole
from agent.common import VerboseTraceCallback
from agent.common import all_mapped_tools_filtered_out
from agent.common import filter_tools_by_sources
from agent.common import format_user_facing_tool_error
from agent.common import get_all_tool_refs
from agent.common import get_checkpointer
from agent.common import get_disabled_sources_from_context
from agent.common import get_langchain_llm
from agent.common import is_verbose
from agent.common import validate_tool_availability
from agent.common.agent_tools import load_agent_tools
from agent.common.image_view_budget import begin_image_view_budget
from agent.common.image_view_budget import end_image_view_budget
from agent.common.law_gate import law_sources_withheld
from agent.common.request_llm_context import RequestLLMContext
from agent.common.request_llm_context import read_request_llm_context
from nat.plugin_api import Builder
from nat.plugin_api import Context
from nat.plugin_api import FunctionBaseConfig
from nat.plugin_api import FunctionGroupRef
from nat.plugin_api import FunctionInfo
from nat.plugin_api import FunctionRef
from nat.plugin_api import LLMFrameworkEnum
from nat.plugin_api import LLMRef
from nat.plugin_api import register_function

from .agent import DEFAULT_MAX_CONCURRENT_SOURCE_TOOL_CALLS
from .agent import DEFAULT_MAX_RESEARCH_CONCURRENCY
from .agent import DEFAULT_MAX_RUN_SECONDS
from .agent import DEFAULT_MAX_SOURCE_TOOL_BATCH_SIZE
from .agent import DeepResearcherAgent
from .deepagents_runtime import DeepResearchSandboxConfig
from .deepagents_runtime import DeepResearchSkillsConfig
from .models import DeepResearchAgentState

logger = logging.getLogger(__name__)


class DeepResearchAgentConfig(FunctionBaseConfig, name="deep_research_agent"):
    model_config = ConfigDict(extra="forbid")

    orchestrator_llm: LLMRef = Field(..., description="LLM for orchestrator")
    source_router_llm: LLMRef | None = Field(default=None, description="LLM for source-router subagent")
    researcher_llm: LLMRef | None = Field(default=None, description="LLM for researcher")
    planner_llm: LLMRef | None = Field(default=None, description="LLM for planner")
    writer_llm: LLMRef | None = Field(default=None, description="LLM for final writer/synthesis subagent")
    tools: list[FunctionRef | FunctionGroupRef] = Field(
        default_factory=list,
        description="Explicit tool list. Empty = inherit all from data_source_registry.",
    )
    exclude_tools: list[str] = Field(
        default_factory=list,
        description="Tool names to exclude when inheriting from registry.",
    )
    verbose: bool = Field(default=True)
    domain_catalog_path: str | None = Field(
        default=None,
        description="Optional YAML/JSON domain catalog path for source-router-agent.",
    )
    enable_source_router: bool = Field(
        default=True,
        description="Enable the advisory source-router-agent before planning.",
    )
    enable_citation_verification: bool = Field(
        default=True,
        description="Verify generated citations against sources captured from configured tools.",
    )
    skills: DeepResearchSkillsConfig | FunctionRef | None = Field(
        default=None,
        description="Optional inline skills config or function ref to a deep_research_skills config.",
    )
    sandbox: DeepResearchSandboxConfig | FunctionRef | None = Field(
        default=None,
        description="Optional inline sandbox config or function ref to a deep_research_sandbox config.",
    )
    max_research_concurrency: int = Field(
        default=DEFAULT_MAX_RESEARCH_CONCURRENCY,
        ge=1,
        description="Maximum ResearchQuery items accepted and run concurrently per run_research_batch call.",
    )
    max_concurrent_source_tool_calls: int = Field(
        default=DEFAULT_MAX_CONCURRENT_SOURCE_TOOL_CALLS,
        ge=1,
        description="Shared maximum concurrent source-tool calls across researcher workers.",
    )
    max_source_tool_batch_size: int = Field(
        default=DEFAULT_MAX_SOURCE_TOOL_BATCH_SIZE,
        ge=1,
        description="Maximum concrete inputs accepted by batch-capable source tool wrappers.",
    )
    max_run_seconds: int = Field(
        default=DEFAULT_MAX_RUN_SECONDS,
        ge=0,
        description="Wall-clock budget for one deep-research run in seconds; 0 disables the guard.",
    )
    checkpoint_db: str | None = Field(
        default=None,
        description="Optional SQLite database path or Postgres DSN for durable per-job checkpointing of "
        "deep-research runs (LangGraph thread_id = job_id), enabling resume of a re-invoked job after a "
        "worker crash. None (default) keeps current behavior: an in-memory-only graph with no execution-"
        "state durability. Mirrors the workflow-level chat checkpoint_db pattern, but opt-in "
        "here since deep-research jobs run in ephemeral research worker processes.",
    )

    @field_validator("skills", mode="before")
    @classmethod
    def _parse_inline_skills(cls, value):
        if isinstance(value, dict):
            return DeepResearchSkillsConfig.model_validate(value)
        return value

    @field_validator("sandbox", mode="before")
    @classmethod
    def _parse_inline_sandbox(cls, value):
        if isinstance(value, dict):
            return DeepResearchSandboxConfig.model_validate(value)
        return value


@register_function(config_type=DeepResearchSkillsConfig, framework_wrappers=[LLMFrameworkEnum.LANGCHAIN])
async def deep_research_skills(config: DeepResearchSkillsConfig, builder: Builder):

    async def _noop(query: str) -> str:
        return "This is a config-only function."

    yield FunctionInfo.from_fn(_noop, description="Deep research skills config-only function.")


@register_function(config_type=DeepResearchSandboxConfig, framework_wrappers=[LLMFrameworkEnum.LANGCHAIN])
async def deep_research_sandbox(config: DeepResearchSandboxConfig, builder: Builder):

    async def _noop(query: str) -> str:
        return "This is a config-only function."

    yield FunctionInfo.from_fn(_noop, description="Deep research sandbox config-only function.")


def _resolve_config_ref[ConfigT](
    builder: Builder, value: ConfigT | FunctionRef | None, expected_type: type[ConfigT]
) -> ConfigT | None:
    if value is None or isinstance(value, expected_type):
        return value

    resolved = builder.get_function_config(value)
    if not isinstance(resolved, expected_type):
        raise TypeError(f"{value!r} must reference {expected_type.__name__}, got {type(resolved).__name__}")
    return resolved


def resolve_deep_research_runtime_config(
    config: DeepResearchAgentConfig,
    builder: Builder,
) -> tuple[DeepResearchSkillsConfig | None, DeepResearchSandboxConfig | None]:
    skills = _resolve_config_ref(builder, config.skills, DeepResearchSkillsConfig)
    sandbox = _resolve_config_ref(builder, config.sandbox, DeepResearchSandboxConfig)
    return skills, sandbox


async def _resolve_tools(builder: Builder, tool_refs: list[str], exclude_tools: list[str]) -> list:
    return await load_agent_tools(builder, tool_refs, exclude_tools)


async def _explicit_tools(builder: Builder, config: DeepResearchAgentConfig) -> list | None:
    if not config.tools:
        return None
    tools = await _resolve_tools(builder, list(config.tools), config.exclude_tools)
    is_valid, _, _ = validate_tool_availability(tools, research_type="deep research")
    if not is_valid:
        logger.warning(
            "Startup check: no tools available for deep research. "
            "All queries will fail until at least one tool is properly configured.",
        )
    return tools


_ROLE_LLM_FIELDS: tuple[tuple[str, LLMRole, AgentGroup], ...] = (
    ("source_router_llm", LLMRole.ROUTER, AgentGroup.DEEP_RESEARCH_ROUTER),
    ("researcher_llm", LLMRole.RESEARCHER, AgentGroup.DEEP_RESEARCH),
    ("planner_llm", LLMRole.PLANNER, AgentGroup.DEEP_RESEARCH),
    ("writer_llm", LLMRole.REPORT_WRITER, AgentGroup.DEEP_RESEARCH),
)


async def _build_provider(builder: Builder, config: DeepResearchAgentConfig) -> LLMProvider:
    configured = [(name, role, group) for name, role, group in _ROLE_LLM_FIELDS if getattr(config, name)]
    refs = [config.orchestrator_llm, *(getattr(config, name) for name, _, _ in configured)]
    orchestrator_llm, *role_llms = await asyncio.gather(*(get_langchain_llm(builder, ref) for ref in refs))
    provider = LLMProvider()
    provider.set_default(orchestrator_llm, group=AgentGroup.DEEP_RESEARCH)
    provider.configure(LLMRole.ORCHESTRATOR, orchestrator_llm, group=AgentGroup.DEEP_RESEARCH)
    for (_, role, group), llm in zip(configured, role_llms, strict=True):
        provider.configure(role, llm, group=group)
    return provider


async def _open_checkpointer(checkpoint_db: str | None) -> Checkpointer | None:
    if not checkpoint_db:
        return None
    try:
        return await get_checkpointer(checkpoint_db)
    except Exception:  # noqa: BLE001 - deliberate fail-open boundary
        logger.warning(
            "Durable deep-research checkpointing DISABLED: cannot open checkpoint_db %r "
            "(set DEEP_CHECKPOINT_DB to a writable path/DSN to enable resume-by-job_id)",
            checkpoint_db,
            exc_info=True,
        )
        return None


@dataclass(frozen=True)
class _AgentBlueprint:
    config: DeepResearchAgentConfig
    provider: LLMProvider
    verbose: bool
    callbacks: list[Any]
    skills: DeepResearchSkillsConfig | None
    sandbox: DeepResearchSandboxConfig | None
    checkpointer: Checkpointer | None

    def build(self, tools: list, *, llm_provider: LLMProvider | None = None, job_id: str | None = None):
        config = self.config
        return DeepResearcherAgent(
            llm_provider=llm_provider if llm_provider is not None else self.provider,
            tools=tools,
            verbose=self.verbose,
            callbacks=self.callbacks,
            domain_catalog_path=config.domain_catalog_path,
            enable_source_router=config.enable_source_router,
            enable_citation_verification=config.enable_citation_verification,
            skills=self.skills,
            sandbox=self.sandbox,
            job_id=job_id,
            max_research_concurrency=config.max_research_concurrency,
            max_concurrent_source_tool_calls=config.max_concurrent_source_tool_calls,
            max_source_tool_batch_size=config.max_source_tool_batch_size,
            max_run_seconds=config.max_run_seconds,
            checkpointer=self.checkpointer,
        )


@dataclass
class LazyTools:
    builder: Builder
    blueprint: _AgentBlueprint
    tools: list | None = None
    agent: DeepResearcherAgent | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def get(self) -> tuple[list, DeepResearcherAgent]:
        if self.tools is not None and self.agent is not None:
            return self.tools, self.agent
        async with self.lock:
            if self.tools is not None and self.agent is not None:
                return self.tools, self.agent
            tools = await _resolve_tools(self.builder, get_all_tool_refs(), self.blueprint.config.exclude_tools)
            agent = self.blueprint.build(tools)
            if tools:
                self.tools, self.agent = tools, agent
            return tools, agent


def _agent_for_request(
    blueprint: _AgentBlueprint,
    prebuilt: DeepResearcherAgent,
    tools: list,
    selected_tools: list,
    llm_context: RequestLLMContext,
) -> DeepResearcherAgent:
    provider = llm_context.apply(blueprint.provider)
    if provider is blueprint.provider and blueprint.sandbox is None and selected_tools == tools:
        return prebuilt
    return blueprint.build(selected_tools, llm_provider=provider, job_id=Context.get().workflow_run_id)


async def run_deep_research(state: DeepResearchAgentState, lazy: LazyTools) -> DeepResearchAgentState:
    tools, agent = await lazy.get()
    disabled = set(get_disabled_sources_from_context()) | law_sources_withheld()
    selected_tools = filter_tools_by_sources(tools, state.data_sources, disabled)
    llm_context = await read_request_llm_context()
    active_agent = _agent_for_request(lazy.blueprint, agent, tools, selected_tools, llm_context)
    if all_mapped_tools_filtered_out(tools, selected_tools, state.data_sources):
        logger.warning("Deep research received data_sources with no matching tools")
    is_valid, _, unavailable_tools = validate_tool_availability(selected_tools, research_type="deep research")
    if not is_valid:
        error_msg = format_user_facing_tool_error("deep research", unavailable_tools)
        return DeepResearchAgentState(messages=state.messages + [AIMessage(content=error_msg)])
    budget = begin_image_view_budget()
    try:
        return await active_agent.run(state)
    finally:
        end_image_view_budget(budget)


@register_function(config_type=DeepResearchAgentConfig, framework_wrappers=[LLMFrameworkEnum.LANGCHAIN])
async def deep_research_agent(config: DeepResearchAgentConfig, builder: Builder):
    skills_config, sandbox_config = resolve_deep_research_runtime_config(config, builder)
    explicit_tools, provider, checkpointer = await asyncio.gather(
        _explicit_tools(builder, config),
        _build_provider(builder, config),
        _open_checkpointer(config.checkpoint_db),
    )
    verbose = is_verbose(config.verbose)
    blueprint = _AgentBlueprint(
        config=config,
        provider=provider,
        verbose=verbose,
        callbacks=[VerboseTraceCallback()] if verbose else [],
        skills=skills_config,
        sandbox=sandbox_config,
        checkpointer=checkpointer,
    )
    lazy = LazyTools(
        builder=builder,
        blueprint=blueprint,
        tools=explicit_tools,
        agent=blueprint.build(explicit_tools) if explicit_tools is not None else None,
    )

    async def _run(state: DeepResearchAgentState) -> DeepResearchAgentState:
        return await run_deep_research(state, lazy)

    yield FunctionInfo.from_fn(_run, description="Deep research agent for comprehensive multi-phase research.")


class DeepResearchWorkflowConfig(FunctionBaseConfig, name="deep_research_workflow"):
    pass


@register_function(config_type=DeepResearchWorkflowConfig, framework_wrappers=[LLMFrameworkEnum.LANGCHAIN])
async def deep_research_workflow(config: DeepResearchWorkflowConfig, builder: Builder):
    deep_research_agent_fn = await builder.get_function("deep_research_agent")

    async def _run(query: str, project_context: str | None = None) -> str:
        state = DeepResearchAgentState(messages=[HumanMessage(content=query)], project_context=project_context)
        result = await deep_research_agent_fn.ainvoke(state)
        return str(result.messages[-1].content)

    yield FunctionInfo.from_fn(_run, description="Deep research workflow for evaluation (accepts string query).")
