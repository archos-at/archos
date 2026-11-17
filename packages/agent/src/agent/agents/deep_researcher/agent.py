from __future__ import annotations

import asyncio
import functools
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

from langchain_core.tools import BaseTool
from langgraph.types import Checkpointer

from agent.citations.entries import EmptySourceRegistryError
from agent.citations.session import get_session_registry
from agent.citations.session import reset_session_registry
from agent.citations.session import set_session_registry
from agent.common import LLMProvider
from agent.common import citation_events
from agent.common import load_prompt
from agent.common import validate_tool_availability
from agent.common.plan_documents import PlanDocuments
from agent.common.plan_documents import unread_basis
from agent.common.turn_notices import CUTOFF_USER_REQUESTED
from agent.common.turn_notices import DEGRADED_NO_REPORT_FILE
from agent.common.turn_status import begin_lane_capture
from agent.common.turn_status import end_lane_capture
from agent.common.turn_status import get_lane_captures
from agent.common.turn_status import step_scope
from agent.common.turn_status import subagent_run
from agent.core.markers import ConfidenceLevel
from agent.core.markers import detect_and_strip_confidence_marker
from agent.observability.citation_scores import emit_citation_line_scores
from agent.observability.langfuse_trace_attributes import begin_trace_contributions
from agent.observability.langfuse_trace_attributes import end_trace_contributions
from agent.project_context import get_organization_id_from_context
from agent.skills import Skill
from agent.skills import SkillRuntime
from agent.skills import resolve_served_skills
from agent.skills.events import emit_skills_offered

from .control import all_added_documents
from .control import begin_write_now_record
from .control import end_write_now_record
from .control import write_now_honoured
from .custom_middleware import SourceRegistryMiddleware
from .cutoff import classify_cutoff
from .cutoff import salvage_cutoff
from .cutoff import stream_with_budget
from .deepagents_runtime import DeepAgentsRuntime
from .deepagents_runtime import DeepResearchSandboxConfig
from .deepagents_runtime import DeepResearchSkillsConfig
from .factory import DeepResearchMiddlewareSet
from .factory import DeepResearchToolSet
from .factory import build_deep_research_graph
from .factory import build_deep_research_middleware_set
from .factory import build_deep_research_tool_set
from .finalize import _HONESTY_BANNER_PREFIX  # noqa: F401 - re-exported for tests
from .finalize import MIN_SALVAGE_REPORT_CHARS  # noqa: F401 - re-exported for tests
from .finalize import Verification
from .finalize import _apply_renumbering  # noqa: F401 - re-exported for tests
from .finalize import _cited_sources_to_wire  # noqa: F401 - re-exported for tests
from .finalize import _prepend_honesty_banner  # noqa: F401 - re-exported for tests
from .finalize import _salvaged_report_length  # noqa: F401 - re-exported for tests
from .finalize import annotate_state
from .finalize import emit_final_report
from .finalize import extract_final_markdown
from .finalize import finalize_report
from .finalize import log_completion
from .finalize import record_citation_ledger
from .finalize import record_retrieval_ledger
from .finalize import replace_last_message_content
from .finalize import verify_report
from .models import DeepResearchAgentState
from .models import last_message_text
from .tools.research import RetrievalRounds
from .tools.source_tool_batching import DEFAULT_MAX_CONCURRENT_SOURCE_TOOL_CALLS
from .tools.source_tool_batching import DEFAULT_MAX_SOURCE_TOOL_BATCH_SIZE

logger = logging.getLogger(__name__)

DEFAULT_MAX_RESEARCH_CONCURRENCY = 6

DEFAULT_MAX_RUN_SECONDS = 2400

AGENT_DIR = Path(__file__).parent

SKILL_AGENT = "deep_researcher"
DEEP_RESEARCH_AGENT = SKILL_AGENT

_PROMPT_NAMES = ("planner", "researcher", "orchestrator", "writer", "source_router")


