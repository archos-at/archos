"""A person's tape on a PDF drawing, served to the BFF (ADR-0182, slice 8).

``POST /v1/internal/drawing-tape`` answers the review view's measure route
(``apps/workspace/bff/drawing-tape/service.ts``): a distance, a path or an
area between points a person clicked, or where the engine snaps those points.
The answer is data (``agent.tools.drawings.tape``), from the same engine call
the ``drawing_measure`` tool renders as text.

The two credentials of ``internal_tools``: the internal token says the caller
is the BFF, the signed envelope says who asked and what they may read. The
file's bytes are found through the BFF's scoped lookup under that envelope.

**The entitlement.** ``drawing_measure`` refuses a call the turn stated no
``pdf`` for, and the generic tools route states nothing. Here the BFF states
it in the body (``stated_kinds``), after checking the ``drawing-measure``
entitlement for the person's session: the same statement, over the same
authenticated channel, a chat turn's context carries (``projectModels``). A
body that states nothing is refused like any other call.
"""

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

#: Where the tape is served; the BFF's ``drawing-tape/service.ts`` posts here.
DRAWING_TAPE_PATH = "/v1/internal/drawing-tape"


class TapeCall(TapeRequest):
    """The tape request, and the kinds of file the BFF states the person's organization may have measured."""

    stated_kinds: list[str] = Field(default_factory=list, max_length=8)


def add_drawing_tape_routes(router: APIRouter) -> None:
    """Add the tape route to the knowledge router."""

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
