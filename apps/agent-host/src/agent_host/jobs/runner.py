from __future__ import annotations

import asyncio
import base64
import contextlib
import importlib
import json
import logging
import os
import time
from collections.abc import Callable
from collections.abc import Iterator
from datetime import UTC
from datetime import datetime
from typing import Any

from starlette.datastructures import Headers

from agent.agents.deep_researcher.anatomy import ReportAnatomy
from agent.cards.generate import CardGenerationResult
from agent.cards.registry import CardRegistry
from agent.cards.registry import reset_card_registry
from agent.cards.registry import set_card_registry
from agent.common.plan_documents import PlanDocument
from agent.common.plan_documents import PlanDocuments
from agent.common.plan_documents import sanitize_plan_documents
from agent.project_context import ORGANIZATION_ID_HEADER
from agent.project_context import PROJECT_ID_HEADER
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_HEADER
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_SIG_HEADER
from agent.project_context import USER_ID_HEADER

from .conversation_output import INTERRUPTED_NOTICE
from .conversation_output import write_job_notice
from .event_store import BatchingEventStore
from .event_store import EventStore
from .outcome_notify import notify_job_outcome

logger = logging.getLogger(__name__)

_LLM_PROVIDER_ERROR_MODULES = frozenset(
    {
        "openai",
        "anthropic",
        "litellm",
        "langchain",
        "langchain_core",
        "langchain_openai",
        "langchain_anthropic",
        "langchain_nvidia_ai_endpoints",
    }
)

_NETWORK_ERROR_MODULES = frozenset({"httpx", "httpcore", "aiohttp", "requests", "urllib3"})

try:
    from langgraph.errors import GraphRecursionError as _GraphRecursionError
except ImportError:
    _GraphRecursionError = None

_WALL_CLOCK_TIMEOUT_MSG = "Die Recherche hat ihr Zeitlimit erreicht und wurde ohne vollständiges Ergebnis abgebrochen."
_GENERIC_TIMEOUT_MSG = "The job timed out while waiting on an external service."
_GRAPH_RECURSION_ERROR_MSG = "Die Recherche hat ihr Schritt-Limit erreicht, ohne ein vollständiges Ergebnis zu liefern."
_LLM_PROVIDER_ERROR_MSG = "The LLM provider returned an error while running the job."
_CONNECTION_ERROR_MSG = "A connection error occurred while running the job."
_INTERNAL_ERROR_MSG = "The job failed due to an internal error."

JOB_DEGRADED_EVENT_TYPE = "job.degraded"

_DEGRADED_EVENT_FIELDS = ("research_truncated", "truncation_reason", "degraded_reasons")

WORKER_IDENTITY_HEADERS: tuple[str, ...] = (PROJECT_ID_HEADER, ORGANIZATION_ID_HEADER, USER_ID_HEADER)

WORKER_ENVELOPE_HEADERS: tuple[str, ...] = (REQUEST_CONTEXT_ENVELOPE_HEADER, REQUEST_CONTEXT_ENVELOPE_SIG_HEADER)


def _identity_values(identity: dict) -> tuple[object, object, object]:
    return (identity.get("project_id"), identity.get("organization_id"), identity.get("user_id"))


def sanitize_job_error(exc: BaseException) -> str:
    from agent.common import RunBudgetExceededError
    from agent.common.cost_tracking import BudgetExceededError

    if isinstance(exc, (RunBudgetExceededError, BudgetExceededError)):
        return str(exc)

    root_module = (type(exc).__module__ or "").split(".")[0]
    if isinstance(exc, TimeoutError):
        if "wall-clock" in str(exc).lower():
            return _WALL_CLOCK_TIMEOUT_MSG
        return _GENERIC_TIMEOUT_MSG
    from agent.common.canned_replies import ZDR_MODEL_REFUSED_MESSAGE
    from agent.common.openrouter import is_data_policy_refusal

    if is_data_policy_refusal(exc):
        return ZDR_MODEL_REFUSED_MESSAGE
    if _GraphRecursionError is not None and isinstance(exc, _GraphRecursionError):
        return _GRAPH_RECURSION_ERROR_MSG
    if root_module in _LLM_PROVIDER_ERROR_MODULES:
        return _LLM_PROVIDER_ERROR_MSG
    if root_module in _NETWORK_ERROR_MODULES or isinstance(exc, (ConnectionError, OSError)):
        return _CONNECTION_ERROR_MSG
    return _INTERNAL_ERROR_MSG


