from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from pydantic import BaseModel
from pydantic import ConfigDict

from ..mail import limits
from ..mail.models import MailRead
from ..mail.models import UnreadableReason
from ..mail.read import read_message_within
from ..object_store_url import ObjectStoreUrl
from ..object_store_url import object_store_request_url
from .internal_auth import _require_internal_token

logger = logging.getLogger(__name__)


class MailReadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file_ref: ObjectStoreUrl


class MessageTooLargeError(Exception): ...


def add_mail_routes(router: APIRouter) -> None:

    @router.post(
        "/v1/mail/read",
        tags=["platform"],
        summary="What one raw mail message says: own text, quoted blocks, calendar",
        dependencies=[Depends(_require_internal_token)],
    )
    async def read_mail(request: MailReadRequest) -> MailRead:
        try:
            raw = await fetch_message(object_store_request_url(request.file_ref, field="file_ref"))
        except MessageTooLargeError:
            return MailRead.unread(UnreadableReason.MESSAGE_TOO_LARGE)
        except httpx.HTTPError as error:
            logger.warning("mail read: object store fetch failed: %s", type(error).__name__)
            raise HTTPException(status_code=502, detail="The message could not be read from storage.") from error
        return await read_message_within(raw)


async def fetch_message(url: str, transport: httpx.AsyncBaseTransport | None = None) -> bytes:
    timeout = httpx.Timeout(limits.FETCH_TIMEOUT_SECONDS, connect=10.0)
    async with (
        httpx.AsyncClient(timeout=timeout, trust_env=False, follow_redirects=False, transport=transport) as client,
        client.stream("GET", url) as response,
    ):
        response.raise_for_status()
        declared = response.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > limits.MAX_MESSAGE_BYTES:
            raise MessageTooLargeError
        return await _read_capped(response)


async def _read_capped(response: httpx.Response) -> bytes:
    chunks: list[bytes] = []
    size = 0
    async for chunk in response.aiter_bytes():
        size += len(chunk)
        if size > limits.MAX_MESSAGE_BYTES:
            raise MessageTooLargeError
        chunks.append(chunk)
    return b"".join(chunks)
