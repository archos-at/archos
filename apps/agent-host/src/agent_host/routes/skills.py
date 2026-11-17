from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import Request
from pydantic import BaseModel
from pydantic import Field
from pydantic import model_validator

from agent.auth import Principal
from agent.common.job_admission import JobAdmissionError

from ..jobs.run_result import TEMPORARY_CONVERSATION_KEY
from ..registry import get_agent_config
from .internal_auth import _require_internal_token

logger = logging.getLogger(__name__)

_OUTPUT_AGENT_TYPES: dict[str, str] = {
    "chat": "researcher",
    "deep-research": "deep_researcher",
}


SUBMIT_INPUT_MAX_CHARS = 48_000


class SkillSubmitPayload(BaseModel):
    input: str = Field(
        ...,
        min_length=1,
        max_length=SUBMIT_INPUT_MAX_CHARS,
        description="Composed job prompt (job prompt + the attached skill's body, when a skill is attached)",
    )
    skills: list[str] = Field(
        default_factory=list,
        description=(
            "Names of the skills attached to this job, for the log. The skill BODY travels "
            "composed into `input`; nothing is forced on the worker. Empty = no skill attached."
        ),
    )
    output: Literal["chat", "deep-research"] | None = Field(
        None,
        description="The job's chosen output kind; decides the agent",
    )
    execution: Literal["chat", "deep-research"] | None = Field(
        None,
        description="Deprecated pre-rename alias for `output`; used only when `output` is absent",
    )
    agent_type: str | None = Field(
        None,
        description="Explicit agent type override; defaults to the output-kind agent",
    )
    job_id: str | None = Field(
        None,
        pattern=r"^[a-zA-Z0-9_-]+$",
        max_length=64,
        description="Optional idempotency id (auto-generated if omitted)",
    )
    data_sources: list[str] | None = Field(
        None,
        description="Data source IDs to target; null = all sources available to the agent",
    )
    collection_scope: list[str] | None = Field(
        None,
        description="Collection scope (base + project + scoped collections); the project collection is derived from it",
    )
    project_context: str | None = Field(None, description="Optional project-context prompt block")
    project_memory: str | None = Field(
        None,
        description=(
            "The project-memory digest as of fire time; the worker fetches a live one and "
            "keeps this only when that fetch fails"
        ),
    )
    memory_reflection_enabled: bool = Field(
        False,
        description="Whether the worker may run the post-run memory reflection pass (the org's flag, BFF-evaluated)",
    )
    temporary_conversation: bool = Field(
        False,
        description="The run's conversation is temporary (ADR-0180): the worker reflects nothing from its report",
    )
    organization_id: str = Field(..., description="WorkOS organization id owning the run (required)")
    user_id: str | None = Field(None, description="Skill owner's WorkOS user id")
    project_id: str | None = Field(None, description="Project id the skill run is scoped to")
    conversation_id: str | None = Field(
        None,
        description=(
            "Conversation the BFF created for this run to land in (output='chat' jobs only). "
            "Absent for deep-research jobs, and for any run whose conversation could not be created."
        ),
    )
    run_id: str | None = Field(
        None,
        max_length=64,
        description=(
            "The `task_runs` row this job IS (ADR-0062). Carried into the worker so the run "
            "flushes its ledger to its own message; a job submitted without one still narrates "
            "itself on its event stream and writes nothing."
        ),
    )
    clarifier_result: str | None = Field(
        None,
        max_length=20_000,
        description=(
            "What the commissioning turn settled with the person — the clarifier's exchange and the "
            "approved plan — set on the agent state so the planner and the writer read it as binding, "
            "the way the synchronous chat path does. Absent for a scheduled or delegated run."
        ),
    )
    documents: dict | None = Field(
        None,
        description=(
            "The Unterlagen the reader named on the plan: {basis: [{name,title?,shelf?}], "
            "excluded: [...]}. Sanitised in the worker; absent when none were named."
        ),
    )
    knowledge_context: dict | None = Field(
        None,
        description=(
            "The knowledge context the BFF resolved for the run's project, the turn context's "
            "`knowledgeContext` (ADR-0173, ADR-0175). Absent or malformed, the run reads it as "
            "`knowledge_unavailable`: no edition named binding, no legal-database lookup."
        ),
    )
    priority: Literal["interactive", "bulk"] = Field(
        "interactive",
        description=(
            "Where the run goes inside its organization's queue (ADR-0079): `interactive` for a run a "
            "person is waiting on (an escalated question, a manual 'run now'), `bulk` for a scheduled "
            "fire. Never ahead of another organization either way."
        ),
    )
    owner_email: str | None = Field(None, description="Skill owner's email (job ownership)")
    budget_header: str | None = Field(
        None,
        description="Pass-through X-Grid-Budget header value the BFF builds for interactive submits",
    )
    model_overrides: dict[str, str] | None = Field(
        None,
        description="Per-org runtime model overrides ({agent_group: model})",
    )

    @model_validator(mode="after")
    def _require_an_output_kind(self) -> SkillSubmitPayload:
        if self.output is None and self.execution is None:
            raise ValueError("one of 'output' or 'execution' is required")
        return self

    @property
    def resolved_output(self) -> str:
        if self.output is not None:
            if self.execution is not None and self.execution != self.output:
                logger.warning(
                    "Skill submit sent conflicting output=%s and execution=%s; using output",
                    self.output,
                    self.execution,
                )
            return self.output
        assert self.execution is not None  # noqa: S101 - guaranteed by _require_an_output_kind
        return self.execution