async def _update_status_if_not_terminal(job_store: Any, job_id: str, status: Any, **kwargs: Any) -> bool:
    from sqlalchemy import update

    from nat.front_ends.fastapi.async_jobs.job_store import JobInfo
    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

    if not isinstance(status, JobStatus):
        status = JobStatus(status)
    terminal_statuses = {JobStatus.SUCCESS.value, JobStatus.FAILURE.value, JobStatus.INTERRUPTED.value}
    stmt = (
        update(JobInfo)
        .where(JobInfo.job_id == job_id, JobInfo.status.not_in(terminal_statuses))
        .values(_status_values(status, **kwargs))
    )
    async with job_store.session() as session:
        result = await session.execute(stmt)
        written = (result.rowcount or 0) > 0
    if written:
        return True
    await _explain_refused_write(job_store, job_id, status)
    return False


def _status_values(status: Any, *, error: Any = None, output_path: Any = None, output: Any = None) -> dict[str, Any]:
    from pydantic import BaseModel

    if isinstance(output, BaseModel):
        output = output.model_dump_json(round_trip=True)
    if isinstance(output, dict | list):
        output = json.dumps(output)
    return {
        "status": status.value,
        "error": error,
        "output_path": output_path,
        "output": output,
        "updated_at": datetime.now(UTC),
    }


async def _explain_refused_write(job_store: Any, job_id: str, status: Any) -> None:
    job = await job_store.get_job(job_id)
    if job is None:
        raise ValueError(f"Job {job_id} not found in job store")
    logger.info("Job %s already in terminal status %s; not overwriting with %s", job_id, job.status, status)


async def _current_job_status(job_store: Any, job_id: str) -> str | None:
    if job_store is None:
        return None
    try:
        job = await job_store.get_job(job_id)
    except Exception:
        logger.warning("Could not read current status for job %s", job_id, exc_info=True)
        return None
    if job is None:
        return None
    return getattr(job, "status", None)


async def _should_write_notice(*, job_store: Any, job_id: str, verdict: str, finalized: bool) -> bool:
    if finalized:
        return True
    status = await _current_job_status(job_store, job_id)
    if status is None or status == verdict:
        return True
    logger.info(
        "Job %s already in terminal status %s; skipping %s notice (loser writes nothing user-visible)",
        job_id,
        status,
        verdict,
    )
    return False


async def _should_notify_outcome(*, job_store: Any, job_id: str, verdict: str, finalized: bool) -> bool:
    if finalized:
        return True
    return await _current_job_status(job_store, job_id) == verdict


async def _should_emit_cancelled_event(*, job_store: Any, job_id: str, finalized: bool) -> bool:
    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

    if finalized:
        return True
    status = await _current_job_status(job_store, job_id)
    if status is None or status == JobStatus.INTERRUPTED.value:
        return True
    logger.info(
        "Job %s already in terminal status %s; skipping job.cancelled event "
        "(a late abort must not rewrite the standing verdict)",
        job_id,
        status,
    )
    return False


def _emit_lifecycle_event(*, db_url: str, event_store: Any | None, job_id: str, event: dict[str, Any]) -> Any:
    if event_store is None:
        event_store = BatchingEventStore(EventStore(db_url, job_id))
    event_store.store(event)
    if hasattr(event_store, "flush"):
        event_store.flush()
    return event_store


async def _finalize_cancelled_run(
    *,
    job_store: Any,
    db_url: str,
    job_id: str,
    parent_conversation_id: str | None,
    usage_context: dict | None,
    event_store: Any | None,
    expect_run: bool = False,
) -> Any:
    logger.info("Job %s cancelled", job_id)
    finalized = await _mark_interrupted(job_store, job_id)
    await _publish_interrupted(
        job_store=job_store,
        job_id=job_id,
        finalized=finalized,
        parent_conversation_id=parent_conversation_id,
        usage_context=usage_context,
        expect_run=expect_run,
    )
    if await _should_emit_cancelled_event(job_store=job_store, job_id=job_id, finalized=finalized):
        cancelled = {"type": "job.cancelled", "data": {"reason": "cancelled by user"}}
        event_store = _emit_lifecycle_event(db_url=db_url, event_store=event_store, job_id=job_id, event=cancelled)
    return event_store


