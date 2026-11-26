from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from dataclasses import replace
from typing import Any

from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import Request

from ..models.knowledge_mark import KnowledgeMarkResult
from ..models.knowledge_mark import KnowledgeMarkUpdate
from .internal_auth import _require_internal_token

logger = logging.getLogger(__name__)


def _store() -> Any:
    from knowledge_layer.vector_store import get_store

    return get_store()


def _mark(collection: str, update: KnowledgeMarkUpdate) -> int | None:
    from knowledge_layer.vector_store import AI_PROCESSING_FIELD
    from knowledge_layer.vector_store import COUNTRY_FIELD
    from knowledge_layer.vector_store import KNOWLEDGE_EDITION_FIELD
    from knowledge_layer.vector_store import LICENCE_CLASS_FIELD
    from knowledge_layer.vector_store import QUOTE_MAX_CHARS_FIELD
    from knowledge_layer.vector_store import RELEASED_FIELD

    remembered = _remember_corpus_country(collection, update)
    store = _store()
    marked = _marked_document(store, collection, update)
    chunks = store.count(collection, marked.counted()) if store.exists(collection) else 0
    if not chunks:
        return 0 if remembered else None
    licence = {
        LICENCE_CLASS_FIELD: update.licence_class,
        AI_PROCESSING_FIELD: update.ai_processing_attested,
        QUOTE_MAX_CHARS_FIELD: update.quote_max_chars,
        KNOWLEDGE_EDITION_FIELD: update.edition_id,
    }
    named = update.model_fields_set
    payload = (
        dict(licence) if named & {"licence_class", "ai_processing_attested", "quote_max_chars", "edition_id"} else {}
    )
    if "country_id" in named:
        payload[COUNTRY_FIELD] = update.country_id
    if "released" in named:
        payload[RELEASED_FIELD] = update.released
    if marked.document_id:
        store.set_file_payloads(collection, {marked.document_id: payload}, key="document_id")
    if marked.file_name:
        store.set_file_payloads(collection, {marked.file_name: payload}, key="file_name")
    return chunks


class AmbiguousMark(Exception): ...


@dataclass(frozen=True)
class _Marked:
    document_id: str | None
    file_name: str | None

    def counted(self) -> dict[str, Any]:
        by_id, by_name = {"document_id": self.document_id}, {"file_name": self.file_name}
        if self.document_id and self.file_name:
            return {"$or": [by_id, by_name]}
        return by_id if self.document_id else by_name


def _marked_document(store: Any, collection: str, update: KnowledgeMarkUpdate) -> _Marked:
    from knowledge_layer.vector_store import DOCUMENT_ID_FIELD

    holders = (
        set(store.facet_counts(collection, DOCUMENT_ID_FIELD, {"file_name": update.file_name}))
        if store.exists(collection)
        else set()
    )
    if update.document_id is not None:
        document_id = str(update.document_id)
        return _Marked(document_id, update.file_name if holders <= {document_id} else None)
    if len(holders) > 1:
        raise AmbiguousMark(update.file_name)
    return _Marked(next(iter(holders), None), update.file_name)


def _remember_corpus_country(collection: str, update: KnowledgeMarkUpdate) -> bool:
    from agent import corpus_store
    from agent.common.source_kinds import current_collection
    from agent.oib_sync import COLLECTION_NAME

    named = update.model_fields_set
    if current_collection(collection) != COLLECTION_NAME or not named & {"country_id", "released"}:
        return False
    current = corpus_store.get_mark(update.file_name) or corpus_store.FileMark()
    changed = {field: getattr(update, field) for field in ("country_id", "edition_id", "released") if field in named}
    corpus_store.set_mark(update.file_name, replace(current, **changed))
    return True


def add_knowledge_mark_routes(router: APIRouter) -> None:

    @router.put(
        "/v1/collections/{collection_name}/knowledge-mark",
        response_model=KnowledgeMarkResult,
        tags=["collections"],
        summary="Set a file's licence class and knowledge edition on every one of its chunks",
    )
    async def put_knowledge_mark(
        collection_name: str, request: KnowledgeMarkUpdate, http_request: Request
    ) -> KnowledgeMarkResult:
        _require_internal_token(http_request)
        try:
            from knowledge_layer.vector_store import get_store  # noqa: F401
        except ImportError as e:  # the knowledge layer's store extra is not installed here
            raise HTTPException(status_code=409, detail="this deployment has no Qdrant store") from e
        try:
            chunks = await asyncio.to_thread(_mark, collection_name, request)
        except AmbiguousMark:
            raise HTTPException(
                status_code=409,
                detail={"reason": "ambiguous_name", "message": f"More than one document is '{request.file_name}'"},
            ) from None
        except Exception as e:
            logger.exception("Marking %s in %s failed", request.file_name, collection_name)
            raise HTTPException(status_code=502, detail="the vector store refused the knowledge mark") from e
        if chunks is None:
            raise HTTPException(status_code=404, detail=f"No chunks of '{request.file_name}' in '{collection_name}'")
        return KnowledgeMarkResult(
            collection=collection_name,
            file_name=request.file_name,
            licence_class=request.licence_class,
            edition_id=request.edition_id,
            released=request.released,
            chunks=chunks,
        )
