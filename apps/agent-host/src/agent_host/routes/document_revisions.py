import asyncio
import logging
from typing import Any

import httpx
from fastapi import Depends
from fastapi import Header
from fastapi import HTTPException
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field

from agent.common import provider_limiter
from agent.common.openrouter import limited_async_http_client
from agent.knowledge import dismiss_document_revision_suggestion
from agent.knowledge import get_available_documents_async
from agent.knowledge import link_document_revision
from agent.knowledge import set_document_change_summary
from agent.knowledge import set_document_superseded_by
from agent.knowledge.base import BaseIngestor
from agent.knowledge.document_metadata_store import LinkOutcome
from agent.knowledge.document_revisions import RevisionDocument
from agent.knowledge.document_revisions import build_change_prompt
from agent.knowledge.document_revisions import parse_change_summary
from agent.knowledge.document_revisions import settled_change
from agent.knowledge.schema import AvailableDocument
from agent.observability.direct_trace import observed_generation

from .collections import _require_ingestor
from .document_edits import _no_summary_404
from .generate_summary import _llm_settings

logger = logging.getLogger(__name__)


async def _request_change_summary(
    older: AvailableDocument, newer: AvailableDocument, organization_id: str | None
) -> str | None:
    before = RevisionDocument(
        file_name=older.file_name, summary=older.summary or "", doc_class=older.doc_class, tags=tuple(older.tags or ())
    )
    after = RevisionDocument(
        file_name=newer.file_name, summary=newer.summary or "", doc_class=newer.doc_class, tags=tuple(newer.tags or ())
    )
    settled, answer = settled_change(before, after)
    if settled:
        return answer
    cred = await asyncio.to_thread(_llm_settings, organization_id)
    if not cred.api_key:
        return None
    payload = cred.request_body(
        {
            "model": cred.model,
            "temperature": 0,
            "max_tokens": 400,
            "messages": [{"role": "user", "content": build_change_prompt(before, after)}],
        }
    )
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {cred.api_key}"}
    try:
        async with (
            observed_generation("change-summary", model=cred.model, messages=payload.get("messages")) as generation,
            limited_async_http_client(cls=provider_limiter.INTERACTIVE, timeout=30.0) as client,
        ):
            response = await client.post(f"{cred.base_url}/chat/completions", json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            generation.finish(data)
        return parse_change_summary(data["choices"][0]["message"]["content"] or "")
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
        logger.warning("Change summary request failed: %s", type(exc).__name__)
        return None


async def _refuse_revision(collection_name: str, newer: AvailableDocument, older: AvailableDocument) -> dict[str, Any]:
    superseded_by, change_summary, change_basis = older.superseded_by, newer.change_summary, newer.change_basis
    if older.superseded_by == newer.file_name:
        await asyncio.to_thread(set_document_superseded_by, collection_name, older.file_name, None)
        superseded_by = None
        if newer.change_basis == older.file_name:
            await asyncio.to_thread(set_document_change_summary, collection_name, newer.file_name, None, None)
            change_summary = change_basis = None
    await asyncio.to_thread(dismiss_document_revision_suggestion, collection_name, newer.file_name, older.file_name)
    return {"superseded_by": superseded_by, "change_summary": change_summary, "change_basis": change_basis}


class RevisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    newer: str = Field(..., min_length=1, max_length=512, description="File name of the newer Fassung.")
    older: str = Field(..., min_length=1, max_length=512, description="File name of the Fassung it replaces.")
    linked: bool = Field(
        ...,
        description="True: a person confirms newer replaces older. False: a person lifts or refuses that.",
    )


async def _linked_revision_response(
    collection_name: str,
    request: RevisionRequest,
    newer: AvailableDocument,
    older: AvailableDocument,
    organization_id: str | None,
) -> dict[str, Any]:
    change = await _request_change_summary(older, newer, organization_id)
    if change:
        await asyncio.to_thread(set_document_change_summary, collection_name, request.newer, change, request.older)
        return {"superseded_by": request.newer, "change_summary": change, "change_basis": request.older}
    return {
        "superseded_by": request.newer,
        "change_summary": newer.change_summary,
        "change_basis": newer.change_basis,
    }


async def put_revision_route(
    collection_name: str,
    request: RevisionRequest,
    ingestor: BaseIngestor = Depends(_require_ingestor),
    x_grid_organization_id: str | None = Header(default=None),
) -> dict[str, Any]:
    if request.newer == request.older:
        raise HTTPException(status_code=400, detail="A file cannot replace itself")
    documents = {doc.file_name: doc for doc in await get_available_documents_async(collection_name)}
    missing = [name for name in (request.newer, request.older) if name not in documents]
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"No document {missing!r} in collection '{collection_name}'",
        )
    newer, older = documents[request.newer], documents[request.older]

    if not request.linked:
        return await _refuse_revision(collection_name, newer, older)

    outcome = await asyncio.to_thread(link_document_revision, collection_name, request.older, request.newer)
    if outcome is LinkOutcome.LOOP:
        raise HTTPException(
            status_code=409,
            detail=f"'{request.newer}' is already replaced by '{request.older}'; it cannot replace it in turn",
        )
    if outcome is LinkOutcome.MISSING:
        raise _no_summary_404(collection_name, request.older)
    return await _linked_revision_response(collection_name, request, newer, older, x_grid_organization_id)