async def _mark_interrupted(job_store: Any, job_id: str) -> bool:
    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

    if not job_store:
        return False
    try:
        return await _update_status_if_not_terminal(job_store, job_id, JobStatus.INTERRUPTED, error="cancelled by user")
    except ConnectionError, TimeoutError, RuntimeError:
        return False


async def _publish_interrupted(
    *,
    job_store: Any,
    job_id: str,
    finalized: bool,
    parent_conversation_id: str | None,
    usage_context: dict | None,
    expect_run: bool,
) -> None:
    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

    if await _should_write_notice(
        job_store=job_store,
        job_id=job_id,
        verdict=JobStatus.INTERRUPTED.value,
        finalized=finalized,
    ):
        await write_job_notice(
            conversation_id=parent_conversation_id,
            job_id=job_id,
            usage_context=usage_context,
            notice=INTERRUPTED_NOTICE,
            expect_run=expect_run,
        )
    if await _should_notify_outcome(
        job_store=job_store,
        job_id=job_id,
        verdict=JobStatus.INTERRUPTED.value,
        finalized=finalized,
    ):
        await notify_job_outcome(
            job_id=job_id, usage_context=usage_context, status="interrupted", expect_run=expect_run
        )


def _normalize_trace_id(trace_id: int | str | None) -> int | None:
    if trace_id is None:
        return None
    if isinstance(trace_id, int):
        return trace_id
    try:
        return int(trace_id, 16)
    except ValueError:
        return int(trace_id)


WRITE_NOW_EVENT_TYPE = "job.write_now_requested"
DOCUMENT_ADDED_EVENT_TYPE = "job.document_added"
CONTROL_EVENT_TYPES = (WRITE_NOW_EVENT_TYPE, DOCUMENT_ADDED_EVENT_TYPE)


class CancellationMonitor:
    def __init__(
        self,
        db_url: str,
        job_id: str,
        poll_interval: float = 1.0,
    ):
        self.db_url = db_url
        self.job_id = job_id
        self.poll_interval = poll_interval
        self._cancelled = asyncio.Event()
        self.write_now = asyncio.Event()
        self.added_documents: list[PlanDocument] = []
        self.on_document_added: Callable[[PlanDocument], None] | None = None
        self._last_event_id = 0
        self._monitor_task: asyncio.Task | None = None

    @property
    def is_cancelled(self) -> bool:
        return self._cancelled.is_set()

    async def _poll_job_status(self) -> None:
        from nat.front_ends.fastapi.async_jobs.job_store import JobStatus
        from nat.front_ends.fastapi.async_jobs.job_store import JobStore

        job_store = JobStore(scheduler_address="", db_url=self.db_url)

        stop_statuses = (JobStatus.INTERRUPTED.value, JobStatus.FAILURE.value)

        while not self._cancelled.is_set():
            try:
                job = await job_store.get_job(self.job_id)
                if job and job.status in stop_statuses:
                    logger.info("Cancellation detected for job %s (status: %s)", self.job_id, job.status)
                    self._cancelled.set()
                    break
                events = await EventStore.get_events_async(
                    self.db_url, self.job_id, after_id=self._last_event_id, event_types=CONTROL_EVENT_TYPES
                )
                self._note_control_events(events)
            except Exception as e:
                logger.warning("Error checking job status for %s: %s", self.job_id, e)

            await asyncio.sleep(self.poll_interval)

    def _note_control_events(self, events: list[dict]) -> None:
        for event in events:
            event_id = event.get("_id")
            if isinstance(event_id, int) and event_id > self._last_event_id:
                self._last_event_id = event_id
            if event.get("type") == WRITE_NOW_EVENT_TYPE:
                logger.info("Write-now requested for job %s", self.job_id)
                self.write_now.set()
            elif event.get("type") == DOCUMENT_ADDED_EVENT_TYPE:
                self._note_added_document(event.get("data"))

    def _note_added_document(self, data: Any) -> None:
        docs = sanitize_plan_documents({"basis": [data]}) if isinstance(data, dict) else None
        if docs is None:
            return
        doc = docs.basis[0]
        if any(d.name.casefold() == doc.name.casefold() for d in self.added_documents):
            return
        logger.info("Document added to the Grundlage of job %s: %s", self.job_id, doc.name)
        self.added_documents.append(doc)
        if self.on_document_added is not None:
            self.on_document_added(doc)

    def start(self) -> None:
        if self._monitor_task is None:
            self._monitor_task = asyncio.create_task(self._poll_job_status())
            logger.debug("Started cancellation monitor for job %s", self.job_id)

    def stop(self) -> None:
        if self._monitor_task and not self._monitor_task.done():
            self._monitor_task.cancel()
            self._monitor_task = None
            logger.debug("Stopped cancellation monitor for job %s", self.job_id)

    def check(self) -> None:
        if self._cancelled.is_set():
            raise asyncio.CancelledError("Job cancelled by user")


