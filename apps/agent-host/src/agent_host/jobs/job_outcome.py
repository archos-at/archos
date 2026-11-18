from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING
from typing import Any

from agent.common.turn_notices import DEGRADED_CARDS_GENERATION_FAILED
from agent.observability.turn_trace import current_trace_id_hex

from .conversation_output import FAILURE_NOTICE
from .conversation_output import write_job_notice
from .conversation_output import write_job_turn
from .event_store import BatchingEventStore
from .event_store import EventStore
from .outcome_notify import notify_job_outcome
from .phase_events import PHASE_DONE
from .phase_events import emit_phase_event
from .run_result import TEMPORARY_CONVERSATION_SKIP
from .run_result import build_job_output
from .run_result import extract_answer_transparency
from .run_result import extract_result
from .run_result import extract_skills_activated
from .run_result import extract_verified_sources
from .run_result import is_temporary_conversation
from .run_result import mark_degraded
from .runner import _DEGRADED_EVENT_FIELDS
from .runner import JOB_DEGRADED_EVENT_TYPE
from .runner import _merge_job_cards
from .runner import _produces_report
from .runner import _run_report_passes
from .runner import _should_notify_outcome
from .runner import _should_write_notice
from .runner import _update_status_if_not_terminal
from .runner import _workflow_reflection_llm_ref
from .runner import sanitize_job_error

if TYPE_CHECKING:
    from .agent_job import JobRequest
    from .agent_job import JobScope
    from .agent_job_setup import JobModels
    from .agent_job_setup import RunContext

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class JobOutcome:
    report: str
    cards: list[Any] | None
    transparency: dict[str, Any]
    sources: list[dict[str, Any]] | None
    skills_activated: list[str] | None
    output: Any


def reflection_enabled(request: JobRequest) -> bool:
    if not request.memory_reflection_enabled:
        return False
    if is_temporary_conversation(request.usage_context):
        logger.info("Job %s: memory reflection skipped: %s", request.job_id, TEMPORARY_CONVERSATION_SKIP)
        return False
    return True


async def persist(
    scope: JobScope,
    request: JobRequest,
    run: RunContext,
    result: Any,
    *,
    agent_cls: type,
    models: JobModels,
    builder: Any,
    config: Any,
) -> JobOutcome:
    report = extract_result(result)
    cards_result, anatomy, follow_ups = await _run_report_passes(
        produces_report=_produces_report(agent_cls),
        llm=models.llm,
        input_text=request.input_text,
        report=report,
        organization_id=request.organization_id,
        builder=builder,
        job_id=request.job_id,
        reflection_llm_ref=request.memory_reflection_llm or _workflow_reflection_llm_ref(config),
        reflection_enabled=reflection_enabled(request),
        usage_context=request.usage_context,
        memory_digest=run.memory_digest,
        org_credential=models.org_credential,
        model_overrides=request.model_overrides,
        zdr_only=models.zdr,
    )
    cards = _merge_job_cards(scope.card_snapshot, cards_result.cards)
    if cards:
        try:
            scope.agent_event_callback.emit_final_report(report, cards=cards)
        except Exception:
            logger.warning("Job %s: failed to emit final report with cards (non-fatal)", request.job_id)
    transparency = _transparency(scope, request, result, anatomy, follow_ups, cards_failed=cards_result.failed)
    if getattr(models.fn_config, "type", None) == "deep_research_agent":
        emit_phase_event(scope.event_store, PHASE_DONE)
    if hasattr(scope.event_store, "flush"):
        scope.event_store.flush()
    sources = extract_verified_sources(result)
    return JobOutcome(
        report=report,
        cards=cards,
        transparency=transparency,
        sources=sources,
        skills_activated=extract_skills_activated(result),
        output=build_job_output(report, cards=cards, transparency=transparency, sources=sources),
    )


