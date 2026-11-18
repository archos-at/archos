from __future__ import annotations

import asyncio
import logging
import os

from agent.auth import Principal
from agent.auth import get_current_principal
from agent.common.job_admission import JobAdmissionError
from agent_host.auth import get_current_trace_tags

from ..registry import get_agent_config
from . import orchestrator_runs
from . import research_workflow
from .access import _make_no_auth_principal
from .access import create_job_access
from .access import derive_project_collection
from .access import job_exists
from .access import rollback_job_submission


def _build_run_agent_payload(
    *,
    configure_logging,
    log_level,
    db_url,
    config_path,
    job_id,
    input_text,
    agent_type,
    parent_trace_context,
    available_documents,
    data_sources,
    auth_token,
    collection_scope,
    project_context,
    project_memory,
    platform_lessons,
    model_overrides,
    usage_context,
    user_info,
    clarifier_result,
    memory_reflection_enabled,
    memory_reflection_llm,
    run_id,
    documents=None,
    request_envelope=None,
    knowledge_context=None,
) -> dict:
    (
        parent_span_id,
        parent_function_id,
        parent_function_name,
        parent_workflow_run_id,
        parent_workflow_trace_id,
        parent_conversation_id,
        request_trace_tags,
    ) = parent_trace_context
    return {
        "configure_logging": configure_logging,
        "log_level": log_level,
        "db_url": db_url,
        "config_file_path": config_path,
        "job_id": job_id,
        "input_text": input_text,
        "agent_config_name": get_agent_config(agent_type).config_name,
        "agent_type": agent_type,
        "parent_span_id": parent_span_id,
        "parent_function_id": parent_function_id,
        "parent_function_name": parent_function_name,
        "parent_workflow_run_id": parent_workflow_run_id,
        "parent_workflow_trace_id": parent_workflow_trace_id,
        "parent_conversation_id": parent_conversation_id,
        "request_trace_tags": request_trace_tags,
        "available_documents": available_documents,
        "data_sources": data_sources,
        "auth_token": auth_token,
        "collection_scope": collection_scope,
        "project_context": project_context,
        "project_memory": project_memory,
        "platform_lessons": platform_lessons,
        "model_overrides": model_overrides,
        "usage_context": usage_context,
        "user_info": user_info,
        "clarifier_result": clarifier_result,
        "memory_reflection_enabled": memory_reflection_enabled,
        "memory_reflection_llm": memory_reflection_llm,
        "run_id": run_id,
        "documents": documents,
        "request_envelope": request_envelope,
        "knowledge_context": knowledge_context,  # without it the run fails closed (ADR-0175)
    }


logger = logging.getLogger(__name__)


async def _enforce_job_admission(db_url: str, organization_id: str | None) -> None:
    try:
        await _enforce_queue_bound(db_url, organization_id)
    except JobAdmissionError:
        raise
    except Exception:
        logger.warning("Job admission check failed; admitting job", exc_info=True)


async def _enforce_queue_bound(db_url: str, organization_id: str | None) -> None:
    bound = orchestrator_runs.max_queued_per_org()
    if bound <= 0:
        return
    loop = asyncio.get_running_loop()
    waiting = await loop.run_in_executor(None, orchestrator_runs.waiting_for_org, db_url, organization_id)
    if waiting >= bound:
        raise JobAdmissionError(
            f"Your organization already has {waiting} research jobs waiting. "
            "Please let some of them start before adding more.",
        )


def _get_disabled_sources() -> set[str]:
    try:
        from agent.common import get_disabled_sources_from_context

        return get_disabled_sources_from_context()
    except Exception:
        logger.warning("Failed to read disabled data sources; not filtering", exc_info=True)
        return set()


def _resolve_submission_principal(owner: str) -> Principal | None:
    principal = get_current_principal()
    if principal is not None:
        return principal

    if os.environ.get("REQUIRE_AUTH", "false").lower() == "true":
        return None

    return _make_no_auth_principal(owner)


