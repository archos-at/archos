from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from dataclasses import field
from typing import Any

from agent.common.plan_documents import PlanDocuments
from agent.common.plan_documents import sanitize_plan_documents
from agent.common.provider_limiter import RESEARCH
from agent.common.provider_limiter import with_provider_class
from agent.observability import boot_timing
from agent.observability.boot_timing import BootClock

from .agent_construction import _BUDGET_GUARDED_AGENT_TYPES
from .agent_construction import _JOB_PROFILE_NAMES
from .agent_construction import _create_agent_instance
from .agent_construction import _load_agent_class
from .agent_construction import _resolve_deep_research_checkpointer
from .agent_job_setup import RunContext
from .agent_job_setup import bind_request
from .agent_job_setup import prepare_models
from .agent_job_setup import prepare_tools
from .agent_job_setup import trace_metadata
from .agent_run import _run_agent
from .callbacks import AgentEventCallback
from .event_store import BatchingEventStore
from .event_store import EventStore
from .job_cancellation import CancellationMonitor
from .job_outcome import JobOutcome
from .job_outcome import finish
from .job_outcome import finish_failed
from .job_outcome import persist
from .job_status import _current_job_status
from .job_status import _finalize_cancelled_run
from .job_status import _update_status_if_not_terminal
from .phase_events import PhaseProgressCallback
from .report_passes import _bound_card_registry
from .run_ledger_fold import RunLedgerFold
from .runner import _purge_deep_checkpoint

logger = logging.getLogger(__name__)

_PROCESS_KNOBS = frozenset({"configure_logging", "log_level"})


@dataclass(frozen=True)
class JobRequest:
    db_url: str
    config_file_path: str
    job_id: str
    input_text: str
    agent_class_path: str
    agent_config_name: str
    parent_span_id: str | None = None
    parent_function_id: str | None = None
    parent_function_name: str | None = None
    parent_workflow_run_id: str | None = None
    parent_workflow_trace_id: int | str | None = None
    parent_conversation_id: str | None = None
    request_trace_tags: dict[str, str] | None = None
    available_documents: list[dict] | None = None
    data_sources: list[str] | None = None
    auth_token: str | None = None
    collection_scope: list[str] | None = None
    project_context: str | None = None
    project_memory: str | None = None
    platform_lessons: str | None = None
    model_overrides: dict[str, str] | None = None
    usage_context: dict | None = None
    user_info: dict | None = None
    clarifier_result: str | None = None
    memory_reflection_enabled: bool = False
    memory_reflection_llm: str | None = None
    run_id: str | None = None
    documents: dict | None = None
    request_envelope: dict | None = None
    knowledge_context: dict | None = None

    @property
    def identity(self) -> dict:
        return (self.usage_context or {}).get("identity") or {}

    @property
    def organization_id(self) -> str | None:
        return self.identity.get("organization_id")

    @property
    def expect_run(self) -> bool:
        return self.run_id is not None


@dataclass
class JobScope:
    job_store: Any = None
    monitor: CancellationMonitor | None = None
    event_store: Any = None
    ledger: RunLedgerFold | None = None
    auth_token_reset: Any = None
    plan_documents: PlanDocuments | None = None
    agent_event_callback: AgentEventCallback | None = None
    card_snapshot: list[dict[str, Any]] = field(default_factory=list)


@with_provider_class(RESEARCH)
async def run_agent_job(
    configure_logging: bool,
    log_level: int,
    db_url: str,
    config_file_path: str,
    job_id: str,
    input_text: str,
    agent_class_path: str,
    agent_config_name: str,
    parent_span_id: str | None = None,
    parent_function_id: str | None = None,
    parent_function_name: str | None = None,
    parent_workflow_run_id: str | None = None,
    parent_workflow_trace_id: int | str | None = None,
    parent_conversation_id: str | None = None,
    request_trace_tags: dict[str, str] | None = None,
    available_documents: list[dict] | None = None,
    data_sources: list[str] | None = None,
    auth_token: str | None = None,
    collection_scope: list[str] | None = None,
    project_context: str | None = None,
    project_memory: str | None = None,
    platform_lessons: str | None = None,
    model_overrides: dict[str, str] | None = None,
    usage_context: dict | None = None,
    user_info: dict | None = None,
    clarifier_result: str | None = None,
    memory_reflection_enabled: bool = False,
    memory_reflection_llm: str | None = None,
    run_id: str | None = None,
    documents: dict | None = None,
    request_envelope: dict | None = None,
    knowledge_context: dict | None = None,
):
    request = JobRequest(**{name: value for name, value in locals().items() if name not in _PROCESS_KNOBS})
    scope = JobScope()
    _prepare_process(scope, request, configure_logging, log_level)
    try:
        await _execute(scope, request)
    except asyncio.CancelledError:
        await _finish_cancelled(scope, request)
    except Exception as exc:
        await finish_failed(scope, request, exc)
    finally:
        await _release(scope, request)
        await asyncio.to_thread(_purge_deep_checkpoint, request.job_id)


