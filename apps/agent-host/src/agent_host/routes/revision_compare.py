import asyncio
import base64
import logging
from dataclasses import replace
from typing import Any
from typing import Literal

import httpx
from fastapi import APIRouter
from fastapi import Header
from fastapi import HTTPException
from fastapi import Request
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field

from agent.common import provider_limiter
from agent.common.cache import get_json
from agent.common.cache import set_json
from agent.common.cost_tracking import USAGE_ROLE_REVISION_COMPARE
from agent.common.cost_tracking import BudgetSnapshot
from agent.common.cost_tracking import record_completion_usage
from agent.common.cost_tracking import track_llm_costs
from agent.common.credential_resolution import ResolvedCredential
from agent.common.licensed_text import licensed_document_scope
from agent.common.openrouter import limited_async_http_client
from agent.knowledge import get_available_documents_async
from agent.knowledge import revision_compare as compare
from agent.knowledge import revision_diff
from agent.observability.direct_trace import observed_generation

from ._llm_json import extract_json_object
from ._llm_json import message_content

logger = logging.getLogger(__name__)

TRACE_NAME = "revision-visual-compare"

_REQUEST_TIMEOUT_SECONDS = 90.0

_LIMITER_CLASS = {"person": provider_limiter.INTERACTIVE, "notice": provider_limiter.BULK}

MAX_PAGE = 2000


class RevisionCompareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    older: str = Field(..., min_length=1, max_length=512, description="File name of the older Fassung.")
    newer: str = Field(..., min_length=1, max_length=512, description="File name of the newer Fassung.")
    page: int = Field(1, ge=1, le=MAX_PAGE, description="Page to compare, 1-based; the same page of both files.")
    purpose: Literal["person", "notice"] = Field(
        "person",
        description="Who waits: a person in the compare view, or a notice Piloti runs on its own (ADR-0130).",
    )


class RevisionPagesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    older: str = Field(..., min_length=1, max_length=512, description="File name of the older Fassung.")
    newer: str = Field(..., min_length=1, max_length=512, description="File name of the newer Fassung.")


class RevisionPagesResponse(BaseModel):
    pages: list[int] = Field(..., description="1-based pages of the newer Fassung that changed or came new.")
    newer_page_count: int
    comparable: bool = Field(
        ...,
        description="False when neither Fassung has read text or a drawing reading: no page can be called unchanged.",
    )


class CompareRegionModel(BaseModel):
    page: int
    x: float
    y: float
    w: float
    h: float
    label: str


class RevisionCompareResponse(BaseModel):
    regions: list[CompareRegionModel]
    summary: list[str] = Field(
        ..., description="Short German sentences; „keine sichtbare Änderung“ when there is none."
    )
    model: str
    cached: bool = Field(..., description="True when the result came from the cache and no model was called.")
    trace_id: str | None = Field(
        None, description="The generation's Langfuse trace id; null on a cache hit or with tracing off."
    )


def _vision_settings(organization_id: str | None) -> ResolvedCredential:
    from knowledge_layer.ingest import resolve_vlm_credential

    cred = resolve_vlm_credential(organization_id)
    if not organization_id:
        return cred
    try:
        from agent.common.model_overrides import AgentGroup
        from agent.common.model_overrides import resolve_org_model_overrides

        override = resolve_org_model_overrides(organization_id).get(AgentGroup.INGEST_VLM.value)
    except Exception:  # noqa: BLE001 - model selection must never take the comparison down
        logger.warning("Vision model override could not be read for a Fassung comparison", exc_info=True)
        override = None
    return replace(cred, model=override) if override else cred


async def _load_page(collection: str, file_name: str, page: int, organization_id: str | None):
    from knowledge_layer.page_image import load_page_jpeg

    return await load_page_jpeg(collection, file_name, page, organization_id=organization_id)


