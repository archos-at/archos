from __future__ import annotations

import logging
from collections.abc import Sequence

from langchain_core.messages import BaseMessage
from langchain_core.messages import HumanMessage

logger = logging.getLogger(__name__)

CONTINUATION_TURN = "Continue from the conversation above and respond now, following your instructions exactly."


def _is_assistant_turn(message: BaseMessage) -> bool:
    return getattr(message, "type", None) == "ai"


def _has_pending_tool_calls(message: BaseMessage) -> bool:
    return bool(getattr(message, "tool_calls", None))


def ends_on_model_turn(messages: Sequence[BaseMessage]) -> bool:
    return bool(messages) and _is_assistant_turn(messages[-1])


def normalize_chat_request(messages: Sequence[BaseMessage]) -> list[BaseMessage]:
    if not messages:
        return list(messages)

    last = messages[-1]
    if not _is_assistant_turn(last):
        return list(messages)

    if _has_pending_tool_calls(last):
        logger.warning(
            "Chat request ends on an assistant turn with %d unanswered tool call(s); "
            "passing through unchanged — this is a graph bug (a tool node did not run), "
            "not a provider-portability gap.",
            len(getattr(last, "tool_calls", []) or []),
        )
        return list(messages)

    logger.debug("Chat request ended on a model turn; appending a continuation turn for provider portability.")
    return [*messages, HumanMessage(content=CONTINUATION_TURN)]