@functools.cache
def _prompt_templates() -> dict[str, str]:
    return {name: load_prompt(AGENT_DIR / "prompts", name) for name in _PROMPT_NAMES}


def _resolve_skills_blocking(organization_id: str | None) -> tuple[Skill, ...]:
    return resolve_served_skills(SKILL_AGENT, organization_id)


def _run_scoped_callbacks(callbacks: Sequence[Any], source_registry_middleware: SourceRegistryMiddleware) -> list[Any]:
    scoped = [cb.for_new_run() if hasattr(cb, "for_new_run") else cb for cb in callbacks]
    for cb in scoped:
        setter = getattr(cb, "set_source_registry", None)
        if callable(setter):
            setter(source_registry_middleware.active_registry)
        exclusion = getattr(cb, "set_source_exclusion", None)
        if callable(exclusion):
            exclusion(source_registry_middleware.is_excluded)
    return scoped


def _log_run_start(state: DeepResearchAgentState) -> None:
    if not state.messages:
        return
    query_content = state.messages[-1].content
    query = query_content if isinstance(query_content, str) else str(query_content)
    logger.info("=" * 80)
    logger.info("Deep Research Subagent: Starting workflow")
    logger.info("Query: %s...", query[:100])
    logger.info("=" * 80)


@dataclass(frozen=True)
class DeepResearchRunArtifacts:
    graph: Any
    source_registry_middleware: SourceRegistryMiddleware
    tool_set: DeepResearchToolSet
    middleware_set: DeepResearchMiddlewareSet
    callbacks: list[Any]
    rounds: RetrievalRounds
    plan_documents: PlanDocuments | None
    skill_runtime: SkillRuntime