class RunStoppedError(TimeoutError):
    def __init__(self) -> None:
        super().__init__("wall-clock: the research run exceeded its execution timeout")


async def _cancelled_by_a_person(scope: JobScope, request: JobRequest) -> bool:
    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus
    from nat.front_ends.fastapi.async_jobs.job_store import JobStore

    store = scope.job_store or JobStore(scheduler_address="", db_url=request.db_url)
    return await _current_job_status(store, request.job_id) == JobStatus.INTERRUPTED.value


async def _finish_cancelled(scope: JobScope, request: JobRequest) -> None:
    if not await _cancelled_by_a_person(scope, request):
        await finish_failed(scope, request, RunStoppedError())
        return
    scope.event_store = await _finalize_cancelled_run(
        job_store=scope.job_store,
        db_url=request.db_url,
        job_id=request.job_id,
        parent_conversation_id=request.parent_conversation_id,
        usage_context=request.usage_context,
        event_store=scope.event_store,
        expect_run=request.expect_run,
    )


def _prepare_process(scope: JobScope, request: JobRequest, configure_logging: bool, log_level: int) -> None:
    if request.auth_token:
        from ._auth_context import job_auth_token

        scope.auth_token_reset = job_auth_token.set(request.auth_token)

    from agent.common.logging_utils import suppress_noisy_dependency_logs
    from agent.common.nat_step_repair import install_step_stack_repair
    from agent_host.auth.request_trace import install_request_trace_span_injection

    install_request_trace_span_injection()
    if configure_logging:
        try:
            from nat.utils.log_utils import setup_logging

            setup_logging(log_level)
        except ImportError:
            logging.basicConfig(level=log_level)
    suppress_noisy_dependency_logs()
    install_step_stack_repair()
    logger.info(
        "Research worker received: agent=%s, config=%s, job_id=%s",
        request.agent_class_path,
        request.agent_config_name,
        request.job_id,
    )


async def _execute(scope: JobScope, request: JobRequest) -> None:
    if not await _claim(scope, request):
        logger.info("Job %s already terminal before start; aborting run", request.job_id)
        return
    from agent.observability import ensure_registered as register_telemetry
    from agent_host.auth.request_trace import request_trace_tag_context
    from nat.builder.workflow_builder import WorkflowBuilder
    from nat.observability.exporter_manager import ExporterManager
    from nat.runtime.loader import load_config

    register_telemetry()
    clock = BootClock("research-job")  # paid by every job, not once per process
    with clock.phase("load_config"):
        config = load_config(request.config_file_path)
    agent_cls = _load_agent_class(request.agent_class_path)

    building = time.monotonic()
    async with WorkflowBuilder.from_config(config=config) as builder:
        clock.record("workflow_build", time.monotonic() - building)
        boot_timing.flush()
        models = await prepare_models(builder, request)
        tools = await prepare_tools(builder, models.fn_config, request.data_sources)
        run = await bind_request(request, models.fn_config)
        exporters = {name: configured.instance for name, configured in builder._telemetry_exporters.items()}
        with request_trace_tag_context(request.request_trace_tags or {}):
            async with ExporterManager.from_exporters(exporters).start(context_state=run.state):
                result = await _run(scope, request, run, agent_cls=agent_cls, models=models, tools=tools)
                outcome: JobOutcome = await persist(
                    scope, request, run, result, agent_cls=agent_cls, models=models, builder=builder, config=config
                )
                await finish(scope, request, outcome)


