from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import TYPE_CHECKING
from typing import Annotated
from typing import Any

from fastapi import Body
from fastapi import HTTPException
from fastapi import Request
from fastapi.responses import StreamingResponse

from agent.common.data_source_registry import get_all_sources
from agent.common.job_admission import JobAdmissionError

from ..jobs.access import JobCaller
from ..jobs.access import require_verified_principal
from ..jobs.access import signed_job_scope
from ..registry import AGENT_REGISTRY
from ..registry import get_agent_config

if TYPE_CHECKING:
    from nat.builder.workflow_builder import WorkflowBuilder

from ..jobs.runner import DOCUMENT_ADDED_EVENT_TYPE
from ..jobs.runner import WRITE_NOW_EVENT_TYPE
from ..jobs.runner import _update_status_if_not_terminal
from .internal_auth import _require_internal_token
from .job_artifacts import get_job_artifacts
from .job_data_sources import validate_data_sources_for_agent
from .job_event_stream import sse_generator
from .job_kill import kill_every_active_job
from .job_kill import stop_interrupted_job
from .job_models import JOB_SUBMIT_EXAMPLES
from .job_models import AgentInfo
from .job_models import AgentListResponse
from .job_models import DataSource
from .job_models import DataSourcesResponse
from .job_models import InternalJobOutcomeResponse
from .job_models import JobDocumentRequest
from .job_models import JobReportResponse
from .job_models import JobStateResponse
from .job_models import JobStatusResponse
from .job_models import JobSubmitRequest
from .job_models import ResearchRunItem
from .job_models import ResearchRunsResponse
from .job_models import report_cards
from .job_models import report_sources
from .research_runs import find_research_runs
from .research_runs import format_created_at

logger = logging.getLogger(__name__)


def _job_caller(request: Request) -> JobCaller:
    principal = require_verified_principal()
    return JobCaller(principal=principal, scope=signed_job_scope(request.headers, principal))


def _job_status_value(status: Any) -> str:
    return str(getattr(status, "value", status)).lower()


async def internal_job_outcome(
    job_store: Any, db_url: str, job_id: str, organization_id: str
) -> InternalJobOutcomeResponse:
    from ..jobs.access import get_job_access
    from ..jobs.conversation_output import run_message_for_outcome

    job = await job_store.get_job(job_id)
    access = await asyncio.get_running_loop().run_in_executor(None, get_job_access, job_id, db_url) if job else None
    if not job or not access or access.get("organization_id") != organization_id:
        raise HTTPException(404, f"Job not found: {job_id}")

    status = _job_status_value(job.status)
    output: dict[str, Any] | None = None
    if job.output:
        try:
            parsed = json.loads(job.output) if isinstance(job.output, str) else job.output
            output = parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError, TypeError:
            output = None

    report = output.get("report") if output and status == "success" else None
    return InternalJobOutcomeResponse(
        job_id=job_id,
        status=status,
        error=job.error if status in ("failure", "interrupted") else None,
        report=report if isinstance(report, str) and report else None,
        cards=report_cards(output.get("cards")) if output and report else None,
        message=run_message_for_outcome(job_id=job_id, status=status, output=output),
    )


async def _submitted(req: JobSubmitRequest, request: Request, principal: Any, expiry: int) -> tuple[str, bool]:
    from agent.auth import get_auth_token

    from ..jobs.run_envelope import capture_request_envelope
    from ..jobs.submit import DuplicateJobIdError
    from ..jobs.submit import MissingPrincipalError
    from ..jobs.submit import submit_agent_job

    request_envelope = capture_request_envelope(request.headers, user_id=principal.sub)
    try:
        job_id = await submit_agent_job(
            agent_type=req.agent_type,
            input_text=req.input,
            owner=principal.email or principal.sub,
            principal=principal,
            job_id=req.job_id,
            expiry_seconds=expiry,
            data_sources=req.data_sources,
            auth_token=get_auth_token(),
            request_envelope=request_envelope,
        )
    except JobAdmissionError as e:
        raise HTTPException(429, str(e), headers={"Retry-After": str(e.retry_after_seconds)})
    except DuplicateJobIdError as e:
        raise HTTPException(409, str(e))
    except MissingPrincipalError as e:
        raise HTTPException(403, str(e))
    except RuntimeError:
        logger.exception("Runtime error submitting async %s job", req.agent_type)
        raise HTTPException(500, "Failed to submit async job")
    except Exception as e:
        logger.warning("Failed to submit authorized job: %s", e)
        raise HTTPException(500, "Failed to persist async job authorization metadata")
    return job_id, request_envelope is not None