class DeepResearcherAgent:
    state_model = DeepResearchAgentState

    def __init__(
        self,
        llm_provider: LLMProvider,
        tools: Sequence[BaseTool] | None = None,
        *,
        verbose: bool = True,
        callbacks: list[Any] | None = None,
        domain_catalog_path: str | None = None,
        enable_source_router: bool = True,
        enable_citation_verification: bool = True,
        skills: DeepResearchSkillsConfig | None = None,
        sandbox: DeepResearchSandboxConfig | None = None,
        job_id: str | None = None,
        max_research_concurrency: int = DEFAULT_MAX_RESEARCH_CONCURRENCY,
        max_concurrent_source_tool_calls: int = DEFAULT_MAX_CONCURRENT_SOURCE_TOOL_CALLS,
        max_source_tool_batch_size: int = DEFAULT_MAX_SOURCE_TOOL_BATCH_SIZE,
        max_run_seconds: int = DEFAULT_MAX_RUN_SECONDS,
        checkpointer: Checkpointer | None = None,
    ) -> None:
        self.llm_provider = llm_provider
        self.tools = list(tools) if tools else []
        self.verbose = verbose
        self.callbacks = callbacks or []
        self.max_research_concurrency = max_research_concurrency
        self.max_concurrent_source_tool_calls = max_concurrent_source_tool_calls
        self.max_source_tool_batch_size = max_source_tool_batch_size
        self.max_run_seconds = max_run_seconds
        self.domain_catalog_path = domain_catalog_path
        self.enable_source_router = enable_source_router
        self.enable_citation_verification = enable_citation_verification
        self.job_id = str(job_id) if job_id is not None else str(uuid4())
        self.checkpointer = checkpointer
        self.deepagents_runtime = DeepAgentsRuntime(skills=skills, sandbox=sandbox, job_id=self.job_id)
        self._prompts = _prompt_templates()
        self.source_tool_names = {tool.name for tool in self.tools}

    def _prepare_run(
        self,
        state: DeepResearchAgentState,
        skill_runtime: SkillRuntime | None = None,
    ) -> DeepResearchRunArtifacts:
        if skill_runtime is None:
            skill_runtime = self.deepagents_runtime.skill_runtime()
        documents = state.plan_documents
        source_registry_middleware = SourceRegistryMiddleware(
            source_tool_names=self.source_tool_names,
            excluded_file_names=[doc.name for doc in documents.excluded] if documents else (),
        )
        rounds = RetrievalRounds()
        tool_set = build_deep_research_tool_set(
            self.tools,
            source_registry_middleware=source_registry_middleware,
            max_concurrent_source_tool_calls=self.max_concurrent_source_tool_calls,
            max_source_tool_batch_size=self.max_source_tool_batch_size,
        )
        middleware_set = build_deep_research_middleware_set(
            tool_set=tool_set,
            source_registry_middleware=source_registry_middleware,
            max_research_concurrency=self.max_research_concurrency,
        )
        callbacks = _run_scoped_callbacks(self.callbacks, source_registry_middleware)
        graph = build_deep_research_graph(
            llm_provider=self.llm_provider,
            state=state,
            prompts=self._prompts,
            tools=self.tools,
            runtime=self.deepagents_runtime,
            tool_set=tool_set,
            middleware_set=middleware_set,
            source_registry_middleware=source_registry_middleware,
            callbacks=callbacks,
            domain_catalog_path=self.domain_catalog_path,
            enable_source_router=self.enable_source_router,
            max_research_concurrency=self.max_research_concurrency,
            checkpointer=self.checkpointer,
            skills=skill_runtime,
            rounds=rounds,
        )
        return DeepResearchRunArtifacts(
            plan_documents=state.plan_documents,
            graph=graph,
            source_registry_middleware=source_registry_middleware,
            tool_set=tool_set,
            middleware_set=middleware_set,
            callbacks=callbacks,
            rounds=rounds,
            skill_runtime=skill_runtime,
        )

    async def _build_skill_runtime(self, state: DeepResearchAgentState) -> SkillRuntime:
        organization_id = state.organization_id or get_organization_id_from_context()
        office = await asyncio.to_thread(_resolve_skills_blocking, organization_id)
        runtime = self.deepagents_runtime.skill_runtime(office)
        emit_skills_offered(runtime)
        logger.info("Deep research resolved %d office skill(s) for the writer", len(office))
        return runtime

    def _invocation(self, callbacks: list[Any]) -> tuple[dict[str, Any] | None, dict[str, Any]]:
        config: dict[str, Any] = {"callbacks": callbacks} if callbacks else {}
        stream_kwargs: dict[str, Any] = {}
        if self.checkpointer is not None:
            config["configurable"] = {"thread_id": self.job_id}
            stream_kwargs["durability"] = "async"
        return config or None, stream_kwargs

    async def run(self, state: DeepResearchAgentState) -> DeepResearchAgentState:
        with step_scope("deep"):
            async with subagent_run(DEEP_RESEARCH_AGENT):
                return await self._run(state)

    async def _run(self, state: DeepResearchAgentState) -> DeepResearchAgentState:
        skill_runtime = await self._build_skill_runtime(state)
        artifacts = self._prepare_run(state, skill_runtime)
        _log_run_start(state)
        registry_token = None
        if get_session_registry() is None:
            registry_token = set_session_registry(artifacts.source_registry_middleware.active_registry())
        contributions_token = begin_trace_contributions()
        lane_token = begin_lane_capture()
        write_now_token = begin_write_now_record()
        try:
            config, stream_kwargs = self._invocation(artifacts.callbacks)
            outcome = await stream_with_budget(
                artifacts.graph,
                state,
                config=config,
                stream_kwargs=stream_kwargs,
                max_run_seconds=self.max_run_seconds,
            )
            if outcome.error is None:
                return self._finalize(outcome.last_state, artifacts=artifacts, cutoff_reason=None)
            reason, original = classify_cutoff(
                outcome.error, elapsed_seconds=outcome.elapsed_seconds, max_run_seconds=self.max_run_seconds
            )
            return salvage_cutoff(
                outcome.last_state,
                cutoff_reason=reason,
                elapsed_seconds=outcome.elapsed_seconds,
                source_count=len(artifacts.source_registry_middleware.active_registry().all_sources()),
                finalize=functools.partial(self._finalize, artifacts=artifacts, cutoff_reason=reason),
                original=original,
                cause=outcome.error,
            )
        finally:
            if registry_token is not None:
                reset_session_registry(registry_token)
            end_lane_capture(lane_token)
            end_write_now_record(write_now_token)
            end_trace_contributions(contributions_token)

    def _finalize(
        self,
        result: Any,
        *,
        artifacts: DeepResearchRunArtifacts,
        cutoff_reason: str | None,
    ) -> DeepResearchAgentState:
        middleware = artifacts.source_registry_middleware
        if cutoff_reason is None and write_now_honoured():
            cutoff_reason = CUTOFF_USER_REQUESTED
        report, degraded_reasons = self._extract_report(result, middleware)
        report, self_confidence, self_confidence_reason = detect_and_strip_confidence_marker(report)
        verification = self._verify(report, middleware, self_confidence)
        unread = unread_basis(artifacts.plan_documents, middleware.read_file_names(), all_added_documents())
        finalized = finalize_report(
            verification,
            self_confidence=self_confidence,
            self_confidence_reason=self_confidence_reason,
            degraded_reasons=degraded_reasons,
            cutoff_reason=cutoff_reason,
            basis_unread=[doc.name for doc in unread],
        )
        annotate_state(result, finalized, artifacts.skill_runtime)
        emit_citation_line_scores(finalized.wire_sources, writer="deep_research")
        lane_hits = [hit for hit in get_lane_captures() if not middleware.is_excluded_locator(str(hit.get("name")))]
        record_retrieval_ledger(result, artifacts.rounds.announcements, lane_hits)
        emit_final_report(artifacts.callbacks, finalized.report)
        replace_last_message_content(result, finalized.report)
        log_completion(finalized)
        return DeepResearchAgentState.model_validate(result)

    def _extract_report(self, result: Any, middleware: SourceRegistryMiddleware) -> tuple[str, list[str]]:
        report = extract_final_markdown(result)
        if report is not None:
            return report, []
        fallback = last_message_text(result)
        if fallback is None:
            if self.enable_citation_verification and not middleware.has_sources():
                raise self._empty_source_registry_error()
            raise ValueError("writer-agent did not produce a final Markdown answer")
        logger.warning(
            "writer-agent did not persist a report to /shared/output.md; "
            "falling back to the agent's last message (%d chars) instead of failing the job",
            len(fallback),
        )
        return fallback, [DEGRADED_NO_REPORT_FILE]

    def _verify(
        self,
        report: str,
        middleware: SourceRegistryMiddleware,
        self_confidence: ConfidenceLevel | None,
    ) -> Verification:
        if not self.enable_citation_verification:
            return Verification(report=report)
        if not middleware.has_sources():
            raise self._empty_source_registry_error()
        registry = middleware.active_registry()
        verification = verify_report(report, registry, middleware.get_source_entries(mode="compact"))
        record_citation_ledger(verification, registry, self_confidence)
        return verification

    def _empty_source_registry_error(self) -> EmptySourceRegistryError:
        _, available_count, unavailable = validate_tool_availability(
            self.tools,
            research_type="deep research",
            enable_logging=False,
        )
        citation_events.record_empty_registry(
            agent="deep",
            unavailable_tools=unavailable,
            available_count=available_count,
        )
        return EmptySourceRegistryError(
            "deep research",
            unavailable_tools=unavailable,
            available_count=available_count,
        )

    def _extract_final_markdown(self, result: Any) -> str | None:
        return extract_final_markdown(result)

    @staticmethod
    def _extract_last_message_text(result: Any) -> str | None:
        return last_message_text(result)