HEARTBEAT_INTERVAL_SECONDS = 30


async def run_with_cancellation(
    coro,
    monitor: CancellationMonitor,
    event_store: EventStore | BatchingEventStore | None = None,
) -> Any:
    task = asyncio.create_task(coro)
    monitor.start()
    start_time = time.monotonic()
    last_heartbeat = start_time

    try:
        while not task.done():
            if monitor.is_cancelled:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                raise asyncio.CancelledError("Job cancelled by user")

            now = time.monotonic()
            if event_store and (now - last_heartbeat) >= HEARTBEAT_INTERVAL_SECONDS:
                last_heartbeat = now
                event_store.store(
                    {
                        "type": "job.heartbeat",
                        "data": {"uptime_seconds": int(now - start_time)},
                    }
                )

            await asyncio.sleep(0.1)

        return task.result()
    finally:
        monitor.stop()


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


def _purge_deep_checkpoint(job_id: str) -> None:
    dsn = os.environ.get("DEEP_CHECKPOINT_DB")
    if not dsn:
        return
    try:
        from sqlalchemy import text

        from .event_store import EventStore

        engine = EventStore._get_or_create_sync_engine(dsn)
        with engine.connect() as conn:
            for table in ("checkpoint_writes", "checkpoint_blobs", "checkpoints"):
                conn.execute(
                    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                    text(f"DELETE FROM {table} WHERE thread_id = :tid"),  # noqa: S608
                    {"tid": job_id},
                )
            conn.commit()
    except Exception:
        logger.debug("Deep checkpoint purge skipped for job %s", job_id, exc_info=True)


def _load_agent_class(agent_class_path: str) -> type:
    module_path, class_name = agent_class_path.rsplit(".", 1)
    module = importlib.import_module(module_path)
    return getattr(module, class_name)


_CHAT_MODEL_AGENT_TYPES = frozenset({"research_agent", "project_intake_agent"})

_BUDGET_GUARDED_AGENT_TYPES = frozenset({"deep_research_agent", "project_intake_agent"})

_JOB_PROFILE_NAMES = {"project_intake_agent": "project_intake_job"}


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
            if llm_ref not in llm_cache:
                llm_cache[llm_ref] = await get_langchain_llm(builder, llm_ref)
            role_llms[role] = llm_cache[llm_ref]
            role_groups[role] = group

    default_group = AgentGroup.DEEP_RESEARCH
    default_llm = role_llms.get(LLMRole.ORCHESTRATOR)
    if default_llm is None:
        llm_ref = getattr(fn_config, "llm", None)
        if llm_ref:
            if llm_ref not in llm_cache:
                llm_cache[llm_ref] = await get_langchain_llm(builder, llm_ref)
            default_llm = llm_cache[llm_ref]
            if getattr(fn_config, "type", None) in _CHAT_MODEL_AGENT_TYPES:
                default_group = AgentGroup.RESEARCH

    provider = LLMProvider()
    provider.set_default(default_llm, group=default_group)
    for role, llm in role_llms.items():
        provider.configure(role, llm, group=role_groups.get(role))

    return provider, default_llm


