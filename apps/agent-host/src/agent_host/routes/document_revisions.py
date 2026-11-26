from __future__ import annotations

import asyncio
import logging
from functools import partial
from typing import Any
from uuid import UUID

import httpx
from fastapi import Depends
from fastapi import Header
from fastapi import HTTPException
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import model_validator

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


def _replaced_by(older: AvailableDocument, newer: AvailableDocument) -> bool:
    if older.superseded_by_id and newer.document_id:
        return older.superseded_by_id == newer.document_id
    return older.superseded_by == newer.file_name


async def _refuse_revision(collection_name: str, newer: AvailableDocument, older: AvailableDocument) -> dict[str, Any]:
    superseded_by, change_summary, change_basis = older.superseded_by, newer.change_summary, newer.change_basis
    if _replaced_by(older, newer):
        lift = partial(set_document_superseded_by, document_id=older.document_id)
        await asyncio.to_thread(lift, collection_name, older.file_name, None)
        superseded_by = None
        if newer.change_basis == older.file_name:
            forget = partial(set_document_change_summary, document_id=newer.document_id)
            await asyncio.to_thread(forget, collection_name, newer.file_name, None, None)
            change_summary = change_basis = None
    dismiss = partial(dismiss_document_revision_suggestion, document_id=newer.document_id, older_id=older.document_id)
    await asyncio.to_thread(dismiss, collection_name, newer.file_name, older.file_name)
    return {"superseded_by": superseded_by, "change_summary": change_summary, "change_basis": change_basis}


class RevisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    newer: str | None = Field(None, min_length=1, max_length=512, description="File name of the newer Fassung.")
    older: str | None = Field(None, min_length=1, max_length=512, description="File name of the Fassung it replaces.")
    newer_id: UUID | None = Field(None, description="Document id of the newer Fassung; wins over `newer`.")
    older_id: UUID | None = Field(None, description="Document id of the Fassung it replaces; wins over `older`.")
    linked: bool = Field(
        ...,
        description="True: a person confirms newer replaces older. False: a person lifts or refuses that.",
    )

    @model_validator(mode="after")
    def _names_each_side(self) -> RevisionRequest:
        if not (self.newer or self.newer_id) or not (self.older or self.older_id):
            raise ValueError("name the newer and the older Fassung, by document id or by file name")
        return self


def pick_document(
    documents: list[AvailableDocument], file_name: str | None, document_id: UUID | None
) -> AvailableDocument | None:
    if document_id is not None:
        wanted = str(document_id)
        found = next((doc for doc in documents if doc.document_id == wanted), None)
        if found is not None or not file_name:
            return found
        return next((doc for doc in documents if doc.file_name == file_name and not doc.document_id), None)
    named = [doc for doc in documents if doc.file_name == file_name]
    if len(named) > 1:
        raise HTTPException(
            status_code=409, detail={"reason": "ambiguous_name", "message": f"More than one '{file_name}'"}
        )
    return named[0] if named else None


async def _linked_revision_response(
    collection_name: str, newer: AvailableDocument, older: AvailableDocument, organization_id: str | None
) -> dict[str, Any]:
    linked = {"superseded_by": newer.file_name, "superseded_by_id": newer.document_id}
    change = await _request_change_summary(older, newer, organization_id)
    if change:
        summarize = partial(set_document_change_summary, document_id=newer.document_id)
        await asyncio.to_thread(summarize, collection_name, newer.file_name, change, older.file_name)
        return {**linked, "change_summary": change, "change_basis": older.file_name}
    return {**linked, "change_summary": newer.change_summary, "change_basis": newer.change_basis}


async def put_revision_route(
    collection_name: str,
    request: RevisionRequest,
    ingestor: BaseIngestor = Depends(_require_ingestor),
    x_grid_organization_id: str | None = Header(default=None),
) -> dict[str, Any]:
    documents = await get_available_documents_async(collection_name)
    newer = pick_document(documents, request.newer, request.newer_id)
    older = pick_document(documents, request.older, request.older_id)
    missing = [
        str(document_id or name)
        for found, name, document_id in (
            (newer, request.newer, request.newer_id),
            (older, request.older, request.older_id),
        )
        if found is None
    ]
    if missing or newer is None or older is None:
        raise HTTPException(
            status_code=404,
            detail=f"No document {missing!r} in collection '{collection_name}'",
        )
    if newer is older:
        raise HTTPException(status_code=400, detail="A file cannot replace itself")

    if not request.linked:
        return await _refuse_revision(collection_name, newer, older)

    link = partial(link_document_revision, older_id=older.document_id, newer_id=newer.document_id)
    outcome = await asyncio.to_thread(link, collection_name, older.file_name, newer.file_name)
    if outcome is LinkOutcome.LOOP:
        raise HTTPException(
            status_code=409,
            detail=f"'{newer.file_name}' is already replaced by '{older.file_name}'; it cannot replace it in turn",
        )
    if outcome is LinkOutcome.MISSING:
        raise _no_summary_404(collection_name, older.file_name)
    return await _linked_revision_response(collection_name, newer, older, x_grid_organization_id)
