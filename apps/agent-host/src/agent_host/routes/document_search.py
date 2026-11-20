import logging
import os
from typing import Any

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Request
from knowledge_layer.vector_store import DOCUMENT_ID_FIELD

from agent.knowledge.base import FUSED_SCORE_KEY
from agent.knowledge.base import LEXICAL_MATCH_KEY
from agent.knowledge.base import BaseIngestor
from agent.knowledge.schema import Chunk
from agent.knowledge.scoping import _normalize_collection_name
from agent.observability.direct_trace import observed_retrieval
from agent.project_context import ORGANIZATION_ID_HEADER
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_HEADER
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_SIG_HEADER
from agent.project_context import RequestContext

from ..models.document_search import DocumentSearchHit
from ..models.document_search import DocumentSearchRequest
from ..models.document_search import DocumentSearchResponse
from ..models.document_search import GroupedDocumentSearchRequest
from ..models.document_search import GroupedSearchFilters
from .collections import _require_ingestor
from .collections import require_collection

logger = logging.getLogger(__name__)

SNIPPET_MAX_CHARS = 300


def _require_auth() -> bool:
    return os.getenv("REQUIRE_AUTH", "false").lower() == "true"


def _verified_collection_scope(http_request: Request) -> list[str] | None:
    ctx = RequestContext.from_envelope(
        http_request.headers.get(REQUEST_CONTEXT_ENVELOPE_HEADER),
        http_request.headers.get(REQUEST_CONTEXT_ENVELOPE_SIG_HEADER),
        os.environ.get("INTERNAL_API_TOKEN"),
    )
    if ctx is None:
        return None
    return ctx.collection_scope


def request_office(http_request: Request) -> str | None:
    ctx = RequestContext.from_envelope(
        http_request.headers.get(REQUEST_CONTEXT_ENVELOPE_HEADER),
        http_request.headers.get(REQUEST_CONTEXT_ENVELOPE_SIG_HEADER),
        os.environ.get("INTERNAL_API_TOKEN"),
    )
    if ctx is not None and ctx.organization_id:
        return ctx.organization_id
    if _require_auth():
        return None
    return (http_request.headers.get(ORGANIZATION_ID_HEADER) or "").strip() or None


def _authorize_collection(http_request: Request, collection_name: str) -> None:
    scope = _verified_collection_scope(http_request)
    if scope is not None:
        allowed = {_normalize_collection_name(name) for name in scope}
        if _normalize_collection_name(collection_name) not in allowed:
            raise HTTPException(status_code=404, detail=f"Collection '{collection_name}' not found")
    elif _require_auth():
        raise HTTPException(
            status_code=403,
            detail="missing or invalid X-Grid-Request-Context envelope",
        )