def _transparency(
    scope: JobScope, request: JobRequest, result: Any, anatomy: Any, follow_ups: Any, *, cards_failed: bool
) -> dict[str, Any]:
    transparency: dict[str, Any] = {}
    try:
        transparency = extract_answer_transparency(result)
        if anatomy.answer_meta:
            transparency["answer_meta"] = anatomy.answer_meta
        if anatomy.findings:
            transparency["findings"] = anatomy.findings
        if follow_ups:
            transparency["stages"] = {"followUps": follow_ups}
        if cards_failed:
            mark_degraded(transparency, DEGRADED_CARDS_GENERATION_FAILED)
        if scope.event_store is not None and (
            transparency.get("research_truncated") or transparency.get("degraded_reasons")
        ):
            data = {key: transparency[key] for key in _DEGRADED_EVENT_FIELDS if key in transparency}
            scope.event_store.store({"type": JOB_DEGRADED_EVENT_TYPE, "data": data})
    except Exception:
        logger.warning("Job %s: failed to record answer transparency (non-fatal)", request.job_id, exc_info=True)
    return transparency


async def finish(scope: JobScope, request: JobRequest, outcome: JobOutcome) -> None:
    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

    finalized = await _update_status_if_not_terminal(
        scope.job_store, request.job_id, JobStatus.SUCCESS, output=outcome.output
    )
    if not finalized:
        logger.info(
            "Job %s finished without a thread turn (terminal status already set); the standing verdict owns the thread",
            request.job_id,
        )
        return
    await _write_thread_turn(scope, request, outcome)
    await notify_job_outcome(
        job_id=request.job_id,
        usage_context=request.usage_context,
        status="success",
        report=outcome.report,
        cards=outcome.cards,
        expect_run=request.expect_run,
    )
    logger.info(
        "Job %s completed (report: %d chars, cards: %d)",
        request.job_id,
        len(outcome.report),
        len(outcome.cards) if outcome.cards else 0,
    )


async def _write_thread_turn(scope: JobScope, request: JobRequest, outcome: JobOutcome) -> None:
    landed_in = await write_job_turn(
        conversation_id=request.parent_conversation_id,
        job_id=request.job_id,
        usage_context=request.usage_context,
        prompt=request.input_text,
        answer=outcome.report,
        cards=outcome.cards,
        skills_activated=outcome.skills_activated,
        sources=outcome.sources,
        transparency=outcome.transparency,
        expect_run=request.expect_run,
        trace_id=current_trace_id_hex(),
    )
    if scope.ledger is not None:
        scope.ledger.note_result(report_message_id=landed_in or None)


async def finish_failed(scope: JobScope, request: JobRequest, exc: Exception) -> None:
    from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

    logger.exception("Job %s failed: %s", request.job_id, type(exc).__name__)
    safe_error = sanitize_job_error(exc)
    finalized = False
    if scope.job_store:
        finalized = await _update_status_if_not_terminal(
            scope.job_store, request.job_id, JobStatus.FAILURE, error=safe_error
        )
    verdict = JobStatus.FAILURE.value
    if await _should_write_notice(
        job_store=scope.job_store, job_id=request.job_id, verdict=verdict, finalized=finalized
    ):
        await write_job_notice(
            conversation_id=request.parent_conversation_id,
            job_id=request.job_id,
            usage_context=request.usage_context,
            notice=FAILURE_NOTICE,
            expect_run=request.expect_run,
        )
    if await _should_notify_outcome(
        job_store=scope.job_store, job_id=request.job_id, verdict=verdict, finalized=finalized
    ):
        await notify_job_outcome(
            job_id=request.job_id,
            usage_context=request.usage_context,
            status="failure",
            error=safe_error,
            expect_run=request.expect_run,
        )
    if scope.event_store is None:
        scope.event_store = BatchingEventStore(EventStore(request.db_url, request.job_id))
    scope.event_store.store({"type": "job.error", "data": {"error": safe_error, "error_type": type(exc).__name__}})
    if hasattr(scope.event_store, "flush"):
        scope.event_store.flush()