async def list_agents() -> AgentListResponse:
    agents = [
        AgentInfo(agent_type=agent_type, description=config.description)
        for agent_type, config in AGENT_REGISTRY.items()
    ]
    return AgentListResponse(agents=agents)


async def list_data_sources() -> DataSourcesResponse:
    try:
        from knowledge_layer.ingest import vlm_configured

        vlm_available = vlm_configured()
    except Exception:  # noqa: BLE001 — capability probe must never break the listing
        logger.warning("VLM capability probe failed; reporting vlm_available=False", exc_info=True)
        vlm_available = False

    return DataSourcesResponse(
        data_sources=[
            DataSource(
                id=source.id,
                name=source.name,
                description=source.description,
                requires_auth=source.requires_auth,
            )
            for source in get_all_sources()
        ],
        vlm_available=vlm_available,
    )


class JobRouteHandlers:
    def __init__(
        self, builder: WorkflowBuilder | None, job_store: Any, db_url: str, default_expiry_seconds: int
    ) -> None:
        self.builder = builder
        self.job_store = job_store
        self.db_url = db_url
        self.default_expiry_seconds = default_expiry_seconds

    async def submit_job(
        self,
        req: Annotated[JobSubmitRequest, Body(openapi_examples=JOB_SUBMIT_EXAMPLES)],
        request: Request,
    ) -> JobStatusResponse:
        from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

        try:
            agent_config = get_agent_config(req.agent_type)
        except KeyError as e:
            raise HTTPException(400, str(e))

        expiry = req.expiry_seconds if req.expiry_seconds is not None else self.default_expiry_seconds
        principal = require_verified_principal()
        validation_start = time.perf_counter()
        await validate_data_sources_for_agent(
            builder=self.builder,
            agent_type=req.agent_type,
            agent_config_name=agent_config.config_name,
            data_sources=req.data_sources,
        )
        logger.info(
            "Validated data_sources for agent %s in %.1fms (requested=%s)",
            req.agent_type,
            (time.perf_counter() - validation_start) * 1000,
            len(req.data_sources) if req.data_sources is not None else "none",
        )
        job_id, acts_as_requester = await _submitted(req, request, principal, expiry)
        logger.info(
            "Submitted %s job %s (expiry=%ds) for principal %s:%s (acts as requester: %s)",
            req.agent_type,
            job_id,
            expiry,
            principal.type,
            principal.sub,
            acts_as_requester,
        )
        return JobStatusResponse(
            job_id=job_id,
            status=JobStatus.SUBMITTED.value,
            agent_type=req.agent_type,
        )

    async def get_job_status(self, job_id: str, request: Request) -> JobStatusResponse:

        from ..jobs.access import authorize_job_access

        job = await authorize_job_access(self.job_store, self.db_url, job_id, _job_caller(request), "read")

        return JobStatusResponse(
            job_id=job_id,
            status=job.status,
            error=job.error,
            created_at=job.created_at.isoformat() if job.created_at else None,
        )

    async def stream_job_events(self, job_id: str, request: Request) -> StreamingResponse:
        from ..jobs.access import authorize_job_access

        await authorize_job_access(self.job_store, self.db_url, job_id, _job_caller(request), "read")

        return StreamingResponse(
            sse_generator(self.job_store, job_id, self.db_url, start_event_id=0),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    async def stream_job_events_from(self, job_id: str, last_event_id: int, request: Request) -> StreamingResponse:
        from ..jobs.access import authorize_job_access

        await authorize_job_access(self.job_store, self.db_url, job_id, _job_caller(request), "read")

        return StreamingResponse(
            sse_generator(self.job_store, job_id, self.db_url, start_event_id=last_event_id),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    async def cancel_job(self, job_id: str, request: Request) -> dict:
        from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

        from ..jobs.access import authorize_job_access

        job = await authorize_job_access(self.job_store, self.db_url, job_id, _job_caller(request), "control")

        if job.status not in (JobStatus.RUNNING.value, JobStatus.SUBMITTED.value):
            raise HTTPException(400, f"Job not cancellable: {job_id} (status: {job.status})")

        written = await _update_status_if_not_terminal(
            self.job_store, job_id, JobStatus.INTERRUPTED, error="cancelled by user"
        )
        if not written:
            raise HTTPException(400, f"Job not cancellable: {job_id} (already finished)")

        await stop_interrupted_job(self.db_url, job_id, reason="cancelled by user")
        logger.info("Cancel requested for job %s: status updated", job_id)

        return {"job_id": job_id, "status": JobStatus.INTERRUPTED.value}

    async def write_now(self, job_id: str, request: Request) -> dict:
        from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

        from ..jobs.access import authorize_job_access
        from ..jobs.event_store import EventStore

        job = await authorize_job_access(self.job_store, self.db_url, job_id, _job_caller(request), "control")

        if job.status != JobStatus.RUNNING.value:
            raise HTTPException(400, f"Job is not running: {job_id} (status: {job.status})")

        def _record() -> None:
            EventStore(self.db_url, job_id).store(
                {"type": WRITE_NOW_EVENT_TYPE, "data": {"reason": "requested by user"}}
            )

        await asyncio.get_running_loop().run_in_executor(None, _record)
        logger.info("Write-now requested for job %s", job_id)
        return {"job_id": job_id, "write_now": True}

    async def add_document(self, job_id: str, body: JobDocumentRequest, request: Request) -> dict:
        from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

        from ..jobs.access import authorize_job_access
        from ..jobs.event_store import EventStore

        job = await authorize_job_access(self.job_store, self.db_url, job_id, _job_caller(request), "control")

        if job.status != JobStatus.RUNNING.value:
            raise HTTPException(400, f"Job is not running: {job_id} (status: {job.status})")

        data = body.model_dump(exclude_none=True)

        def _record() -> None:
            EventStore(self.db_url, job_id).store({"type": DOCUMENT_ADDED_EVENT_TYPE, "data": data})

        await asyncio.get_running_loop().run_in_executor(None, _record)
        logger.info("Document added to the Grundlage of job %s: %s", job_id, body.name)
        return {"job_id": job_id, "document": data}

    async def get_job_state(self, job_id: str, request: Request) -> JobStateResponse:
        from ..jobs.access import authorize_job_access

        await authorize_job_access(self.job_store, self.db_url, job_id, _job_caller(request), "read")

        artifacts = await get_job_artifacts(self.db_url, job_id)
        return JobStateResponse(
            job_id=job_id,
            has_state=artifacts is not None,
            state=None,
            artifacts=artifacts,
        )

    async def get_job_report(self, job_id: str, request: Request) -> JobReportResponse:
        from ..jobs.access import authorize_job_access
        from ..jobs.access import get_job_project_collection

        job = await authorize_job_access(self.job_store, self.db_url, job_id, _job_caller(request), "read")

        report = None
        cards = None
        sources = None
        if job.output:
            try:
                output = json.loads(job.output) if isinstance(job.output, str) else job.output
                report = output.get("report")
                cards = report_cards(output.get("cards")) if report else None
                sources = report_sources(output.get("sources")) if report else None
            except json.JSONDecodeError, AttributeError:
                pass

        project_collection = await get_job_project_collection(job_id, self.db_url) if report else None

        return JobReportResponse(
            job_id=job_id,
            has_report=bool(report),
            report=report,
            cards=cards,
            sources=sources,
            project_collection=project_collection,
        )

    async def kill_active_jobs(self, request: Request) -> dict:
        _require_internal_token(request)
        return await kill_every_active_job(self.job_store, self.db_url)

    async def get_internal_job_outcome(
        self, job_id: str, organization_id: str, request: Request
    ) -> InternalJobOutcomeResponse:
        _require_internal_token(request)
        return await internal_job_outcome(self.job_store, self.db_url, job_id, organization_id)

    async def list_research_runs(
        self,
        request: Request,
        project_collection: str | None = None,
        conversation_id: str | None = None,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> ResearchRunsResponse:
        caller = _job_caller(request)

        clamped_limit = max(1, min(limit, 200))
        clamped_offset = max(0, offset)

        visible_to = caller if os.environ.get("REQUIRE_AUTH", "false").lower() == "true" else None

        loop = asyncio.get_running_loop()
        rows, total = await loop.run_in_executor(
            None,
            find_research_runs,
            self.db_url,
            visible_to,
            project_collection,
            conversation_id,
            status,
            clamped_limit,
            clamped_offset,
        )

        jobs = [
            ResearchRunItem(
                job_id=row["job_id"],
                status=row["status"],
                created_at=format_created_at(row["created_at"]),
                conversation_id=row["conversation_id"],
                project_collection=row["project_collection"],
            )
            for row in rows
        ]
        return ResearchRunsResponse(jobs=jobs, total=total)