async def _claim(scope: JobScope, request: JobRequest) -> bool:
    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus
    from nat.front_ends.fastapi.async_jobs.job_store import JobStore

    scope.job_store = JobStore(scheduler_address="", db_url=request.db_url)
    if not await _update_status_if_not_terminal(scope.job_store, request.job_id, JobStatus.RUNNING):
        return False
    scope.monitor = CancellationMonitor(db_url=request.db_url, job_id=request.job_id, poll_interval=1.0)
    scope.plan_documents = sanitize_plan_documents(request.documents)
    return True


async def _run(scope: JobScope, request: JobRequest, run: RunContext, *, agent_cls: type, models, tools) -> Any:
    from agent.common.cost_tracking import BudgetSnapshot
    from agent.common.cost_tracking import track_llm_costs
    from agent.common.profiler import track_agent_profile

    workflow_metadata, parent_metadata = trace_metadata(request, run)
    run.open_spans(request, workflow_metadata, parent_metadata)
    callbacks, verbose = _callbacks(scope, request, models.fn_config)
    agent = _create_agent_instance(
        agent_cls=agent_cls,
        llm_provider=models.provider,
        llm=models.llm,
        tools=tools,
        fn_config=models.fn_config,
        verbose=verbose,
        callbacks=callbacks,
        job_id=request.job_id,
        checkpointer=await _resolve_deep_research_checkpointer(models.fn_config),
    )
    usage = request.usage_context or {}
    budget = BudgetSnapshot.from_header(usage.get("budget_header")) or BudgetSnapshot()
    with (
        track_agent_profile(
            agent_name=_JOB_PROFILE_NAMES.get(getattr(models.fn_config, "type", None), "deep_research_job"),
            job_id=request.job_id,
            identity=request.identity,
        ),
        track_llm_costs(
            job_id=request.job_id,
            identity=request.identity,
            budget=budget,
            activity=budget.activity,
        ),
        _bound_card_registry() as card_registry,
    ):
        result = await _run_agent(
            agent=agent,
            input_text=request.input_text,
            monitor=scope.monitor,
            available_documents=request.available_documents,
            data_sources=request.data_sources,
            event_store=scope.event_store,
            user_info=run.user_info,
            clarifier_result=request.clarifier_result,
            plan_documents=scope.plan_documents,
            project_context=run.project_context,
            platform_lessons=request.platform_lessons,
            organization_id=request.organization_id,
        )
    scope.card_snapshot = card_registry.snapshot()
    run.close_spans(request, result, workflow_metadata, parent_metadata)
    return result


def _callbacks(scope: JobScope, request: JobRequest, fn_config: Any) -> tuple[list[Any], bool]:
    from agent.common import VerboseTraceCallback
    from agent.common import is_verbose
    from agent.common.nat_step_repair import SpanClosingProfilerHandler

    verbose = is_verbose(getattr(fn_config, "verbose", False))
    callbacks: list[Any] = [VerboseTraceCallback()] if verbose else []
    event_store = BatchingEventStore(EventStore(request.db_url, request.job_id))
    plan_documents = scope.plan_documents
    scope.ledger = RunLedgerFold(
        job_id=request.job_id,
        run_id=request.run_id,
        event_store=event_store,
        basis=[doc.model_dump() for doc in plan_documents.basis] if plan_documents else None,
    )
    scope.monitor.on_document_added = scope.ledger.add_basis
    scope.event_store = scope.ledger.observing(event_store)
    scope.agent_event_callback = AgentEventCallback(scope.event_store)
    callbacks += [scope.agent_event_callback, SpanClosingProfilerHandler()]
    fn_type = getattr(fn_config, "type", None)
    if fn_type == "deep_research_agent":
        max_concurrency = getattr(fn_config, "max_research_concurrency", None)
        callbacks.append(PhaseProgressCallback(scope.event_store, max_research_concurrency=max_concurrency))
    if fn_type in _BUDGET_GUARDED_AGENT_TYPES:
        from agent.common import create_budget_guard_callback

        budget_guard = create_budget_guard_callback()
        if budget_guard is not None:
            callbacks.append(budget_guard)
    return callbacks, verbose


async def _release(scope: JobScope, request: JobRequest) -> None:
    if scope.ledger is not None:
        await scope.ledger.close()
    if scope.event_store is not None and hasattr(scope.event_store, "flush"):
        scope.event_store.flush()
    if scope.monitor:
        scope.monitor.stop()
    if scope.auth_token_reset is not None:
        from ._auth_context import job_auth_token

        job_auth_token.reset(scope.auth_token_reset)
    AgentEventCallback.cleanup_job_urls(request.job_id)
