from __future__ import annotations

import logging
from collections.abc import Awaitable
from collections.abc import Callable

from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import Query
from fastapi import Request
from fastapi import Response
from pydantic import BaseModel
from pydantic import Field

from agent.tools.documents import draft_store
from agent.tools.documents.draft_store import BASE64
from agent.tools.documents.draft_store import FILED_AT_DRAFT_VERSION_KEY
from agent.tools.documents.draft_store import MAX_DRAFT_BYTES
from agent.tools.documents.draft_store import PREVIOUS_VERSION_KEY
from agent.tools.documents.draft_store import VERSION_KEY
from agent.tools.documents.draft_store import DraftBackend
from agent.tools.documents.draft_store import delete_conversation_drafts
from agent.tools.documents.draft_store import derived_from_value
from agent.tools.documents.draft_store import draft_bytes
from agent.tools.documents.draft_store import draft_namespace
from agent.tools.documents.draft_store import filing_from_value
from agent.tools.documents.draft_store import filing_record
from agent.tools.documents.draft_store import modernize_draft_path
from agent.tools.documents.draft_store import path_refusal
from agent.tools.documents.draft_store import previous_bytes
from agent.tools.documents.draft_store import stored_bytes
from agent.tools.documents.draft_store import stored_size

from .internal_auth import _require_internal_token

logger = logging.getLogger(__name__)

_LIST_PAGE_SIZE = 100


class FilingBody(BaseModel):
    document_id: str = Field(alias="documentId", min_length=1, max_length=64)
    version_id: str = Field(alias="versionId", min_length=1, max_length=64)
    content_hash: str = Field(alias="contentHash", min_length=1, max_length=128)
    state: str = Field(min_length=1, max_length=40)
    draft_version: int | None = Field(default=None, alias="draftVersion", ge=1)


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
        answer["filed_at_version"] = int(item.value.get(FILED_AT_DRAFT_VERSION_KEY) or 0)
    if item.value.get(PREVIOUS_VERSION_KEY):
        answer["previous_version"] = int(item.value[PREVIOUS_VERSION_KEY])
    derived = derived_from_value(item.value)
    if derived:
        answer["derived_from"] = derived
    return answer


async def _raw_draft(conversation_id: str, draft_path: str, version: int | None = None) -> Response:
    store = await draft_store.get_draft_store()
    item = await store.aget(draft_namespace(conversation_id), draft_path)
    if item is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    current = int(item.value.get(VERSION_KEY) or 0)
    if version is None or version == current:
        data = stored_bytes(item.value)
    elif version == int(item.value.get(PREVIOUS_VERSION_KEY) or 0):
        data = previous_bytes(item.value)
    else:
        raise HTTPException(status_code=410, detail="This version of the draft is no longer kept")
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"x-draft-version": str(version or current), "x-draft-current-version": str(current)},
    )


async def _backend(conversation_id: str) -> DraftBackend:
    return DraftBackend(store=await draft_store.get_draft_store(), conversation_id=conversation_id)


async def _guarded[T](conversation_id: str, action: str, work: Callable[[], Awaitable[T]]) -> T:
    try:
        return await work()
    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to %s in the working directory of conversation %s", action, conversation_id)
        raise HTTPException(status_code=500, detail=f"Failed to {action}")


async def _record_filing(conversation_id: str, draft_path: str, body: FilingBody) -> dict:
    backend = await _backend(conversation_id)
    usage = await backend.ausage(draft_path)
    if usage.content is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    record = filing_record(body.model_dump(by_alias=True))
    version = body.draft_version
    filed_at = version if version is not None and version <= usage.version else usage.version
    await backend.arecord_filing(draft_path, record, draft_version=filed_at)
    return {"path": draft_path, "filed_at_version": filed_at, "version": usage.version}


async def _restore(conversation_id: str, draft_path: str) -> dict:
    version = await (await _backend(conversation_id)).arestore_previous(draft_path)
    if version is None:
        raise HTTPException(status_code=404, detail="No earlier version of this draft is kept")
    return {"path": draft_path, "version": version}


async def _remove(conversation_id: str, draft_path: str) -> Response:
    if not await (await _backend(conversation_id)).aremove(draft_path):
        raise HTTPException(status_code=404, detail="Draft not found")
    return Response(status_code=204)


async def _read_one(conversation_id: str, draft_path: str, *, raw: bool, version: int | None = None) -> dict | Response:
    try:
        if raw:
            return await _raw_draft(conversation_id, draft_path, version)
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
        _require_internal_token(request)
        try:
            await delete_conversation_drafts(conversation_id)
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

    _add_one_draft_routes(router)
    _add_read_route(router)


def _add_one_draft_routes(router: APIRouter) -> None:
    @router.put(
        "/v1/drafts/{conversation_id}/filing",
        tags=["drafts"],
        summary="Record that a draft was filed into the project, so every path sees one filing (internal)",
    )
    async def record_filing(
        conversation_id: str,
        request: Request,
        body: FilingBody,
        path: str = Query(description="Draft path, e.g. /drafts/raumbuch.xlsx"),
    ) -> dict:
        _require_internal_token(request)
        _checked_conversation_id(conversation_id)
        draft_path = _checked_draft_path(path)
        return await _guarded(
            conversation_id, "record a filing", lambda: _record_filing(conversation_id, draft_path, body)
        )

    @router.post(
        "/v1/drafts/{conversation_id}/restore",
        tags=["drafts"],
        summary="Make a draft's earlier version its next version (internal)",
    )
    async def restore_draft(
        conversation_id: str,
        request: Request,
        path: str = Query(description="Draft path, e.g. /drafts/raumbuch.xlsx"),
    ) -> dict:
        _require_internal_token(request)
        _checked_conversation_id(conversation_id)
        draft_path = _checked_draft_path(path)
        return await _guarded(conversation_id, "restore a draft", lambda: _restore(conversation_id, draft_path))

    @router.delete(
        "/v1/drafts/{conversation_id}/{file_path:path}",
        status_code=204,
        response_class=Response,
        tags=["drafts"],
        summary="Delete one draft of a conversation (internal)",
    )
    async def delete_draft(conversation_id: str, file_path: str, request: Request) -> Response:
        _require_internal_token(request)
        _checked_conversation_id(conversation_id)
        draft_path = _checked_draft_path(file_path)
        return await _guarded(conversation_id, "delete a draft", lambda: _remove(conversation_id, draft_path))


def _add_read_route(router: APIRouter) -> None:
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
        version: int | None = Query(
            default=None, ge=1, description="With raw: the version to answer, the current one or the one kept before it"
        ),
    ) -> dict | Response:
        _require_internal_token(request)
        _checked_conversation_id(conversation_id)
        return await _read_one(conversation_id, _checked_draft_path(file_path), raw=raw, version=version)