def _get_parent_trace_context() -> tuple[
    str | None,  # parent_span_id
    str | None,  # parent_function_id
    str | None,  # parent_function_name
    str | None,  # parent_workflow_run_id
    int | str | None,  # parent_workflow_trace_id
    str | None,  # parent_conversation_id
    dict[str, str],  # request_trace_tags
]:
    try:
        from nat.plugin_api import ContextState
    except ImportError:
        return (None, None, None, None, None, None, {})

    context_state = ContextState.get()

    parent_workflow_run_id = context_state.workflow_run_id.get()
    parent_workflow_trace_id = context_state.workflow_trace_id.get()
    parent_conversation_id = context_state.conversation_id.get()

    parent_span_id = None
    active_stack = context_state.active_span_id_stack.get()
    if active_stack and len(active_stack) > 1:
        parent_span_id = active_stack[1]

    parent_function_id = None
    parent_function_name = None
    active_function = context_state.active_function.get()
    if active_function and active_function.function_id != "root":
        parent_function_id = active_function.function_id
        parent_function_name = active_function.function_name

    return (
        parent_span_id,
        parent_function_id,
        parent_function_name,
        parent_workflow_run_id,
        parent_workflow_trace_id,
        parent_conversation_id,
        get_current_trace_tags(),
    )


class MissingPrincipalError(RuntimeError): ...


class DuplicateJobIdError(ValueError): ...


def _job_store_settings() -> tuple[str, str, int]:
    db_url = os.environ.get("NAT_JOB_STORE_DB_URL", "sqlite:///./data/jobs.db")

    config_path = os.environ.get("NAT_CONFIG_FILE", "")

    log_level = int(os.environ.get("NAT_FASTAPI_LOG_LEVEL", "20"))
    return db_url, config_path, log_level


def _captured_request_context(
    auth_token: str | None,
    collection_scope: list[str] | None,
    project_context: str | None,
    model_overrides: dict[str, str] | None,
) -> tuple[str | None, list[str] | None, str | None, dict[str, str] | None]:
    if auth_token is None:
        from agent.auth import get_auth_token

        auth_token = get_auth_token()

    if collection_scope is None:
        from agent.knowledge.scoping import get_collection_scope_from_context

        collection_scope = get_collection_scope_from_context()

    if project_context is None:
        from agent.project_context import get_project_context_from_context

        project_context = get_project_context_from_context()

    if model_overrides is None:
        from agent.common import get_model_overrides_from_context

        model_overrides = get_model_overrides_from_context() or None
    return auth_token, collection_scope, project_context, model_overrides


def _effective_data_sources(data_sources: list[str] | None) -> list[str] | None:
    disabled_sources = _get_disabled_sources()
    if disabled_sources:
        if data_sources is None:
            from agent.common.data_source_registry import get_all_sources

            data_sources = [source.id for source in get_all_sources()]
        data_sources = [source for source in data_sources if source.strip().lower() not in disabled_sources]
    return data_sources


def _verified_principal(principal: Principal | None, owner: str) -> Principal:
    if principal is None:
        principal = _resolve_submission_principal(owner)
    if principal is None:
        raise MissingPrincipalError("Verified current principal required for async job submission")
    return principal


async def _verify_job_id_is_new(
    job_id: str | None,
    resolved_job_id: str,
    db_url: str,
    loop: asyncio.AbstractEventLoop,
) -> bool:
    preexistence_verified = job_id is None
    if job_id is not None:
        try:
            if await loop.run_in_executor(None, job_exists, resolved_job_id, db_url):
                raise DuplicateJobIdError(f"Job ID already exists: {resolved_job_id}")
            preexistence_verified = True
        except DuplicateJobIdError:
            raise
        except Exception:
            logger.warning(
                "Failed to check whether job %s already exists; proceeding without rollback safety",
                resolved_job_id,
                exc_info=True,
            )
    return preexistence_verified


