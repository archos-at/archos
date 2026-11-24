from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import Request
from pydantic import Field

from agent.common.turn_file_kinds import stating
from agent.tools.drawings.snap_targets import SnapTargetsRequest
from agent.tools.drawings.snap_targets import run_snap_targets

from .internal_auth import _require_internal_token
from .internal_tools import _turn_headers
from .internal_tools import _verified_context

DRAWING_SNAP_TARGETS_PATH = "/v1/internal/drawing-snap-targets"


class SnapTargetsCall(SnapTargetsRequest):
    stated_kinds: list[str] = Field(default_factory=list, max_length=8)


def add_drawing_snap_targets_routes(router: APIRouter) -> None:

    @router.post(
        DRAWING_SNAP_TARGETS_PATH,
        tags=["internal"],
        summary="List the line ends, corners and lines of a page of a PDF drawing to snap to (internal)",
    )
    async def drawing_snap_targets(call: SnapTargetsCall, request: Request) -> dict[str, Any]:
        _require_internal_token(request)
        context = _verified_context(request)
        asked = SnapTargetsRequest.model_validate(call.model_dump(exclude={"stated_kinds"}))
        with _turn_headers(request, context), stating(frozenset(call.stated_kinds)):
            answer = await run_snap_targets(asked)
        if "refused" in answer:
            raise HTTPException(status_code=403, detail={"error": answer["refused"]})
        return answer
