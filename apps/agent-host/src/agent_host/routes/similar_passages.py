from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import Request

from agent.observability.direct_trace import observed_retrieval

from ..models.similar import SimilarDocument
from ..models.similar import SimilarPassage
from ..models.similar import SimilarPassagesRequest
from ..models.similar import SimilarPassagesResponse
from .document_search import _authorize_collection
from .document_search import _snippet
from .document_search import request_office

logger = logging.getLogger(__name__)

TRACE_FEATURE = "similar-passages"
TRACE_STEP = "retrieve.similar_passages"
TRACE_PICK_LIMIT = 50
FILTER_FIELDS = ["scope", "superseded", "file_name", "grid_document_id"]


def _response(result: Any, snippet_max_chars: int) -> SimilarPassagesResponse:
    return SimilarPassagesResponse(
        origin=result.origin,
        documents=[
            SimilarDocument(
                collection=document.scope,
                file_name=document.file_name,
                passages=[
                    SimilarPassage(
                        chunk_id=passage.chunk_id,
                        snippet=_snippet(passage.text, snippet_max_chars).removesuffix("…"),
                        page_number=passage.page,
                        score=max(0.0, min(1.0, passage.score)),
                    )
                    for passage in document.passages
                ],
            )
            for document in result.documents
        ],
    )


def _picks(response: SimilarPassagesResponse) -> dict[str, Any]:
    picked = [
        {
            "collection": document.collection,
            "file": document.file_name,
            "chunk_id": passage.chunk_id,
            "page": passage.page_number,
            "score": round(passage.score, 4),
        }
        for document in response.documents
        for passage in document.passages
    ]
    return {"origin": response.origin, "filter_fields": FILTER_FIELDS, "picked": picked[:TRACE_PICK_LIMIT]}


def _query(request: SimilarPassagesRequest, collections: list[str]) -> dict[str, Any]:
    return {
        "source": {
            "collection": request.source.collection,
            "file": request.source.file_name,
            "page": request.source.page,
            "kind": request.source.kind,
            "has_chunk_id": bool(request.source.chunk_id),
            "text_chars": len(request.source.text),
        },
        "collections": len(collections),
        "documents": request.documents,
        "passages_per_document": request.passages_per_document,
    }


def _office(office: str | None, scopes: list[str]) -> str | None:
    from knowledge_layer.search import office_for
    from knowledge_layer.search import reading_as

    with reading_as(office):
        return office_for(scopes)


def _search(request: SimilarPassagesRequest, collections: list[str], office: str | None) -> Any:
    from knowledge_layer.vector_store import PassageSource
    from knowledge_layer.vector_store import find_similar
    from knowledge_layer.vector_store import get_store

    from agent.knowledge.factory import get_active_retriever

    retriever = get_active_retriever()
    source = PassageSource(
        scope=request.source.collection,
        file_name=request.source.file_name,
        text=request.source.text,
        page=request.source.page,
        chunk_id=request.source.chunk_id,
        cited=request.source.kind == "cited",
        document_id=request.source.document_id,
    )
    return find_similar(
        get_store(retriever.embedding_identity()),
        collections,
        office_id=_office(office, [*collections, source.scope]),
        source=source,
        embed=retriever.embed_query,
        documents=request.documents,
        per_document=request.passages_per_document,
    )


def add_similar_passages_routes(router: APIRouter):

    @router.post(
        "/v1/collections/similar",
        response_model=SimilarPassagesResponse,
        tags=["documents"],
        summary="Passages like one the reader is looking at, across the collections in scope",
    )
    async def similar_passages(request: SimilarPassagesRequest, http_request: Request) -> SimilarPassagesResponse:
        collections = list(dict.fromkeys(request.collections))
        for collection in [request.source.collection, *collections]:
            _authorize_collection(http_request, collection)
        with observed_retrieval(TRACE_FEATURE, step=TRACE_STEP, query=_query(request, collections)) as trace:
            try:
                result = await asyncio.to_thread(_search, request, collections, request_office(http_request))
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e)) from e
            except LookupError as e:
                raise HTTPException(status_code=404, detail=str(e)) from e
            except NotImplementedError as e:
                raise HTTPException(status_code=409, detail=str(e)) from e
            except Exception as e:
                logger.exception("Similar-passage search failed")
                raise HTTPException(status_code=503, detail="similar-passage search failed") from e
            response = _response(result, request.snippet_max_chars)
            trace.finish(
                _picks(response),
                {
                    "origin": response.origin,
                    "documents": len(response.documents),
                    "candidates": result.candidates,
                },
            )
        return response
