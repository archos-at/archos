from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import Request
from pydantic import Field

from agent.common.turn_file_kinds import stating
from agent.tools.drawings.tape import TapeRequest
from agent.tools.drawings.tape import run_tape

from .internal_auth import _require_internal_token
from .internal_tools import _turn_headers
from .internal_tools import _verified_context

DRAWING_TAPE_PATH = "/v1/internal/drawing-tape"


class TapeCall(TapeRequest):
    stated_kinds: list[str] = Field(default_factory=list, max_length=8)


def add_drawing_tape_routes(router: APIRouter) -> None:

    @router.post(
        DRAWING_TAPE_PATH,
        tags=["internal"],
        summary="Measure or snap on a page of a PDF drawing for the person the envelope names (internal)",
    )
    async def drawing_tape(call: TapeCall, request: Request) -> dict[str, Any]:
        _require_internal_token(request)
        context = _verified_context(request)
        tape = TapeRequest.model_validate(call.model_dump(exclude={"stated_kinds"}))
        with _turn_headers(request, context), stating(frozenset(call.stated_kinds)):
            answer = await run_tape(tape)
        if "refused" in answer:
            raise HTTPException(status_code=403, detail={"error": answer["refused"]})
        return answer