def _snippet(content: str, limit: int = SNIPPET_MAX_CHARS) -> str:
    text = (content or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "…"


def _aggregate_hits(
    chunks: list[Chunk], collection_name: str, top_k_files: int, snippet_max_chars: int = SNIPPET_MAX_CHARS
) -> list[DocumentSearchHit]:
    best_by_file: dict[str, Chunk] = {}
    for chunk in chunks:
        existing = best_by_file.get(chunk.file_name)
        if existing is None or chunk.score > existing.score:
            best_by_file[chunk.file_name] = chunk

    hits = [
        DocumentSearchHit(
            file_name=chunk.file_name,
            score=chunk.score,
            snippet=_snippet(chunk.content, snippet_max_chars),
            page_number=chunk.page_number,
            collection=chunk.metadata.get("collection", collection_name),
        )
        for chunk in best_by_file.values()
    ]
    hits.sort(key=lambda h: h.score, reverse=True)
    return hits[:top_k_files]


GROUP_CHUNKS_PER_FILE = 3


def _fused(chunk: Chunk) -> float:
    value = chunk.metadata.get(FUSED_SCORE_KEY)
    return float(value) if isinstance(value, (int, float)) else 0.0


def _lexical(chunks: list[Chunk]) -> bool | None:
    stated = [chunk.metadata[LEXICAL_MATCH_KEY] for chunk in chunks if LEXICAL_MATCH_KEY in chunk.metadata]
    return any(stated) if stated else None


def _document_id(chunk: Chunk) -> str | None:
    value = chunk.metadata.get(DOCUMENT_ID_FIELD)
    return value if isinstance(value, str) and value else None


def _ranked_group_hits(
    grouped: list[tuple[str, list[Chunk]]], files_per_group: int, snippet_max_chars: int
) -> list[DocumentSearchHit]:
    ranked: list[tuple[float, int, int, DocumentSearchHit]] = []
    for group_index, (collection, chunks) in enumerate(grouped):
        best: dict[str, Chunk] = {}
        by_file: dict[str, list[Chunk]] = {}
        for chunk in chunks:
            by_file.setdefault(chunk.file_name, []).append(chunk)
            current = best.get(chunk.file_name)
            if current is None or (_fused(chunk), chunk.score) > (_fused(current), current.score):
                best[chunk.file_name] = chunk
        documents = sorted(best.values(), key=lambda chunk: (_fused(chunk), chunk.score), reverse=True)
        for file_index, chunk in enumerate(documents[:files_per_group]):
            hit = DocumentSearchHit(
                file_name=chunk.file_name,
                score=chunk.score,
                snippet=_snippet(chunk.content, snippet_max_chars),
                page_number=chunk.page_number,
                collection=collection,
                document_id=_document_id(chunk),
                grid_document_id=_document_id(chunk),
                lexical=_lexical(by_file[chunk.file_name]),
            )
            ranked.append((-_fused(chunk), group_index, file_index, hit))
    ranked.sort(key=lambda entry: entry[:3])
    return [entry[3] for entry in ranked]


CURRENT_REVISIONS: dict[str, Any] = {"superseded": {"$ne": True}}


class MatchesNothing(Exception): ...


def reference_values(terms: list[str]) -> list[str]:
    from knowledge_layer.references import KINDS
    from knowledge_layer.references import spellings
    from knowledge_layer.vector_store import plan
    from knowledge_layer.vector_store import reference_value

    values: list[str] = []
    for term in terms:
        kind, sep, key = term.partition(":")
        if sep and kind in KINDS and key.strip() == key and key:
            values.extend(reference_value(kind, spelling) for spelling in spellings(kind, key))
            continue
        pushdown = plan(doc_class=None, folder=None, file_name=None, refers_to=term)
        values.extend(pushdown.references)
    return list(dict.fromkeys(values))


def _reading_clauses(filters: GroupedSearchFilters) -> list[dict[str, Any]]:
    from knowledge_layer.vector_store import Pushdown

    parts: list[dict[str, Any]] = []
    if filters.document_ids:
        by_id: dict[str, Any] = {DOCUMENT_ID_FIELD: {"$in": list(dict.fromkeys(filters.document_ids))}}
        parts.append(
            {"$or": [by_id, {"file_name": {"$in": list(dict.fromkeys(filters.file_names))}}]}
            if filters.file_names
            else by_id
        )
    if filters.reading_types:
        parts.append({"document_type": {"$in": list(dict.fromkeys(filters.reading_types))}})
    if filters.refers_to:
        references = tuple(reference_values(filters.refers_to))
        if not references:
            raise MatchesNothing
        parts.extend(Pushdown(hide_superseded=False, references=references).clauses(user_shelf=False))
    return parts


def grouped_filters(filters: GroupedSearchFilters | None) -> dict[str, Any]:
    if filters is None:
        return CURRENT_REVISIONS
    parts: list[dict[str, Any]] = []
    for group in (filters.document_types, filters.disciplines):
        if group:
            parts.append({"tags": {"$in": list(group)}})
    parts.extend(_reading_clauses(filters))
    if filters.project_facts is not None:
        facts = filters.project_facts.to_store()
        for key, value in facts.items():
            values = [value] if isinstance(value, str) else list(value or [])
            if values:
                parts.append({f"project_facts.{key}": {"$in": values}})
    if filters.project_status:
        parts.append({"project_status": {"$in": list(filters.project_status)}})
    if not parts:
        return CURRENT_REVISIONS
    return {"$and": [*parts, CURRENT_REVISIONS]}


MEANING_ONLY_MIN_COSINE = 0.35


def above_meaning_floor(hits: list[DocumentSearchHit]) -> list[DocumentSearchHit]:
    return [hit for hit in hits if hit.lexical is not False or hit.score >= MEANING_ONLY_MIN_COSINE]


WORKSPACE_SEARCH_FEATURE = "workspace-search"
WORKSPACE_SEARCH_STEP = "retrieve.workspace_search"
TRACE_COLLECTION_LIMIT = 50


def _filter_fields(filters: GroupedSearchFilters | None) -> list[str]:
    return sorted(filters.model_dump(exclude_defaults=True, exclude_none=True)) if filters else []


def prefilter_mode(filters: GroupedSearchFilters | None) -> str:
    if filters is not None and filters.document_ids:
        return "document_ids"
    return "payload" if _filter_fields(filters) else "none"


def _trace_query(request: GroupedDocumentSearchRequest, collections: list[str]) -> dict[str, Any]:
    return {
        "text_chars": len(request.query),
        "text_tokens": len(request.query.split()),
        "collections": len(collections),
        "groups": request.groups,
        "files_per_group": request.files_per_group,
        "prefilter": prefilter_mode(request.filters),
        "document_ids": len(request.filters.document_ids) if request.filters else 0,
        "filter_fields": _filter_fields(request.filters),
    }


def _trace_picks(grouped: list[tuple[str, list[Chunk]]], hits: list[DocumentSearchHit]) -> dict[str, Any]:
    per_collection: dict[str, int] = {}
    for hit in hits:
        per_collection[hit.collection] = per_collection.get(hit.collection, 0) + 1
    ranked = sorted(per_collection.items(), key=lambda entry: entry[1], reverse=True)
    return {
        "candidates": sum(len(chunks) for _, chunks in grouped),
        "documents": len(hits),
        "with_document_id": sum(1 for hit in hits if hit.document_id),
        "collections_with_hits": len(per_collection),
        "hits_per_collection": dict(ranked[:TRACE_COLLECTION_LIMIT]),
    }


async def _search_grouped(
    request: GroupedDocumentSearchRequest, collections: list[str]
) -> tuple[list[DocumentSearchHit], list[tuple[str, list[Chunk]]]]:
    from agent.knowledge.factory import get_active_retriever

    try:
        filters = grouped_filters(request.filters)
    except MatchesNothing:
        return [], []
    try:
        grouped = await get_active_retriever().search_grouped(
            request.query,
            collections,
            groups=request.groups,
            group_size=request.files_per_group * GROUP_CHUNKS_PER_FILE,
            filters=filters,
            boost=(
                {"facts": request.boost.facts.to_store(), "weights": request.boost.weights.to_store()}
                if request.boost
                else None
            ),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.exception("Grouped document search failed")
        raise HTTPException(status_code=500, detail="grouped document search failed") from e
    return _ranked_group_hits(grouped, request.files_per_group, request.snippet_max_chars), grouped


async def _workspace_search(request: GroupedDocumentSearchRequest, collections: list[str]) -> list[DocumentSearchHit]:
    mode = prefilter_mode(request.filters)
    with observed_retrieval(
        WORKSPACE_SEARCH_FEATURE,
        step=WORKSPACE_SEARCH_STEP,
        query=_trace_query(request, collections),
        metadata={"prefilter": mode, "collections": len(collections)},
    ) as trace:
        ranked, grouped = await _search_grouped(request, collections)
        hits = above_meaning_floor(ranked)
        picks = {**_trace_picks(grouped, hits), "below_meaning_floor": len(ranked) - len(hits)}
        summary = {key: picks[key] for key in ("candidates", "documents", "below_meaning_floor")}
        trace.finish(picks, {"prefilter": mode, **summary})
    return hits


async def _search_across(
    request: GroupedDocumentSearchRequest, collections: list[str], office_id: str | None
) -> DocumentSearchResponse:
    from knowledge_layer.search import reading_as

    with reading_as(office_id):
        if request.purpose != "workspace_search":
            hits, _ = await _search_grouped(request, collections)
            return DocumentSearchResponse(hits=hits)
        return DocumentSearchResponse(hits=await _workspace_search(request, collections))


async def _retrieve_one(request: DocumentSearchRequest, collection_name: str, office_id: str | None) -> list[Chunk]:
    from knowledge_layer.search import reading_as

    from agent.knowledge.factory import get_active_retriever

    with reading_as(office_id):
        result = await get_active_retriever().retrieve(
            query=request.query, collection_name=collection_name, top_k=request.top_k, filters=None
        )
    return result.chunks


def add_document_search_routes(router: APIRouter):

    @router.post(
        "/v1/collections/search",
        response_model=DocumentSearchResponse,
        tags=["documents"],
        summary="One semantic search ranked across many collections",
    )
    async def search_across_collections(
        request: GroupedDocumentSearchRequest, http_request: Request
    ) -> DocumentSearchResponse:
        collections = list(dict.fromkeys(request.collections))
        for collection in collections:
            _authorize_collection(http_request, collection)
        return await _search_across(request, collections, request_office(http_request))

    @router.post(
        "/v1/collections/{collection_name}/search",
        response_model=DocumentSearchResponse,
        tags=["documents"],
        summary="Semantic document search within a collection",
    )
    async def search_documents(
        collection_name: str,
        request: DocumentSearchRequest,
        http_request: Request,
        ingestor: BaseIngestor = Depends(_require_ingestor),
    ) -> DocumentSearchResponse:
        _authorize_collection(http_request, collection_name)

        await require_collection(ingestor, collection_name)

        try:
            chunks = await _retrieve_one(request, collection_name, request_office(http_request))
            hits = _aggregate_hits(chunks, collection_name, request.top_k_files, request.snippet_max_chars)
            return DocumentSearchResponse(hits=hits)
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Document search failed for collection '{collection_name}': {e}")
            raise HTTPException(status_code=500, detail=str(e))