class SkillSubmitResponse(BaseModel):
    job_id: str = Field(..., description="The submitted async job id")
    queued: bool = Field(
        False,
        description=(
            "Always true: the job waits in the research queue for a free worker, so the run is "
            "`queued` until the worker starts it."
        ),
    )


async def _check_skill_data_sources(body: SkillSubmitPayload, agent_type: str, config_name: str) -> None:
    from .builder_state import get_active_builder

    builder = get_active_builder()
    if builder is not None:
        from .job_data_sources import validate_data_sources_for_agent

        await validate_data_sources_for_agent(
            builder=builder,
            agent_type=agent_type,
            agent_config_name=config_name,
            data_sources=body.data_sources,
        )
    elif body.data_sources:
        from agent.common.data_source_registry import get_all_sources

        known_ids = {source.id for source in get_all_sources()}
        unknown = sorted(set(body.data_sources) - known_ids)
        if unknown:
            raise HTTPException(422, f"Unknown data source IDs: {', '.join(unknown)}")
        logger.warning(
            "Skill submit before job routes registered a builder: "
            "validated %d data source(s) against the registry only",
            len(body.data_sources),
        )


def _skill_usage_context(body: SkillSubmitPayload) -> dict:
    context: dict = {
        "identity": {
            "organization_id": body.organization_id,
            "user_id": body.user_id,
            "project_id": body.project_id,
            "conversation_id": body.conversation_id,
        },
        "budget_header": body.budget_header,
    }
    if body.temporary_conversation:
        context[TEMPORARY_CONVERSATION_KEY] = True
    return context


async def _submit_skill_run(
    body: SkillSubmitPayload,
    agent_type: str,
    principal: Principal,
    owner: str,
    usage_context: dict,
    request_envelope: dict[str, str] | None,
) -> str:
    from ..jobs.submit import DuplicateJobIdError
    from ..jobs.submit import MissingPrincipalError
    from ..jobs.submit import submit_agent_job as submit_authorized_job

    try:
        return await submit_authorized_job(
            agent_type=agent_type,
            input_text=body.input,
            owner=owner,
            principal=principal,
            job_id=body.job_id,
            data_sources=body.data_sources,
            collection_scope=body.collection_scope,
            project_context=body.project_context,
            project_memory=body.project_memory,
            model_overrides=body.model_overrides,
            usage_context=usage_context,
            memory_reflection_enabled=body.memory_reflection_enabled,
            conversation_id=body.conversation_id,
            run_id=body.run_id,
            clarifier_result=body.clarifier_result,
            documents=body.documents,
            knowledge_context=body.knowledge_context,
            priority=body.priority,
            request_envelope=request_envelope,
        )
    except JobAdmissionError as exc:
        raise HTTPException(429, str(exc), headers={"Retry-After": str(exc.retry_after_seconds)})
    except DuplicateJobIdError as exc:
        raise HTTPException(409, str(exc))
    except MissingPrincipalError as exc:
        raise HTTPException(403, str(exc))
    except RuntimeError:
        logger.exception("Runtime error submitting skill %s job", agent_type)
        raise HTTPException(500, "Failed to submit skill job")
    except Exception as exc:
        logger.warning("Failed to submit skill job: %s", exc)
        raise HTTPException(500, "Failed to persist skill job authorization metadata")


async def submit_skill(body: SkillSubmitPayload, request: Request) -> SkillSubmitResponse:
    _require_internal_token(request)

    from ..jobs.run_envelope import capture_request_envelope

    output = body.resolved_output
    agent_type = body.agent_type or _OUTPUT_AGENT_TYPES[output]

    try:
        agent_config = get_agent_config(agent_type)
    except KeyError as exc:
        raise HTTPException(400, str(exc))

    await _check_skill_data_sources(body, agent_type, agent_config.config_name)

    subject = body.user_id or body.owner_email or body.organization_id
    principal = Principal(type="jwt", sub=subject, email=body.owner_email)
    owner = principal.email or principal.sub

    request_envelope = capture_request_envelope(
        request.headers, user_id=body.user_id, organization_id=body.organization_id
    )

    job_id = await _submit_skill_run(body, agent_type, principal, owner, _skill_usage_context(body), request_envelope)

    logger.info(
        "Submitted skill %s job %s for org %s (owner %s, output %s, %d attached skill(s), acts as requester: %s)",
        agent_type,
        job_id,
        body.organization_id,
        owner,
        output,
        len(body.skills),
        request_envelope is not None,
    )
    return SkillSubmitResponse(job_id=job_id, queued=True)


def add_skill_routes(router: APIRouter) -> None:
    router.post(
        "/v1/internal/skills/submit",
        response_model=SkillSubmitResponse,
        tags=["skills", "internal"],
        summary="Submit a skill run to the async research pipeline (internal)",
        responses={
            400: {"description": "Unknown agent type"},
            403: {"description": "Missing or invalid internal token"},
            409: {"description": "A job with the supplied job_id already exists"},
            422: {"description": "Invalid payload, or unknown/agent-unavailable data source IDs"},
            429: {
                "description": (
                    "Abuse bound: the organization already has too many jobs waiting (`MAX_QUEUED_JOBS_PER_ORG`)"
                )
            },
        },
    )(submit_skill)
