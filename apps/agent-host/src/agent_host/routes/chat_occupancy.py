import asyncio

from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import Request

from agent.common import turn_admission

from .internal_auth import _require_internal_token

CHAT_OCCUPANCY_PATH = "/v1/internal/chat-occupancy"


def add_chat_occupancy_routes(router: APIRouter) -> None:

    @router.get(
        CHAT_OCCUPANCY_PATH,
        tags=["internal"],
        summary="Chat turns running across the fleet (internal)",
    )
    async def chat_occupancy(request: Request) -> dict[str, int]:
        _require_internal_token(request)
        active = await asyncio.to_thread(turn_admission.active_turns)
        if active is None:
            raise HTTPException(status_code=503, detail="Active-turn count unavailable")
        return {"activeTurns": active, "maxActiveTurns": max(turn_admission.MAX_ACTIVE_TURNS, 0)}