def _b64url_encode_text(value: str) -> str:
    return base64.urlsafe_b64encode(value.encode()).rstrip(b"=").decode()


def _inject_worker_headers(context_state: Any, headers: dict[str, str]) -> None:
    request_attrs = context_state.metadata.get()
    existing = dict(request_attrs.headers) if request_attrs and request_attrs.headers else {}
    request_attrs._request.headers = Headers(headers={**existing, **headers})
    context_state.metadata.set(request_attrs)


def _run_user_info(user_info: dict | None, envelope_headers: dict[str, str] | None) -> dict | None:
    if user_info is not None or not envelope_headers:
        return user_info
    from agent.project_context import RequestContext
    from agent.turn.context import user_info_for

    request = RequestContext.from_headers(envelope_headers, secret=os.environ.get("INTERNAL_API_TOKEN"))
    return user_info_for(request)


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


async def _run_agent(
    agent,
    input_text: str,
    monitor: CancellationMonitor,
    available_documents: list[dict] | None = None,
    data_sources: list[str] | None = None,
    event_store: EventStore | None = None,
    user_info: dict | None = None,
    clarifier_result: str | None = None,
    plan_documents: PlanDocuments | None = None,
    project_context: str | None = None,
    platform_lessons: str | None = None,
    organization_id: str | None = None,
) -> Any:
    import inspect

    if not hasattr(agent, "run"):
        raise TypeError(f"Agent {type(agent).__name__} does not have a run method")
    params = list(inspect.signature(agent.run).parameters)
    if params and params[0] in ("input_text", "query", "input"):
        return await run_with_cancellation(agent.run(input_text), monitor, event_store=event_store)
    fields = {
        "user_info": user_info,
        "clarifier_result": clarifier_result,
        "plan_documents": plan_documents,
        "project_context": project_context,
        "platform_lessons": platform_lessons,
        "organization_id": organization_id,
    }
    state_cls = _get_agent_state_class(agent)
    if state_cls:
        state = _model_state(state_cls, input_text, data_sources, available_documents, fields)
    else:
        state = _dict_state(input_text, data_sources, available_documents, fields)
    return await _run_with_reader_controls(agent, state, monitor, event_store)


def _model_state(state_cls: type, input_text: str, data_sources, available_documents, fields: dict) -> Any:
    from langchain_core.messages import HumanMessage

    state_kwargs: dict[str, Any] = {"messages": [HumanMessage(content=input_text)]}
    if data_sources is not None:
        state_kwargs["data_sources"] = data_sources
    declared = getattr(state_cls, "model_fields", {})
    state_kwargs.update({name: value for name, value in fields.items() if value is not None and name in declared})
    if available_documents:
        try:
            from agent.knowledge import AvailableDocument

            state_kwargs["available_documents"] = [AvailableDocument(**doc) for doc in available_documents]
            logger.debug("Research worker passing %d available documents to agent state", len(available_documents))
        except ImportError, TypeError:
            pass
    return state_cls(**state_kwargs)


def _dict_state(input_text: str, data_sources, available_documents, fields: dict) -> dict[str, Any]:
    from langchain_core.messages import HumanMessage

    state: dict[str, Any] = {"messages": [HumanMessage(content=input_text)]}
    if data_sources is not None:
        state["data_sources"] = data_sources
    if available_documents:
        state["available_documents"] = available_documents
    for name in ("user_info", "clarifier_result", "project_context", "platform_lessons"):
        if fields[name] is not None:
            state[name] = fields[name]
    return state


async def _run_with_reader_controls(agent, state: Any, monitor: CancellationMonitor, event_store) -> Any:
    from agent.agents.deep_researcher.control import bind_added_documents
    from agent.agents.deep_researcher.control import bind_write_now
    from agent.agents.deep_researcher.control import reset_added_documents
    from agent.agents.deep_researcher.control import reset_write_now

    token = bind_write_now(monitor.write_now)
    added_token = bind_added_documents(monitor.added_documents)
    try:
        return await run_with_cancellation(agent.run(state), monitor, event_store=event_store)
    finally:
        reset_added_documents(added_token)
        reset_write_now(token)


