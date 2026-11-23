from __future__ import annotations

import logging

from langchain_core.messages import BaseMessage
from langchain_core.messages import HumanMessage

logger = logging.getLogger(__name__)


def content_to_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and isinstance(block.get("text"), str):
                parts.append(block["text"])
            elif isinstance(getattr(block, "text", None), str):
                parts.append(block.text)
        return "\n".join(parts)
    return str(content) if content is not None else ""


def response_text(response: object) -> str:
    if isinstance(response, BaseMessage):
        return response.text
    if isinstance(response, dict):
        return content_to_text(response.get("content"))
    return content_to_text(getattr(response, "content", response))


def get_latest_user_query(messages: list[BaseMessage]) -> str:
    for message in reversed(messages):
        if isinstance(message, HumanMessage):
            return content_to_text(message.content)

    if messages:
        last_message = messages[-1]
        if hasattr(last_message, "content"):
            return content_to_text(last_message.content)

    logger.warning("No user message found in conversation history, returning empty string")
    return ""
