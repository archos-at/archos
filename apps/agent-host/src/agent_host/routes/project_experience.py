import asyncio
import logging

from fastapi import APIRouter
from fastapi import Request

from agent.knowledge.project_experience import ProjectExperienceRequest
from agent.knowledge.project_experience import ProjectExperienceResponse
from agent.knowledge.project_experience import read_project_experience

from .internal_auth import _require_internal_token

logger = logging.getLogger(__name__)


def _read_project(request: ProjectExperienceRequest) -> ProjectExperienceResponse:
    try:
        from agent.knowledge.collection_pages import read_pages
        from agent.knowledge.factory import get_active_ingestor
        from agent.knowledge.factory import get_available_documents

        return read_project_experience(
            request,
            llm=getattr(get_active_ingestor(), "summary_llm", None),
            list_documents=get_available_documents,
            fetch_pages=read_pages,
        )
    except Exception:  # noqa: BLE001 - the contract answers 200 with error=extraction_failed
        logger.exception("Project experience: the project could not be read")
        return ProjectExperienceResponse(error="extraction_failed")


def add_project_experience_routes(router: APIRouter) -> None:

    @router.post(
        "/v1/internal/project-experience",
        response_model=ProjectExperienceResponse,
        tags=["platform"],
        summary="Read a closed project's documents for its fingerprint and decisions",
        description=(
            "Chooses the project's documents from its inventory, then reads them once for the values the "
            "vocabulary asks (each with a verbatim quote) and for the decisions and constraints they state. "
            "Every value is a suggestion the caller shows a person to confirm."
        ),
    )
    async def project_experience(request: ProjectExperienceRequest, http_request: Request) -> ProjectExperienceResponse:
        _require_internal_token(http_request)
        from knowledge_layer.search import reading_as

        with reading_as(request.organization_id):
            return await asyncio.to_thread(_read_project, request)