def _get_agent_state_class(agent) -> type | None:
    declared = getattr(type(agent), "state_model", None)
    if isinstance(declared, type):
        return declared

    agent_module = type(agent).__module__
    agent_name = type(agent).__name__

    state_name_patterns = [
        "AgentState",
        f"{agent_name}State",
        f"{agent_name.replace('Agent', '')}AgentState",  # DeepResearcher -> DeepResearcherAgentState
        f"{agent_name.replace('erAgent', '')}AgentState",  # DeepResearcherAgent -> DeepResearchAgentState
        "State",
    ]

    try:
        models_module = importlib.import_module(agent_module.replace(".agent", ".models"))
        for state_name in state_name_patterns:
            if hasattr(models_module, state_name):
                return getattr(models_module, state_name)

        for name in dir(models_module):
            if name.endswith("State") and not name.startswith("_"):
                cls = getattr(models_module, name)
                if isinstance(cls, type) and hasattr(cls, "model_fields"):
                    if "messages" in cls.model_fields:
                        return cls
    except ImportError, AttributeError:
        pass

    try:
        module = importlib.import_module(agent_module)
        for state_name in state_name_patterns:
            if hasattr(module, state_name):
                return getattr(module, state_name)
    except ImportError:
        pass

    return None


@contextlib.contextmanager
def _bound_card_registry() -> Iterator[CardRegistry]:
    registry = CardRegistry()
    token = set_card_registry(registry)
    try:
        yield registry
    finally:
        reset_card_registry(token)


def _merge_job_cards(emitted: list[dict[str, Any]], generated: list[Any] | None) -> list[Any] | None:
    merged = [*emitted, *(generated or [])]
    return merged or None


def _produces_report(agent_cls: type) -> bool:
    return bool(getattr(agent_cls, "produces_report", True))


async def _run_report_passes(
    *,
    produces_report: bool,
    llm: Any,
    input_text: str,
    report: str,
    organization_id: str | None,
    **reflection_kwargs: Any,
) -> tuple[CardGenerationResult, ReportAnatomy, dict[str, Any] | None]:
    if not produces_report:
        return CardGenerationResult(cards=None), ReportAnatomy(), None
    cards_result, anatomy, follow_ups = await asyncio.gather(
        _generate_answer_cards(llm, input_text, report),
        _extract_report_anatomy(llm, input_text, report),
        _propose_report_follow_ups(llm, query=input_text, report=report, organization_id=organization_id),
    )
    await _run_deep_research_reflection(
        query=input_text, report=_reflection_text(report, anatomy.findings), **reflection_kwargs
    )
    return cards_result, anatomy, follow_ups


def _reflection_text(report: str, findings: dict[str, Any] | None) -> str:
    items = (findings or {}).get("items") if isinstance(findings, dict) else None
    if not isinstance(items, list) or not items:
        return report
    lines = []
    for item in items:
        if not isinstance(item, dict) or not item.get("requirement"):
            continue
        value = f" — {item['value']}" if item.get("value") else ""
        comment = f" ({item['comment']})" if item.get("comment") and item.get("status") in ("open", "not_met") else ""
        status = f" — {item['status']}" if item.get("status") else ""
        lines.append(f"- {item['requirement']}{value}{status}{comment}")
    return f"{report.rstrip()}\n\n## Befunde\n" + "\n".join(lines) if lines else report


async def _extract_report_anatomy(llm: Any, query: str, report: str) -> ReportAnatomy:
    try:
        from agent.agents.deep_researcher.anatomy import extract_report_anatomy

        anatomy = await extract_report_anatomy(llm, query, report)
        if anatomy.findings:
            logger.info("Extracted %d finding(s) from the deep-research report", len(anatomy.findings["items"]))
        return anatomy
    except Exception as e:  # noqa: BLE001 — additive; the report is already whole
        logger.warning("Report anatomy extraction failed (non-fatal): %s", e)
        return ReportAnatomy(failed=True)


