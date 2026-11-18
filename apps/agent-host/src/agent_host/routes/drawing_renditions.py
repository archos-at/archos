from __future__ import annotations

import asyncio
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import PurePosixPath
from urllib.parse import unquote

from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import Request
from fastapi import Response

from agent.drawings.dxf_source import UnreadableDrawingError
from agent.drawings.dxf_source import read_dxf
from agent_host.drawings.dxf_pdf import EmptyDrawingError
from agent_host.drawings.dxf_pdf import render_pdf

from .internal_auth import _require_internal_token

logger = logging.getLogger(__name__)

DXF_RENDITION_PATH = "/v1/renditions/dxf"

MAX_DXF_BYTES = 150 * 1024 * 1024

RENDER_TIMEOUT_S = 110.0

_RENDERS = ThreadPoolExecutor(max_workers=1, thread_name_prefix="dxf-render")


def source_name(raw_filename: str | None) -> str:
    name = PurePosixPath(unquote(raw_filename or "").replace("\\", "/")).name.strip()
    return name[:160] or "DXF-Datei"


def page_title(raw_filename: str | None) -> str:
    name = source_name(raw_filename)
    stem = name[: -len(".dxf")] if name.lower().endswith(".dxf") else name
    return " ".join(stem.replace("_", " ").split())[:120] or "DXF-Datei"


def _convert(data: bytes, raw_filename: str | None) -> bytes:
    return render_pdf(read_dxf(data), title=page_title(raw_filename), source_name=source_name(raw_filename))


def add_drawing_rendition_routes(router: APIRouter) -> None:

    @router.post(
        DXF_RENDITION_PATH,
        tags=["internal"],
        summary="Draw a DXF file as its PDF rendition (internal)",
        response_class=Response,
    )
    async def render_dxf(request: Request) -> Response:
        _require_internal_token(request)
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > MAX_DXF_BYTES:
            raise HTTPException(status_code=413, detail="The DXF file is too large to draw")
        data = await request.body()
        if len(data) > MAX_DXF_BYTES:
            raise HTTPException(status_code=413, detail="The DXF file is too large to draw")
        started = time.monotonic()
        future = _RENDERS.submit(_convert, data, request.headers.get("x-filename"))
        try:
            pdf = await asyncio.wait_for(asyncio.wrap_future(future), RENDER_TIMEOUT_S)
        except (UnreadableDrawingError, EmptyDrawingError) as error:
            raise HTTPException(status_code=422, detail=str(error)) from None
        except TimeoutError:
            future.cancel()
            raise HTTPException(status_code=504, detail="The drawing took too long to draw") from None
        logger.info("dxf rendition: %d bytes in, %d bytes out, %.1fs", len(data), len(pdf), time.monotonic() - started)
        return Response(content=pdf, media_type="application/pdf")