async def _pages(
    collection: str, older: str, newer: str, page: int, organization_id: str | None
) -> tuple[bytes, bytes]:
    from knowledge_layer.page_image import PageImageUnavailable

    async def one(side: str, file_name: str) -> bytes:
        try:
            return (await _load_page(collection, file_name, page, organization_id)).jpeg
        except PageImageUnavailable as exc:
            raise HTTPException(
                status_code=404, detail=f"Page {page} of the {side} Fassung is not available ({exc.reason})"
            ) from None

    older_jpeg, newer_jpeg = await asyncio.gather(one("older", older), one("newer", newer))
    return older_jpeg, newer_jpeg


def _licence_of(collection: str, older: str, newer: str):
    from agent.tools.look.place import document_licence

    terms = [
        licence for licence in (document_licence(collection, older), document_licence(collection, newer)) if licence
    ]
    licensed = [licence for licence in terms if licence.licensed]
    if any(not licence.ai_processing for licence in licensed):
        raise HTTPException(
            status_code=403,
            detail="A licensed copy whose office has not confirmed AI processing is not compared by a model",
        )
    return licensed[0] if licensed else None


def _data_url(jpeg: bytes) -> str:
    return f"data:image/jpeg;base64,{base64.b64encode(jpeg).decode('ascii')}"