async def _propose_report_follow_ups(
    llm: Any, *, query: str, report: str, organization_id: str | None
) -> dict[str, Any] | None:
    try:
        from agent.stages import StageContext
        from agent.stages import TurnFacts
        from agent.stages.flags import resolve_enabled_stages
        from agent.stages.follow_ups import FOLLOW_UPS

        enabled = await resolve_enabled_stages(organization_id=organization_id, memory_reflection_enabled=False)
        if FOLLOW_UPS.id not in enabled:
            return None
        facts = TurnFacts(query=query, answer=report, organization_id=organization_id)
        payload = await asyncio.wait_for(FOLLOW_UPS.handler(StageContext(facts=facts, llm=llm)), FOLLOW_UPS.timeout_s)
        return payload if isinstance(payload, dict) and payload.get("items") else None
    except Exception as e:  # noqa: BLE001 — additive; the report is already whole
        logger.warning("Report follow-ups failed (non-fatal): %s", e)
        return None


async def _generate_answer_cards(llm: Any, query: str, report: str) -> CardGenerationResult:
    try:
        from agent.cards.generate import generate_cards_result

        result = await generate_cards_result(llm, query, report)
        if result.cards:
            logger.info("Generated %d Grid card(s) for deep-research report", len(result.cards))
        return result
    except Exception as e:
        logger.warning("Grid card generation failed (non-fatal): %s", e)
        return CardGenerationResult(cards=None, failed=True)


async def _run_deep_research_reflection(
    *,
    builder: Any,
    job_id: str,
    reflection_llm_ref: str | None,
    reflection_enabled: bool,
    query: str,
    report: str,
    usage_context: dict | None,
    memory_digest: str | None,
    org_credential: Any,
    model_overrides: dict[str, str] | None,
    zdr_only: bool = True,
) -> None:
    if not reflection_enabled or not reflection_llm_ref or not report:
        return
    identity = _reflection_identity(usage_context)
    if identity is None:
        return
    from agent.stages.memory_reflection import REFLECTION_TIMEOUT_S

    try:
        reflection_llm = await _reflection_llm(builder, reflection_llm_ref, org_credential, model_overrides, zdr_only)
        await asyncio.wait_for(
            _reflect(reflection_llm, identity, job_id=job_id, query=query, report=report, memory_digest=memory_digest),
            timeout=REFLECTION_TIMEOUT_S,
        )
    except TimeoutError:
        logger.warning(
            "Job %s: deep-research memory reflection timed out after %ss (non-fatal)", job_id, REFLECTION_TIMEOUT_S
        )
    except Exception:
        logger.warning("Job %s: deep-research memory reflection failed (non-fatal)", job_id, exc_info=True)


def _reflection_identity(usage_context: dict | None) -> dict | None:
    identity = (usage_context or {}).get("identity") or {}
    return identity if identity.get("project_id") else None


async def _reflect(
    llm: Any, identity: dict, *, job_id: str, query: str, report: str, memory_digest: str | None
) -> None:
    from agent.common.cost_tracking import BudgetSnapshot
    from agent.common.cost_tracking import track_llm_costs
    from agent.common.profiler import track_agent_profile
    from agent.memory.reflection import run_memory_reflection

    with (
        track_agent_profile(agent_name="project_memory_reflection", job_id=job_id, identity=identity),
        track_llm_costs(job_id=job_id, identity=identity, budget=BudgetSnapshot()),
    ):
        await run_memory_reflection(
            llm=llm,
            query=query,
            answer=report,
            project_id=identity["project_id"],
            organization_id=identity.get("organization_id"),
            conversation_id=identity.get("conversation_id"),
            memory_digest=memory_digest,
        )


async def _reflection_llm(
    builder: Any, llm_ref: str, org_credential: Any, model_overrides: dict[str, str] | None, zdr_only: bool
) -> Any:
    from agent.common import AgentGroup
    from agent.common import apply_model_override
    from agent.common import apply_org_credential
    from agent.common import get_langchain_llm
    from agent.common import sanitize_model_overrides

    llm = await get_langchain_llm(builder, llm_ref)
    overrides = sanitize_model_overrides(model_overrides) if model_overrides else {}
    return apply_model_override(
        apply_org_credential(llm, org_credential), AgentGroup.MEMORY_REFLECTION, overrides, zdr_only=zdr_only
    )
