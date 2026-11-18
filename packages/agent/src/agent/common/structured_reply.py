from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel

from agent.common.llm_factory import strict_json_response_format
from agent.common.message_utils import content_to_text
from agent.common.prompt_caching import one_shot_calls

logger = logging.getLogger(__name__)

_PARAMETER_REJECTION_STATUSES = frozenset({400, 422})


def _rejects_response_format(exc: BaseException) -> bool:
    status = getattr(exc, "status_code", None)
    if status is None:
        status = getattr(getattr(exc, "response", None), "status_code", None)
    return status in _PARAMETER_REJECTION_STATUSES


async def structured_reply(llm: Any, messages: list[Any], schema: type[BaseModel]) -> str:
    response = await structured_response(llm, messages, schema)
    return content_to_text(getattr(response, "content", response))


async def structured_response(llm: Any, messages: list[Any], schema: type[BaseModel]) -> Any:
    try:
        with one_shot_calls():
            response = await _ask_for_json(llm, messages, schema)
    except Exception as exc:  # noqa: BLE001 - re-raised unless it is the provider rejecting a parameter
        if not _rejects_response_format(exc):
            raise
        logger.warning(
            "%s call rejected even without response_format (%s); retrying with caching as usual", schema.__name__, exc
        )
        response = await _ask_for_json(llm, messages, schema)
    return response


async def _ask_for_json(llm: Any, messages: list[Any], schema: type) -> Any:
    try:
        return await llm.bind(response_format=strict_json_response_format(schema)).ainvoke(messages)
    except Exception as exc:  # noqa: BLE001 - re-raised unless it is the provider rejecting the parameter
        if not _rejects_response_format(exc):
            raise
        logger.warning("%s response_format rejected by the provider (%s); retrying without it", schema.__name__, exc)
        return await llm.ainvoke(messages)
