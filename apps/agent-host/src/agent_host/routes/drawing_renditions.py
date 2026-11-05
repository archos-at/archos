"""DXF bytes in, the PDF rendition out (ADR-0152).

``POST /v1/renditions/dxf`` is the converter the BFF calls for a DXF, where it
calls Gotenberg for an office file (ADR-0070): the BFF reads the original from
the object store, posts its bytes here, checks that what comes back is a PDF and
stores it as ``_render.pdf``. This route keeps nothing and decides no access;
the BFF has done both. Internal-token only, like every service-to-service route.

The original's name travels in ``x-filename`` (URL-encoded) and becomes the
page's title, never a path. Answers: ``413`` past :data:`MAX_DXF_BYTES`, ``422``
for bytes no reader can open or a drawing with nothing in it, ``504`` when the
page is not drawn within :data:`RENDER_TIMEOUT_S`.
"""

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

#: A whole cadastral community's Katastralmappe is tens of megabytes; an extract is
#: one or two. Past this the BFF's upload ceiling would have refused it anyway.
MAX_DXF_BYTES = 150 * 1024 * 1024

#: Inside the BFF's own 120 s budget for one conversion, so this route answers
#: before the caller gives up on it.
RENDER_TIMEOUT_S = 110.0

#: Renders run here, one at a time (matplotlib's state is global and `render_pdf`
#: holds a lock anyway), not on the default executor every other `to_thread` caller
#: in this process shares. A render that timed out cannot be stopped once it runs,
#: but one still waiting in this queue is cancelled, so stuck requests do not pile up.
_RENDERS = ThreadPoolExecutor(max_workers=1, thread_name_prefix="dxf-render")


def source_name(raw_filename: str | None) -> str:
    """The original's name without any path, or a neutral one."""
    name = PurePosixPath(unquote(raw_filename or "").replace("\\", "/")).name.strip()
    return name[:160] or "DXF-Datei"


def page_title(raw_filename: str | None) -> str:
    """The original's name without its extension or any path, made readable."""
    name = source_name(raw_filename)
    stem = name[: -len(".dxf")] if name.lower().endswith(".dxf") else name
    return " ".join(stem.replace("_", " ").split())[:120] or "DXF-Datei"


def _convert(data: bytes, raw_filename: str | None) -> bytes:
    return render_pdf(read_dxf(data), title=page_title(raw_filename), source_name=source_name(raw_filename))


def add_drawing_rendition_routes(router: APIRouter) -> None:
    """Add the DXF rendition route."""

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
