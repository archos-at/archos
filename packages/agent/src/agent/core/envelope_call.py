from __future__ import annotations

import logging
from typing import Any

from agent.common.answer_envelope import render_envelope_response_format

logger = logging.getLogger(__name__)

_ENVELOPE_RESPONSE_FORMATS: tuple[dict[str, Any], ...] = (
    render_envelope_response_format(),
    {"type": "json_object"},
)

_PARAMETER_REJECTION_STATUSES = frozenset({400, 422})


def is_parameter_rejection(exc: BaseException) -> bool:
    status = getattr(exc, "status_code", None)
    if status is None:
        status = getattr(getattr(exc, "response", None), "status_code", None)
    return status in _PARAMETER_REJECTION_STATUSES


def _fall_through(exc: BaseException, response_format: dict[str, Any]) -> None:
    if not is_parameter_rejection(exc):
        raise exc
    logger.warning(
        "Envelope response_format %s rejected by the provider (%s); falling back",
        response_format.get("type"),
        str(exc).split("\n")[0],
    )


async def ainvoke(llm: Any, messages: list[Any], config: Any = None) -> Any:
    return await (llm.ainvoke(messages) if config is None else llm.ainvoke(messages, config))


async def ainvoke_with_envelope_json_mode(llm: Any, messages: list[Any], config: Any = None) -> Any:
    for response_format in _ENVELOPE_RESPONSE_FORMATS:
        try:
            return await ainvoke(llm.bind(response_format=response_format), messages, config)
        except Exception as exc:  # noqa: BLE001 - re-raised unless it is the provider rejecting the parameter
            _fall_through(exc, response_format)
    return await ainvoke(llm, messages, config)


NO_TOOL_CALLS = "none"


async def ainvoke_synthesis(binding: Any, messages: list[Any], live: Any, json_mode_with_tools: bool = False) -> Any:
    from agent.turn.answer_stream import streaming_call

    answering, config = streaming_call(binding.llm_with_tools.bind(tool_choice=NO_TOOL_CALLS), live=live)
    invoke = ainvoke_with_envelope_json_mode if json_mode_with_tools else ainvoke
    try:
        response = await invoke(answering, messages, config)
    except Exception as exc:  # noqa: BLE001 - re-raised unless it is the provider rejecting tool_choice
        if not is_parameter_rejection(exc):
            raise
        logger.warning("Forced synthesis: tool_choice=none rejected (%s); answering tool-free", exc)
        response = None
    calls = [*(getattr(response, "tool_calls", None) or []), *(getattr(response, "invalid_tool_calls", None) or [])]
    if response is not None and not calls:
        return response
    if calls:
        logger.warning("Forced synthesis: tool_choice=none was ignored (%d call(s)); answering tool-free", len(calls))
    answering, config = streaming_call(binding.llm, live=live)
    return await ainvoke_with_envelope_json_mode(answering, messages, config)
