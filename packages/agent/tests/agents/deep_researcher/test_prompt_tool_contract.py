from __future__ import annotations

import re
from pathlib import Path
from unittest.mock import MagicMock
from unittest.mock import patch

from langchain_core.tools import tool

from agent.agents.deep_researcher import factory as factory_module
from agent.agents.deep_researcher.custom_middleware import SourceRegistryMiddleware
from agent.agents.deep_researcher.deepagents_runtime import DeepAgentsRuntime
from agent.agents.deep_researcher.factory import build_deep_research_graph
from agent.agents.deep_researcher.factory import build_deep_research_middleware_set
from agent.agents.deep_researcher.factory import build_deep_research_tool_set
from agent.agents.deep_researcher.models import DeepResearchAgentState
from agent.agents.deep_researcher.models import ResearchNotes
from agent.common import LLMProvider
from agent.common import LLMRole
from agent.common import load_prompt

PROMPTS_DIR = Path(factory_module.__file__).parent / "prompts"
PROMPT_NAMES = ("planner", "researcher", "orchestrator", "writer", "source_router")

_BUILTIN_TOOL_NAMES = {
    "edit_file",
    "execute",
    "glob",
    "grep",
    "ls",
    "read_file",
    "write_file",
    "task",
    "write_todos",
}


@tool(description="Search the web for information.")
def web_search_tool(query: str) -> str:
    return f"Results for: {query}"


def _real_prompts() -> dict[str, str]:
    return {name: load_prompt(PROMPTS_DIR, name) for name in PROMPT_NAMES}


def _llm_provider() -> LLMProvider:
    llm = MagicMock()
    provider = LLMProvider()
    provider.set_default(llm)
    for role in (
        LLMRole.ROUTER,
        LLMRole.PLANNER,
        LLMRole.RESEARCHER,
        LLMRole.REPORT_WRITER,
        LLMRole.ORCHESTRATOR,
    ):
        provider.configure(role, llm)
    return provider


def _rendered_agents() -> dict[str, dict[str, object]]:
    registry = SourceRegistryMiddleware(source_tool_names={web_search_tool.name})
    tool_set = build_deep_research_tool_set(
        [web_search_tool],
        source_registry_middleware=registry,
        max_concurrent_source_tool_calls=2,
        max_source_tool_batch_size=3,
    )
    middleware_set = build_deep_research_middleware_set(
        tool_set=tool_set,
        source_registry_middleware=registry,
        max_research_concurrency=6,
    )
    runtime = DeepAgentsRuntime()
    fake_graph = MagicMock()
    fake_graph.with_config.return_value = fake_graph

    with (
        patch(
            "agent.agents.deep_researcher.factory.create_deep_agent",
            return_value=fake_graph,
        ) as create_orchestrator,
        patch(
            "agent.agents.deep_researcher.factory.create_agent",
            return_value=MagicMock(),
        ) as create_researcher,
        patch(
            "agent.agents.deep_researcher.factory.create_summarization_middleware",
            return_value=MagicMock(),
        ),
    ):
        build_deep_research_graph(
            llm_provider=_llm_provider(),
            state=DeepResearchAgentState(messages=[]),
            prompts=_real_prompts(),
            tools=[web_search_tool],
            runtime=runtime,
            tool_set=tool_set,
            middleware_set=middleware_set,
            source_registry_middleware=registry,
            callbacks=[],
            domain_catalog_path=None,
            max_research_concurrency=6,
        )

    orchestrator_kwargs = create_orchestrator.call_args.kwargs
    researcher_kwargs = create_researcher.call_args.kwargs

    agents: dict[str, dict[str, object]] = {
        "orchestrator": {
            "system_prompt": orchestrator_kwargs["system_prompt"],
            "tool_names": {tool.name for tool in orchestrator_kwargs["tools"]},
        },
        "researcher-agent": {
            "system_prompt": researcher_kwargs["system_prompt"],
            "tool_names": {tool.name for tool in researcher_kwargs["tools"]},
        },
    }
    for subagent in orchestrator_kwargs["subagents"]:
        agents[subagent["name"]] = {
            "system_prompt": subagent["system_prompt"],
            "tool_names": {tool.name for tool in subagent["tools"]},
        }
    return agents


def _section(prompt: str, heading_contains: str) -> str:
    body: list[str] = []
    capturing = False
    for line in prompt.splitlines():
        if line.startswith("## "):
            if capturing:
                break
            capturing = heading_contains in line
            continue
        if capturing:
            body.append(line)
    return "\n".join(body)


_BOLD_TOOL_BULLET = re.compile(r"^- \*\*(?P<name>[^*]+)\*\*\s*:", re.MULTILINE)


def _advertised_tool_names(section_body: str) -> set[str]:
    return {match.group("name").strip() for match in _BOLD_TOOL_BULLET.finditer(section_body)}


_CALLABLE_TOOL_SECTIONS = {
    "orchestrator": "Available Tools",
    "researcher-agent": "Tool Availability and Prioritization",
    "planner-agent": "Available Search Tools",
}


def test_orchestrator_prompt_never_advertises_source_tools_as_callable():
    agents = _rendered_agents()
    orchestrator = agents["orchestrator"]
    prompt = orchestrator["system_prompt"]

    callable_tools = _advertised_tool_names(_section(prompt, "Available Tools"))
    assert callable_tools == orchestrator["tool_names"]
    assert callable_tools == {"think", "get_verified_sources", "run_research_batch"}
    assert "web_search_tool" not in callable_tools

    not_callable = _section(prompt, "Research Source Tools")
    assert "not directly callable" in prompt
    assert "web_search_tool" in _advertised_tool_names(not_callable)


def test_every_advertised_callable_tool_is_registered_for_its_agent():
    agents = _rendered_agents()
    for agent_name, heading in _CALLABLE_TOOL_SECTIONS.items():
        prompt = agents[agent_name]["system_prompt"]
        bound = agents[agent_name]["tool_names"]
        advertised = _advertised_tool_names(_section(prompt, heading))
        assert advertised, f"{agent_name} prompt advertised no tools; section marker '{heading}' drifted"
        unregistered = advertised - bound - _BUILTIN_TOOL_NAMES
        assert not unregistered, (
            f"{agent_name} prompt advertises tools not in its registered toolset: "
            f"{sorted(unregistered)}. Bound tools: {sorted(bound)}."
        )


def test_source_router_prompt_only_requires_its_bound_tool():
    agents = _rendered_agents()
    router = agents["source-router-agent"]
    assert router["tool_names"] == {"lookup_source_catalog"}
    prompt = router["system_prompt"]
    required = set(re.findall(r"^- `([a-z_]+)`: required", _section(prompt, "Tools"), re.MULTILINE))
    assert required == {"lookup_source_catalog", "write_file"}
    unregistered = required - router["tool_names"] - _BUILTIN_TOOL_NAMES
    assert not unregistered, f"source-router requires unregistered tools: {sorted(unregistered)}"


def test_research_notes_contract_exposes_expected_worker_fields():
    assert set(ResearchNotes.model_fields) == {
        "query_topic",
        "target_components",
        "summary",
        "findings",
        "gaps",
        "sources",
        "narrative_notes",
        "language",
        "evidence_judgment",
    }