async def _discard_failed_submission(
    resolved_job_id: str,
    db_url: str,
    preexistence_verified: bool,
    loop: asyncio.AbstractEventLoop,
) -> None:
    if not preexistence_verified:
        logger.warning(
            "Skipping rollback for job %s after submission failure: pre-existence of the "
            "job ID could not be verified, and rollback must never delete a pre-existing job.",
            resolved_job_id,
        )
        return
    try:
        await loop.run_in_executor(None, rollback_job_submission, resolved_job_id, db_url)
        logger.warning(
            "Rolled back partial async job submission for %s after access persistence failure.",
            resolved_job_id,
        )
    except Exception as cleanup_error:
        logger.warning(
            "Failed to roll back partial async job submission for %s after access persistence failure: %s",
            resolved_job_id,
            cleanup_error,
        )


async def submit_agent_job(
    agent_type: str,
    input_text: str,
    owner: str,
    principal: Principal | None = None,
    job_id: str | None = None,
    expiry_seconds: int = 86400,
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
    conversation_id: str | None = None,
    run_id: str | None = None,
    documents: dict | None = None,
    priority: str | None = None,
    request_envelope: dict[str, str] | None = None,
    knowledge_context: dict | None = None,
) -> str:
    from nat.front_ends.fastapi.async_jobs.job_store import JobStore

    research_workflow.check_submittable(priority)

    get_agent_config(agent_type)
    db_url, config_path, log_level = _job_store_settings()
    auth_token, collection_scope, project_context, model_overrides = _captured_request_context(
        auth_token, collection_scope, project_context, model_overrides
    )
    data_sources = _effective_data_sources(data_sources)

    if usage_context is None:
        from agent.common.cost_tracking import capture_usage_context

        usage_context = capture_usage_context()

    principal = _verified_principal(principal, owner)
    organization_id = ((usage_context or {}).get("identity") or {}).get("organization_id")

    await _enforce_job_admission(db_url, organization_id)

    job_store = JobStore(scheduler_address="", db_url=db_url)
    resolved_job_id = job_store.ensure_job_id(job_id)
    loop = asyncio.get_running_loop()
    preexistence_verified = await _verify_job_id_is_new(job_id, resolved_job_id, db_url, loop)

    parent_trace_context = _get_parent_trace_context()
    parent_conversation_id = conversation_id or parent_trace_context[5]
    project_collection = derive_project_collection(collection_scope)

    try:
        payload = _build_run_agent_payload(
            configure_logging=True,
            log_level=log_level,
            db_url=db_url,
            config_path=config_path,
            job_id=resolved_job_id,
            input_text=input_text,
            agent_type=agent_type,
            parent_trace_context=parent_trace_context,
            available_documents=available_documents,
            data_sources=data_sources,
            auth_token=auth_token,
            collection_scope=collection_scope,
            project_context=project_context,
            project_memory=project_memory,
            platform_lessons=platform_lessons,
            model_overrides=model_overrides,
            usage_context=usage_context,
            user_info=user_info,
            clarifier_result=clarifier_result,
            memory_reflection_enabled=memory_reflection_enabled,
            memory_reflection_llm=memory_reflection_llm,
            run_id=run_id,
            documents=documents,
            request_envelope=request_envelope,
            knowledge_context=knowledge_context,
        )
        await job_store._create_job(
            config_file=config_path or None,
            job_id=resolved_job_id,
            expiry_seconds=expiry_seconds,
        )
        await loop.run_in_executor(
            None,
            create_job_access,
            resolved_job_id,
            principal,
            db_url,
            parent_conversation_id,
            project_collection,
            organization_id,
        )
        await research_workflow.start(db_url, resolved_job_id, payload, organization_id, priority)
    except Exception:
        await _discard_failed_submission(resolved_job_id, db_url, preexistence_verified, loop)
        raise

    logger.info(
        "Submitted %s job %s for owner %s (%s:%s)",
        agent_type,
        resolved_job_id,
        owner,
        principal.type,
        principal.sub,
    )
    return resolved_job_id
