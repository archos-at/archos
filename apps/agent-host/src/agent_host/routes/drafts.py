from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import Query
from fastapi import Request
from fastapi import Response

from agent.tools.documents import draft_store
from agent.tools.documents.draft_store import BASE64
from agent.tools.documents.draft_store import MAX_DRAFT_BYTES
from agent.tools.documents.draft_store import VERSION_KEY
from agent.tools.documents.draft_store import delete_conversation_drafts
from agent.tools.documents.draft_store import draft_bytes
from agent.tools.documents.draft_store import draft_namespace
from agent.tools.documents.draft_store import filing_from_value
from agent.tools.documents.draft_store import modernize_draft_path
from agent.tools.documents.draft_store import path_refusal
from agent.tools.documents.draft_store import stored_bytes
from agent.tools.documents.draft_store import stored_size
from agent.tools.execute.tool_data import delete_conversation_tool_data

from .internal_auth import _require_internal_token

logger = logging.getLogger(__name__)

_LIST_PAGE_SIZE = 100

_MAX_CONVERSATION_ID_LENGTH = 200


def _checked_conversation_id(conversation_id: str) -> str:
    if (
        not conversation_id
        or not conversation_id.strip()
        or len(conversation_id) > _MAX_CONVERSATION_ID_LENGTH
        or conversation_id in (".", "..")
        or ".." in conversation_id
        or "/" in conversation_id
        or "\\" in conversation_id
    ):
        raise HTTPException(status_code=400, detail="Invalid conversation id")
    return conversation_id


def _internal_conversation(request: Request, conversation_id: str) -> str:
    _require_internal_token(request)
    return _checked_conversation_id(conversation_id)


def _checked_draft_path(path: str) -> str:
    path = modernize_draft_path(path)
    candidate = path if path.startswith("/") else f"/{path}"
    if path_refusal(candidate) is not None:
        raise HTTPException(status_code=400, detail="Invalid draft path")
    return candidate


def _item_content(value: dict) -> str:
    raw = value.get("content")
    return "\n".join(raw) if isinstance(raw, list) else str(raw or "")


async def _list_drafts(conversation_id: str) -> list[dict]:
    store = await draft_store.get_draft_store()
    namespace = draft_namespace(conversation_id)
    entries: list[dict] = []
    offset = 0
    while True:
        page = await store.asearch(namespace, limit=_LIST_PAGE_SIZE, offset=offset)
        for item in page:
            entries.append(
                {
                    "path": str(item.key),
                    "bytes": stored_size(item.value),
                    "version": int(item.value.get(VERSION_KEY) or 0),
                    "encoding": str(item.value.get("encoding") or "utf-8"),
                }
            )
        if len(page) < _LIST_PAGE_SIZE:
            break
        offset += _LIST_PAGE_SIZE
    entries.sort(key=lambda entry: str(entry["path"]))
    return entries


async def _read_draft(conversation_id: str, draft_path: str) -> dict:
    store = await draft_store.get_draft_store()
    namespace = draft_namespace(conversation_id)
    item = await store.aget(namespace, draft_path)
    if item is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    version = int(item.value.get(VERSION_KEY) or 0)
    if item.value.get("encoding") == BASE64:
        answer: dict = {"path": draft_path, "encoding": BASE64, "bytes": stored_size(item.value), "version": version}
    else:
        content = _item_content(item.value)
        if draft_bytes(content) > MAX_DRAFT_BYTES:
            raise HTTPException(status_code=413, detail="Draft exceeds the readable size")
        answer = {"path": draft_path, "content": content, "version": version}
    filing = filing_from_value(item.value)
    if filing:
        answer["filing"] = filing
    return answer


async def _raw_draft(conversation_id: str, draft_path: str) -> Response:
    store = await draft_store.get_draft_store()
    item = await store.aget(draft_namespace(conversation_id), draft_path)
    if item is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    return Response(content=stored_bytes(item.value), media_type="application/octet-stream")


async def _read_one(conversation_id: str, draft_path: str, *, raw: bool) -> dict | Response:
    try:
        if raw:
            return await _raw_draft(conversation_id, draft_path)
        return await _read_draft(conversation_id, draft_path)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to read the working directory of conversation %s", conversation_id)
        raise HTTPException(status_code=500, detail="Failed to read drafts")


def add_draft_routes(router: APIRouter) -> None:

    @router.delete(
        "/v1/drafts/{conversation_id}",
        status_code=204,
        response_class=Response,
        tags=["drafts"],
        summary="Drop one conversation's working directory (internal)",
    )
    async def delete_drafts(conversation_id: str, request: Request) -> Response:
        conversation_id = _internal_conversation(request, conversation_id)
        try:
            await delete_conversation_drafts(conversation_id)
            await delete_conversation_tool_data(conversation_id)
        except Exception:
            logger.exception("Failed to drop the working directory of conversation %s", conversation_id)
            raise HTTPException(status_code=500, detail="Failed to delete drafts")
        return Response(status_code=204)

    @router.get(
        "/v1/drafts/{conversation_id}",
        tags=["drafts"],
        summary="List one conversation's drafts, or read one via ?path= (internal)",
    )
    async def list_drafts(
        conversation_id: str,
        request: Request,
        path: str | None = Query(default=None, description="Draft path to read, e.g. /drafts/befund.md"),
    ) -> dict:
        _require_internal_token(request)
        _checked_conversation_id(conversation_id)
        draft_path = _checked_draft_path(path) if path is not None else None
        try:
            if draft_path is not None:
                return await _read_draft(conversation_id, draft_path)
            drafts = await _list_drafts(conversation_id)
        except HTTPException:
            raise
        except Exception:
            logger.exception("Failed to read the working directory of conversation %s", conversation_id)
            raise HTTPException(status_code=500, detail="Failed to read drafts")
        if not drafts:
            raise HTTPException(status_code=404, detail="No drafts for this conversation")
        return {"conversation_id": conversation_id, "drafts": drafts}

    @router.get(
        "/v1/drafts/{conversation_id}/{file_path:path}",
        tags=["drafts"],
        summary="Read one conversation's draft by path suffix, or its bytes with ?raw=true (internal)",
        response_model=None,
    )
    async def read_draft(
        conversation_id: str,
        file_path: str,
        request: Request,
        raw: bool = Query(default=False, description="Answer the file's bytes instead of its JSON preview"),
    ) -> dict | Response:
        _require_internal_token(request)
        _checked_conversation_id(conversation_id)
        return await _read_one(conversation_id, _checked_draft_path(file_path), raw=raw)
