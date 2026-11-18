from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

ROOT = Path(__file__).resolve().parents[5]
CONFIG = ROOT / "configs" / "config_oib_openrouter.yml"
SNAPSHOT = ROOT / "packages" / "agent" / "tests" / "fixtures" / "model_facing_text.json"
REGENERATE_ENV = "UPDATE_MODEL_FACING_TEXT"
REGENERATE = f"{REGENERATE_ENV}=1 .venv/bin/python -m pytest -q packages/agent/tests/test_model_facing_text.py"

AGENT_TYPES = frozenset(
    {"data_source_registry", "research_agent", "deep_research_agent", "deep_research_skills", "project_intake_agent"}
)
WEB_SEARCH_TYPE = "tavily_web_search"
SCHEMA_ARGUMENT = {
    "strict_json_response_format": 0,
    "strict_response_format": 0,
    "with_structured_output": 0,
    "DeferredStructuredOutputMiddleware": 0,
    "ProviderStrategy": 0,
    "type_to_response_format_param": 0,
    "invoke_structured": 1,
    "structured_reply": 2,
    "structured_response": 2,
    "_ask": 3,
}
SOURCE_ROOTS = tuple(
    ROOT / "packages" / package / "src" for package in ("agent", "ris-adapter", "tavily-web-search", "knowledge-layer")
)