async def _ask_model(
    cred: ResolvedCredential, older_jpeg: bytes, newer_jpeg: bytes, page: int, purpose: str = "person"
) -> tuple[dict[str, Any], str | None]:
    messages = compare.build_messages(_data_url(older_jpeg), _data_url(newer_jpeg))
    payload = cred.request_body(
        {"model": cred.model, "temperature": 0, "max_tokens": compare.MAX_COMPLETION_TOKENS, "messages": messages}
    )
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {cred.api_key}"}
    try:
        async with (
            observed_generation(
                TRACE_NAME,
                model=cred.model,
                messages=compare.traceable(messages),
                metadata={"page": page, "prompt_version": compare.PROMPT_VERSION, "purpose": purpose},
            ) as generation,
            limited_async_http_client(cls=_LIMITER_CLASS[purpose], timeout=_REQUEST_TIMEOUT_SECONDS) as client,
        ):
            response = await client.post(f"{cred.base_url}/chat/completions", json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            generation.finish(data)
            trace_id = generation.trace_id
            if isinstance(data, dict):
                record_completion_usage(
                    data,
                    role=USAGE_ROLE_REVISION_COMPARE,
                    requested_model=cred.model,
                    is_byok=cred.source == "byok",
                )
        content, _finish_reason = message_content(data)
        return extract_json_object(content), trace_id
    except httpx.HTTPError as exc:
        logger.warning("Fassung comparison request failed: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="The vision model could not be reached") from None
    except ValueError:
        logger.warning("Fassung comparison reply was not the requested JSON")
        raise HTTPException(status_code=502, detail="The vision model did not answer in the requested form") from None


def _cached(key: str) -> compare.CompareResult | None:
    try:
        return compare.CompareResult.from_dict(get_json(key))
    except Exception:  # noqa: BLE001 - a cache fault is a miss
        return None


def _remember(key: str, result: compare.CompareResult) -> None:
    try:
        set_json(key, result.as_dict(), compare.CACHE_TTL_SECONDS)
    except Exception:  # noqa: BLE001 - a cache fault never fails the comparison
        logger.debug("Fassung comparison could not be cached", exc_info=True)


def _response(
    result: compare.CompareResult, model: str, cached: bool, trace_id: str | None = None
) -> RevisionCompareResponse:
    return RevisionCompareResponse(
        regions=[CompareRegionModel(**region.as_dict()) for region in result.regions],
        summary=list(result.summary),
        model=model,
        cached=cached,
        trace_id=trace_id,
    )


def _stored_chunks(collection: str, file_name: str) -> list[revision_diff.RevisionChunk] | None:
    from agent.knowledge.collection_pages import read_chunks

    stored = read_chunks(collection, file_name)
    if stored is None:
        return None
    return [chunk for text, meta in stored if (chunk := revision_diff.chunk_from_store(text, meta)) is not None]


async def _ingested_or_409(collection_name: str, older: str, newer: str) -> None:
    if older == newer:
        raise HTTPException(status_code=400, detail="A file is not compared with itself")
    documents = {doc.file_name for doc in await get_available_documents_async(collection_name)}
    missing = [name for name in (older, newer) if name not in documents]
    if missing:
        raise HTTPException(status_code=409, detail=f"Not ingested in collection '{collection_name}': {missing!r}")


async def _changed_pages(collection: str, request: RevisionPagesRequest, office: str | None) -> RevisionPagesResponse:
    from knowledge_layer.search import reading_as

    try:
        with reading_as(office):
            older_chunks, newer_chunks = await asyncio.gather(
                asyncio.to_thread(_stored_chunks, collection, request.older),
                asyncio.to_thread(_stored_chunks, collection, request.newer),
            )
    except Exception:  # noqa: BLE001 - an outage is said as one, never as "nothing changed"
        logger.warning("Changed pages of two Fassungen could not be read", exc_info=True)
        raise HTTPException(status_code=503, detail="The index could not be read") from None
    diff = revision_diff.diff_revisions(older_chunks or [], newer_chunks or [])
    return RevisionPagesResponse(
        pages=list(revision_diff.changed_pages(diff)),
        newer_page_count=diff.newer_page_count,
        comparable=diff.has_text or diff.has_drawing,
    )


def add_revision_compare_routes(router: APIRouter) -> None:

    @router.post(
        "/v1/collections/{collection_name}/fassung-compare",
        response_model=RevisionCompareResponse,
        include_in_schema=False,
    )
    @router.post(
        "/v1/collections/{collection_name}/revision-compare",
        response_model=RevisionCompareResponse,
        tags=["documents"],
        summary="Mark what changed between two Fassungen of a page, and say it in words",
    )
    async def post_revision_compare(
        collection_name: str,
        request: RevisionCompareRequest,
        x_grid_organization_id: str | None = Header(default=None),
        x_grid_user_id: str | None = Header(default=None),
    ) -> RevisionCompareResponse:
        await _ingested_or_409(collection_name, request.older, request.newer)
        licence = await asyncio.to_thread(_licence_of, collection_name, request.older, request.newer)
        cred = await asyncio.to_thread(_vision_settings, x_grid_organization_id)
        if not cred.api_key:
            raise HTTPException(status_code=503, detail="No vision model is configured")

        older_jpeg, newer_jpeg = await _pages(
            collection_name, request.older, request.newer, request.page, x_grid_organization_id
        )
        key = compare.cache_key(cred.model, collection_name, request.page, older_jpeg, newer_jpeg)
        hit = await asyncio.to_thread(_cached, key)
        if hit is not None:
            return _response(hit, cred.model, cached=True)

        identity = {"organization_id": x_grid_organization_id, "user_id": x_grid_user_id}
        with track_llm_costs(identity=identity, budget=BudgetSnapshot()), licensed_document_scope(licence):
            reply, trace_id = await _ask_model(cred, older_jpeg, newer_jpeg, request.page, request.purpose)
        result = compare.parse_compare(reply, request.page)
        await asyncio.to_thread(_remember, key, result)
        return _response(result, cred.model, cached=False, trace_id=trace_id)

    @router.post(
        "/v1/collections/{collection_name}/revision-pages",
        response_model=RevisionPagesResponse,
        tags=["documents"],
        summary="Which pages of the newer Fassung changed, read from the index without a model call",
    )
    async def post_revision_pages(
        collection_name: str, request: RevisionPagesRequest, http_request: Request
    ) -> RevisionPagesResponse:
        from .internal_auth import internal_office

        await _ingested_or_409(collection_name, request.older, request.newer)
        return await _changed_pages(collection_name, request, internal_office(http_request))
