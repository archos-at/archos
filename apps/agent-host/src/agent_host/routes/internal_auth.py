import asyncio
import hmac
import logging
import os
from collections.abc import Callable
from typing import Any

from fastapi import HTTPException
from fastapi import Request

from agent.project_context import ORGANIZATION_ID_HEADER

from ..legacy_headers import legacy_name

logger = logging.getLogger(__name__)

_DEV_DEFAULT_TOKEN = "grid-internal-dev-token"
_DEV_APP_ENVS = {"development", "dev", "local"}

_TOKEN_HEADERS: tuple[str, ...] = (legacy_name(b"x-internal-token").decode("ascii"), "x-internal-token")


def _require_internal_token(request: Request) -> None:
    token = os.environ.get("INTERNAL_API_TOKEN")
    if not token:
        raise HTTPException(status_code=403, detail="Forbidden")
    app_env = os.environ.get("APP_ENV", "production").lower()
    if token == _DEV_DEFAULT_TOKEN and app_env not in _DEV_APP_ENVS:
        logger.error(
            "INTERNAL_API_TOKEN is the well-known dev default "
            "('%s') but APP_ENV=%s is not a dev environment - refusing to "
            "serve internal requests. Set a real token in the deployment "
            "environment.",
            _DEV_DEFAULT_TOKEN,
            app_env,
        )
        raise HTTPException(status_code=503, detail="Internal API disabled")
    matched = False
    for name in _TOKEN_HEADERS:
        provided = request.headers.get(name) or ""
        matched |= hmac.compare_digest(provided, token)
    if not matched:
        raise HTTPException(status_code=403, detail="Forbidden")


def internal_office(request: Request) -> str | None:
    from .document_search import request_office

    office = request_office(request)
    if office:
        return office
    try:
        _require_internal_token(request)
    except HTTPException:
        return None
    return (request.headers.get(ORGANIZATION_ID_HEADER) or "").strip() or None


async def read_as_internal_office[T](request: Request, read: Callable[..., T], *args: Any) -> T:
    from knowledge_layer.search import reading_as

    with reading_as(internal_office(request)):
        return await asyncio.to_thread(read, *args)