def render(entries: dict[str, dict[str, Any]]) -> str:
    return json.dumps(entries, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def live(*, without_docstrings: bool = False) -> dict[str, dict[str, Any]]:
    paths = [ROOT / "packages" / "agent" / "src", Path(__file__).resolve().parents[1], ROOT]
    env = {**os.environ, "PYTHONPATH": os.pathsep.join(str(path) for path in paths)}
    optimize = ["-OO"] if without_docstrings else []
    done = subprocess.run(
        [sys.executable, *optimize, "-m", "agent_testing.model_facing_text"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert done.returncode == 0, done.stderr[-4000:]
    line = next(row for row in done.stdout.splitlines() if row.startswith("@@"))
    return json.loads(line[2:])


def _entry(description: str | None, schema: Any = None) -> dict[str, Any]:
    return {"description": description} if schema is None else {"description": description, "schema": schema}


def _tool_entries(context: str, tools: list[Any]) -> dict[str, dict[str, Any]]:
    from langchain_core.utils.function_calling import convert_to_openai_tool

    entries: dict[str, dict[str, Any]] = {}
    for tool in tools:
        function = convert_to_openai_tool(tool)["function"]
        key = f"tool:{context}:{function['name']}"
        assert key not in entries, f"two tools named {key}"
        entries[key] = _entry(function.get("description"), function.get("parameters"))
    return entries


def _response_format(key: str, payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {f"response_format:{key}": _entry(None, payload)}


async def _nat_tools(out: dict[str, dict[str, Any]]) -> None:
    from agent.agents.deep_researcher import register as deep_register
    from agent.agents.deep_researcher.custom_middleware import SourceRegistryMiddleware
    from agent.agents.deep_researcher.factory import build_deep_research_tool_set
    from agent.agents.deep_researcher.tools.research import build_research_batch_tool
    from agent.agents.deep_researcher.tools.source_routing import build_lookup_source_catalog_tool
    from agent.agents.intake.lookups import make_intake_lookup_tools
    from agent.agents.intake.reading import make_read_document_tool
    from agent.agents.intake.tools import make_intake_tools
    from agent.common.agent_tools import load_agent_tools
    from agent.common.backend_tools import BACKEND_READ_TOOLS
    from agent.common.backend_tools import describe_backend_tool
    from agent.core import register as agent_register
    from agent.core.clarify import ClarifierSettings
    from agent.core.clarify import resolve_tools
    from nat.builder.workflow_builder import WorkflowBuilder
    from nat.data_models.config import Config
    from nat.runtime.loader import PluginTypes
    from nat.runtime.loader import discover_and_register_plugins
    from nat.utils.io.yaml_tools import yaml_load

    discover_and_register_plugins(PluginTypes.ALL)
    raw = yaml_load(CONFIG)
    functions = raw["functions"]
    groups = raw.get("function_groups") or {}
    cfg = Config(
        llms=raw.get("llms", {}), embedders=raw.get("embedders", {}), functions=functions, function_groups=groups
    )

    async with WorkflowBuilder() as builder:
        for name, config in cfg.llms.items():
            await builder.add_llm(name, config)
        for name, config in cfg.embedders.items():
            await builder.add_embedder(name, config)
        for name, config in cfg.function_groups.items():
            await builder.add_function_group(name, config)
        for name, config in cfg.functions.items():
            await builder.add_function(name, config)

        chat_config = builder.get_function_config("shallow_research_agent")
        chat = agent_register._chat_bound(await agent_register._load_tools(chat_config, builder), chat_config, builder)
        out.update(_tool_entries("chat", chat))

        deep_config = builder.get_function_config("deep_research_agent")
        sources = await deep_register._explicit_tools(builder, deep_config)
        tool_set = build_deep_research_tool_set(
            sources,
            source_registry_middleware=SourceRegistryMiddleware({tool.name for tool in sources}),
            max_concurrent_source_tool_calls=deep_config.max_concurrent_source_tool_calls,
            max_source_tool_batch_size=deep_config.max_source_tool_batch_size,
        )
        batch = build_research_batch_tool(
            researcher_runnable=None,
            callbacks=[],
            max_research_concurrency=deep_config.max_research_concurrency,
            researcher_tool_names={tool.name for tool in tool_set.researcher_tools},
        )
        router = build_lookup_source_catalog_tool(sources, domain_catalog_path=deep_config.domain_catalog_path)
        out.update(_tool_entries("deep_research.researcher", tool_set.researcher_tools))
        out.update(_tool_entries("deep_research.orchestrator", [*tool_set.helper_tools, batch]))
        out.update(_tool_entries("deep_research.source_router", [router]))

        intake_config = builder.get_function_config("project_intake_agent")
        own = [*make_intake_tools(SimpleNamespace()), make_read_document_tool()]
        shared = await load_agent_tools(builder, list(intake_config.tools))
        names = {tool.name for tool in own}
        out.update(_tool_entries("intake", [*own, *(tool for tool in shared if tool.name not in names)]))
        out.update(_tool_entries("intake.lookups", make_intake_lookup_tools()))

        clarifier = ClarifierSettings.model_validate(raw["workflow"]["clarifier"])
        out.update(_tool_entries("clarifier", await resolve_tools(clarifier, builder)))

        bound = {key.split(":", 2)[2] for key in out}
        tools = [name for name, config in functions.items() if config.get("_type") not in AGENT_TYPES]
        configured = [*tools, *groups]
        unbound = [tool for tool in await load_agent_tools(builder, configured) if tool.name not in bound]
        out.update(_tool_entries("unbound", unbound))

        for name in BACKEND_READ_TOOLS:
            function = await builder.get_function(name)
            served = describe_backend_tool(name, function.description or "", function.input_schema)
            out[f"backend_tool:{name}"] = _entry(served["description"], served["inputSchema"])


async def _web_search_without_key(out: dict[str, dict[str, Any]]) -> None:
    from agent.common.agent_tools import load_agent_tools
    from nat.builder.workflow_builder import WorkflowBuilder
    from nat.data_models.config import Config
    from nat.utils.io.yaml_tools import yaml_load

    raw = yaml_load(CONFIG)
    functions = {name: c for name, c in raw["functions"].items() if c.get("_type") == WEB_SEARCH_TYPE}
    cfg = Config(functions=functions)
    os.environ.pop("TAVILY_API_KEY", None)
    async with WorkflowBuilder() as builder:
        for name, config in cfg.functions.items():
            await builder.add_function(name, config)
        out.update(_tool_entries("web_search_without_key", await load_agent_tools(builder, list(functions))))


def _chat_file_tools(out: dict[str, dict[str, Any]]) -> None:
    from knowledge_layer.estate import EstateBackend
    from langgraph.store.memory import InMemoryStore

    from agent.skills.backend import SkillsBackend
    from agent.tools.documents.draft_store import DraftBackend
    from agent.tools.documents.tools import draft_tools
    from agent.tools.documents.tools import filesystem_tools

    estate = EstateBackend(SimpleNamespace())
    drafts = DraftBackend(store=InMemoryStore(), conversation_id="snapshot")
    skills = SkillsBackend({})
    for label, with_drafts, with_skills in (
        ("drafts+skills", True, True),
        ("drafts", True, False),
        ("skills", False, True),
    ):
        args = (drafts if with_drafts else None, estate)
        kwargs = {"skills": skills if with_skills else None}
        out.update(_tool_entries(f"chat.files.estate+{label}", filesystem_tools(*args, **kwargs)))
        out.update(_tool_entries(f"chat.files.{label}", draft_tools(args[0], **kwargs)))
    out.update(_tool_entries("chat.files.estate", filesystem_tools(None, estate)))


def _response_formats(out: dict[str, dict[str, Any]]) -> None:
    from openai.lib._parsing._completions import type_to_response_format_param
    from public_sources.source import load_sources
    from ris_adapter.lookup.picker import RisPassagePlan
    from ris_adapter.register import RisSearchPlan

    from agent.agents.deep_researcher.anatomy import ReportAnatomyDraft
    from agent.agents.deep_researcher.models.subagent_contracts import ResearchNotes
    from agent.agents.deep_researcher.models.subagent_contracts import ResearchPlan
    from agent.common.answer_envelope import render_envelope_response_format
    from agent.common.claim_judge import CheckReply
    from agent.common.llm_factory import strict_json_response_format
    from agent.core.models.clarify import ClarificationResponse
    from agent.core.models.clarify import PlanResponse
    from agent.knowledge.dossier import DossierReply
    from agent.knowledge.folder_cards.build import CardReply
    from agent.knowledge.law_lookup.picker import PassagePlan
    from agent.knowledge.law_lookup.planner import plan_model
    from agent.knowledge.law_lookup.source import law_source
    from agent.knowledge.permit_extraction import PermitExtraction
    from agent.knowledge.project_experience import ChosenFiles
    from agent.knowledge.project_experience import DecisionReply
    from agent.knowledge.project_experience import FingerprintReply
    from agent.memory.reflection import ReflectionOutput
    from agent.memory.restriction import JudgeOutput
    from agent.stages.follow_ups import FollowUpsDraft

    bound = (
        ReportAnatomyDraft,
        ResearchNotes,
        ResearchPlan,
        ClarificationResponse,
        PlanResponse,
        CheckReply,
        DossierReply,
        CardReply,
        PermitExtraction,
        ChosenFiles,
        DecisionReply,
        FingerprintReply,
        ReflectionOutput,
        JudgeOutput,
        FollowUpsDraft,
    )
    for model in bound:
        out.update(_response_format(model.__qualname__, strict_json_response_format(model)))
    for model in (PassagePlan, RisSearchPlan, RisPassagePlan):
        out.update(_response_format(model.__qualname__, type_to_response_format_param(model)))
    for source_id, source in load_sources().items():
        if source.lookup is not None:
            schema = plan_model(law_source(source_id))
            payload = type_to_response_format_param(schema)
            out.update(_response_format(f"{schema.__qualname__}[{source_id}]", payload))
    out.update(_response_format("answer_envelope", render_envelope_response_format()))


def _prompt_texts(out: dict[str, dict[str, Any]]) -> None:
    from agent.cards.catalog import CHAT_ONLY_CARD_TYPES
    from agent.cards.catalog import SYSTEM_CARD_TYPES
    from agent.cards.catalog import _card_type_of
    from agent.cards.catalog import card_index_entries
    from agent.cards.catalog import describe_card_catalog
    from agent.cards.catalog import render_card_catalog
    from agent.cards.catalog import render_card_details
    from agent.cards.catalog import render_card_index
    from agent.cards.envelope import render_envelope_cards_contract
    from agent.cards.models import AnswerCard
    from agent.cards.prompt import build_card_generation_prompt
    from agent.common.answer_envelope import render_envelope_schema

    def rows(entries: list[tuple[str, str]]) -> str:
        return "\n".join(f"{card_type}: {line}" for card_type, line in entries)

    out["prompt:answer_envelope_schema"] = _entry(render_envelope_schema())
    out["prompt:envelope_cards_contract"] = _entry(render_envelope_cards_contract())
    out["prompt:card_generation"] = _entry(build_card_generation_prompt())
    out["prompt:card_index"] = _entry(render_card_index())
    out["prompt:card_index[exclude_chat_only]"] = _entry(render_card_index(exclude=CHAT_ONLY_CARD_TYPES))
    out["prompt:card_catalog"] = _entry(render_card_catalog())
    out["prompt:card_catalog[post_hoc]"] = _entry(
        render_card_catalog(include_model_backed=False, exclude=CHAT_ONLY_CARD_TYPES)
    )
    out["prompt:card_index_entries"] = _entry(rows(card_index_entries()))
    out["prompt:card_index_entries[exclude_chat_only]"] = _entry(rows(card_index_entries(exclude=CHAT_ONLY_CARD_TYPES)))
    out["card_catalog:describe_card_catalog"] = _entry(None, describe_card_catalog())
    for card_cls in AnswerCard.__args__:
        card_type = _card_type_of(card_cls)
        details = None if card_type in SYSTEM_CARD_TYPES else render_card_details([card_type])
        out[f"card:{card_type}"] = _entry(details, card_cls.model_json_schema())


async def collect() -> dict[str, dict[str, Any]]:
    os.environ.setdefault("OPENROUTER_API_KEY", "schema-generation-only")
    os.environ["TAVILY_API_KEY"] = "schema-generation-only"
    out: dict[str, dict[str, Any]] = {}
    await _nat_tools(out)
    await _web_search_without_key(out)
    _chat_file_tools(out)
    _response_formats(out)
    _prompt_texts(out)
    return out


if __name__ == "__main__":
    print("@@" + json.dumps(asyncio.run(collect()), ensure_ascii=False))
