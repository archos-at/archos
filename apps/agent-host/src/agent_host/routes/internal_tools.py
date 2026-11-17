from __future__ import annotations

import logging
import os
import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import Request
from pydantic import BaseModel
from pydantic import Field
from pydantic import ValidationError
from pydantic_core import to_jsonable_python

from agent.common.backend_tools import is_backend_read_tool
from agent.common.grounding_block import strip_trace_lanes
from agent.project_context import ORGANIZATION_ID_HEADER
from agent.project_context import PROJECT_ID_HEADER
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_HEADER
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_SIG_HEADER
from agent.project_context import USER_ID_HEADER
from agent.project_context import RequestContext

from ..jobs.access import JOB_ENVELOPE_MAX_AGE_MS
from .builder_state import get_active_builder
from .internal_auth import _require_internal_token

logger = logging.getLogger(__name__)

DOOR_LOOKS_PER_CALL = 1

INTERNAL_TOOL_PATH = "/v1/internal/tools/{name}"


class ToolCall(BaseModel):
    arguments: dict[str, Any] = Field(default_factory=dict)


def _verified_context(request: Request) -> RequestContext:
    secret = os.environ.get("INTERNAL_API_TOKEN")
    context = RequestContext.from_envelope(
        request.headers.get(REQUEST_CONTEXT_ENVELOPE_HEADER),
        request.headers.get(REQUEST_CONTEXT_ENVELOPE_SIG_HEADER),
        secret,
    )
    fresh = (
        context is not None
        and context.issued_at is not None
        and abs(int(time.time() * 1000) - context.issued_at) <= JOB_ENVELOPE_MAX_AGE_MS
    )
    if not secret or context is None or not fresh or not context.user_id or not context.organization_id:
        raise HTTPException(
            status_code=403,
            detail={"error": "context_envelope_required", "detail": "a signed, current request-context envelope"},
        )
    return context


@contextmanager
def _turn_headers(request: Request, context: RequestContext) -> Iterator[None]:
    from starlette.datastructures import Headers

    from nat.plugin_api import ContextState
    from nat.runtime.user_metadata import RequestAttributes

    headers = {
        REQUEST_CONTEXT_ENVELOPE_HEADER: request.headers[REQUEST_CONTEXT_ENVELOPE_HEADER],
        REQUEST_CONTEXT_ENVELOPE_SIG_HEADER: request.headers.get(REQUEST_CONTEXT_ENVELOPE_SIG_HEADER, ""),
        ORGANIZATION_ID_HEADER: context.organization_id or "",
        USER_ID_HEADER: context.user_id or "",
    }
    if context.project_id:
        headers[PROJECT_ID_HEADER] = context.project_id
    attributes = RequestAttributes()
    attributes._request.headers = Headers(headers={name: value for name, value in headers.items() if value})
    state = ContextState.get()
    token = state.metadata.set(attributes)
    try:
        yield
    finally:
        state.metadata.reset(token)


@contextmanager
def _metered_call() -> Iterator[None]:
    from agent.common.cost_tracking import track_llm_costs
    from agent.common.image_view_budget import begin_image_view_budget
    from agent.common.image_view_budget import end_image_view_budget

    token = begin_image_view_budget(limit=DOOR_LOOKS_PER_CALL)
    try:
        with track_llm_costs():
            yield
    finally:
        end_image_view_budget(token)


def _wire(result: Any) -> Any:
    if isinstance(result, str):
        return strip_trace_lanes(result)
    return to_jsonable_python(result, fallback=str)


def add_internal_tool_routes(router: APIRouter) -> None:

    @router.post(
        INTERNAL_TOOL_PATH,
        tags=["internal"],
        summary="Run one of the agent's read tools for the person the envelope names (internal)",
    )
    async def run_tool(name: str, call: ToolCall, request: Request) -> dict[str, Any]:
        _require_internal_token(request)
        if not is_backend_read_tool(name):
            raise HTTPException(status_code=404, detail={"error": "unknown_tool", "tool": name})
        context = _verified_context(request)

        builder = get_active_builder()
        if builder is None:
            raise HTTPException(status_code=503, detail={"error": "workflow_not_ready"})
        try:
            function = await builder.get_function(name)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail={"error": "tool_not_configured", "tool": name}) from exc
        try:
            arguments = function.input_schema.model_validate(call.arguments)
        except ValidationError as exc:
            raise HTTPException(
                status_code=422,
                detail={"error": "invalid_arguments", "tool": name, "issues": exc.errors(include_input=False)},
            ) from exc

        with _turn_headers(request, context), _metered_call():
            try:
                result = await function.ainvoke(arguments)
            except Exception as exc:
                logger.exception("Read tool %s failed for user %s", name, context.user_id)
                raise HTTPException(status_code=502, detail={"error": "tool_failed", "tool": name}) from exc
        return {"tool": name, "result": _wire(result)}
