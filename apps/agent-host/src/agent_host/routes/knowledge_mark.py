"""Mark one file's points with its licence mark and knowledge edition (office base knowledge).

What a source may be used for (``licence_class``: ``public_open``,
``public_restricted``, ``licensed``), whether the office stated its licence
covers AI processing (``ai_processing_attested``), the longest quote a model
may see (``quote_max_chars``, read by the licensed seam, ADR-0159) and which
knowledge edition it belongs to (``knowledge_edition_id``) are decided by the
platform, which holds them; the
points carry a copy so a search can filter by them in the one query. Ingestion
writes the same fields when its job names them (``vector_store.writes.licence_mark``),
so a re-ingest keeps the mark; this route sets it on a file already indexed.

Internal-token only, as every service-to-service write on this tier: the
caller is the BFF, which decided the mark.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import Request

from ..models.knowledge_mark import KnowledgeMarkResult
from ..models.knowledge_mark import KnowledgeMarkUpdate
from .internal_auth import _require_internal_token

logger = logging.getLogger(__name__)


def _store() -> Any:
    """The process-wide Qdrant store (a test stands in for it here)."""
    from knowledge_layer.vector_store import get_store

    return get_store()


def _mark(collection: str, update: KnowledgeMarkUpdate) -> int | None:
    """Set the mark on the file's chunks; their number, or None when the collection holds no chunk of the file."""
    from knowledge_layer.vector_store import AI_PROCESSING_FIELD
    from knowledge_layer.vector_store import COUNTRY_FIELD
    from knowledge_layer.vector_store import KNOWLEDGE_EDITION_FIELD
    from knowledge_layer.vector_store import LICENCE_CLASS_FIELD
    from knowledge_layer.vector_store import QUOTE_MAX_CHARS_FIELD

    store = _store()
    if not store.exists(collection):
        return None
    chunks = store.count(collection, {"file_name": update.file_name})
    if not chunks:
        return None
    licence = {
        LICENCE_CLASS_FIELD: update.licence_class,
        AI_PROCESSING_FIELD: update.ai_processing_attested,
        QUOTE_MAX_CHARS_FIELD: update.quote_max_chars,
        KNOWLEDGE_EDITION_FIELD: update.edition_id,
    }
    named = update.model_fields_set
    # The licence mark is one statement: naming any of it sets all four, None clearing. A base-corpus
    # text's country travels alone and leaves the licence fields as they are (ADR-0173).
    payload = (
        dict(licence) if named & {"licence_class", "ai_processing_attested", "quote_max_chars", "edition_id"} else {}
    )
    if "country_id" in named:
        payload[COUNTRY_FIELD] = update.country_id
    store.set_file_payloads(collection, {update.file_name: payload})
    _remember_corpus_country(collection, update)
    return chunks


def _remember_corpus_country(collection: str, update: KnowledgeMarkUpdate) -> None:
    """A base-corpus text's country also goes on its corpus row, so a re-ingest stamps it again (ADR-0173)."""
    from agent import corpus_store
    from agent.oib_sync import COLLECTION_NAME

    if collection != COLLECTION_NAME or "country_id" not in update.model_fields_set:
        return
    current = corpus_store.get_mark(update.file_name) or corpus_store.FileMark()
    edition = update.edition_id if "edition_id" in update.model_fields_set else current.edition_id
    corpus_store.set_mark(update.file_name, corpus_store.FileMark(country_id=update.country_id, edition_id=edition))


def add_knowledge_mark_routes(router: APIRouter) -> None:
    """Add the knowledge-mark route to the FastAPI app."""

    @router.put(
        "/v1/collections/{collection_name}/knowledge-mark",
        response_model=KnowledgeMarkResult,
        tags=["collections"],
        summary="Set a file's licence class and knowledge edition on every one of its chunks",
    )
    async def put_knowledge_mark(
        collection_name: str, request: KnowledgeMarkUpdate, http_request: Request
    ) -> KnowledgeMarkResult:
        """Overwrite the licence mark and ``knowledge_edition_id`` on every chunk of the file.

        403 without the internal token. 422 for a licence class outside the
        three. 404 when the collection holds no chunk of the file. 409 when
        this process has no Qdrant store installed, 502 when the store
        refuses. Idempotent: the same body twice writes the same payload.
        """
        _require_internal_token(http_request)
        try:
            from knowledge_layer.vector_store import get_store  # noqa: F401
        except ImportError as e:  # the knowledge layer's store extra is not installed here
            raise HTTPException(status_code=409, detail="this deployment has no Qdrant store") from e
        try:
            chunks = await asyncio.to_thread(_mark, collection_name, request)
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
            chunks=chunks,
        )
