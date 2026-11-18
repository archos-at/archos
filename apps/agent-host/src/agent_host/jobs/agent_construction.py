from __future__ import annotations

import importlib
import logging
from typing import Any

logger = logging.getLogger(__name__)


def _resolve_worker_tool_refs(fn_config: Any) -> list[str]:
    tool_refs = getattr(fn_config, "tools", None)
    if not tool_refs:
        from agent.common import get_all_tool_refs

        return get_all_tool_refs()
    return list(tool_refs)


async def _resolve_deep_research_checkpointer(fn_config: Any) -> Any | None:
    if getattr(fn_config, "type", None) != "deep_research_agent":
        return None
    checkpoint_db = getattr(fn_config, "checkpoint_db", None)
    if not checkpoint_db:
        return None

    from agent.common import get_checkpointer

    return await get_checkpointer(checkpoint_db)


def _load_agent_class(agent_class_path: str) -> type:
    module_path, class_name = agent_class_path.rsplit(".", 1)
    # nosemgrep: python.lang.security.audit.non-literal-import.non-literal-import -- a registry class path
    module = importlib.import_module(module_path)
    return getattr(module, class_name)


_CHAT_MODEL_AGENT_TYPES = frozenset({"research_agent", "project_intake_agent"})

_BUDGET_GUARDED_AGENT_TYPES = frozenset({"deep_research_agent", "project_intake_agent"})

_JOB_PROFILE_NAMES = {"project_intake_agent": "project_intake_job"}


async def _cached_llm(builder: Any, llm_ref: Any, llm_cache: dict[Any, Any], get_langchain_llm: Any) -> Any:
    if llm_ref not in llm_cache:
        llm_cache[llm_ref] = await get_langchain_llm(builder, llm_ref)
    return llm_cache[llm_ref]


async def _create_llm_provider(builder: Any, fn_config: Any) -> tuple[Any, Any]:
    from agent.common import AgentGroup
    from agent.common import LLMProvider
    from agent.common import LLMRole
    from agent.common import get_langchain_llm

    role_config_attrs = (
        (LLMRole.ORCHESTRATOR, "orchestrator_llm", AgentGroup.DEEP_RESEARCH),
        (LLMRole.ROUTER, "source_router_llm", AgentGroup.DEEP_RESEARCH_ROUTER),
        (LLMRole.PLANNER, "planner_llm", AgentGroup.DEEP_RESEARCH),
        (LLMRole.RESEARCHER, "researcher_llm", AgentGroup.DEEP_RESEARCH),
        (LLMRole.REPORT_WRITER, "writer_llm", AgentGroup.DEEP_RESEARCH),
    )
    llm_cache: dict[Any, Any] = {}
    role_llms = {}
    role_groups = {}
    for role, config_attr, group in role_config_attrs:
        llm_ref = getattr(fn_config, config_attr, None)
        if llm_ref:
            role_llms[role] = await _cached_llm(builder, llm_ref, llm_cache, get_langchain_llm)
            role_groups[role] = group

    default_group = AgentGroup.DEEP_RESEARCH
    default_llm = role_llms.get(LLMRole.ORCHESTRATOR)
    llm_ref = getattr(fn_config, "llm", None) if default_llm is None else None
    if llm_ref:
        default_llm = await _cached_llm(builder, llm_ref, llm_cache, get_langchain_llm)
        if getattr(fn_config, "type", None) in _CHAT_MODEL_AGENT_TYPES:
            default_group = AgentGroup.RESEARCH

    provider = LLMProvider()
    provider.set_default(default_llm, group=default_group)
    for role, llm in role_llms.items():
        provider.configure(role, llm, group=role_groups.get(role))

    return provider, default_llm


def _workflow_reflection_llm_ref(config: Any) -> str | None:
    workflow = getattr(config, "workflow", None)
    ref = getattr(workflow, "memory_reflection_llm", None)
    return str(ref) if ref else None


def _create_agent_instance(
    agent_cls: type,
    llm_provider,
    llm,
    tools: list,
    fn_config,
    verbose: bool,
    callbacks: list,
    job_id: str | None = None,
    checkpointer: Any | None = None,
):
    configured = _configured_agent(agent_cls, llm_provider, tools, fn_config, verbose, callbacks, job_id, checkpointer)
    if configured is not None:
        return configured
    return _constructed_by_convention(agent_cls, llm_provider, llm, tools, fn_config, verbose, callbacks)


def _configured_agent(agent_cls, llm_provider, tools, fn_config, verbose, callbacks, job_id, checkpointer) -> Any:
    from agent.agents.deep_researcher.register import DeepResearchAgentConfig
    from agent.agents.intake.register import ProjectIntakeAgentConfig

    if isinstance(fn_config, ProjectIntakeAgentConfig):
        return agent_cls(
            llm_provider=llm_provider,
            tools=tools,
            verbose=verbose,
            callbacks=callbacks,
            max_tool_steps=fn_config.max_tool_steps,
            max_run_seconds=fn_config.max_run_seconds,
            job_id=job_id,
        )

    if isinstance(fn_config, DeepResearchAgentConfig):
        return agent_cls(
            llm_provider=llm_provider,
            tools=tools,
            verbose=verbose,
            callbacks=callbacks,
            domain_catalog_path=fn_config.domain_catalog_path,
            enable_source_router=fn_config.enable_source_router,
            enable_citation_verification=fn_config.enable_citation_verification,
            skills=fn_config.skills,
            sandbox=fn_config.sandbox,
            job_id=job_id,
            max_research_concurrency=fn_config.max_research_concurrency,
            max_concurrent_source_tool_calls=fn_config.max_concurrent_source_tool_calls,
            max_source_tool_batch_size=fn_config.max_source_tool_batch_size,
            max_run_seconds=fn_config.max_run_seconds,
            checkpointer=checkpointer,
        )
    return None


def _constructed_by_convention(agent_cls, llm_provider, llm, tools, fn_config, verbose, callbacks) -> Any:
    shapes = (
        {"llm_provider": llm_provider, "tools": tools, "verbose": verbose},
        {
            "llm_provider": llm_provider,
            "tools": tools,
            "max_tool_iterations": getattr(fn_config, "max_tool_iterations", 5),
        },
        {"llm": llm, "tools": tools},
    )
    for shape in shapes:
        try:
            return agent_cls(**shape, callbacks=callbacks)
        except TypeError:
            continue
    return agent_cls(callbacks=callbacks)
