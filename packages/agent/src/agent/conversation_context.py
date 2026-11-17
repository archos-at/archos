from __future__ import annotations

import logging
from collections.abc import Awaitable
from collections.abc import Callable
from dataclasses import dataclass

logger = logging.getLogger(__name__)

MAX_CONTEXT_MESSAGE_CHARS = 4000

MAX_CONTEXT_AUTHOR_CHARS = 120

ContextAppender = Callable[[str, str], Awaitable[None]]

_appender: ContextAppender | None = None


@dataclass(frozen=True)
class ContextOnlyMessage:
    text: str
    author: str | None = None


def _cap(value: str, max_chars: int) -> str:
    value = value.strip()
    if len(value) <= max_chars:
        return value
    trimmed = value[:max_chars]
    head = trimmed.rsplit("\n", 1)[0]
    return head or trimmed


def format_context_turn(message: ContextOnlyMessage, *, author: str | None = None) -> str:
    name = _cap(author or message.author or "", MAX_CONTEXT_AUTHOR_CHARS)
    body = _cap(message.text, MAX_CONTEXT_MESSAGE_CHARS)
    return f"{name}: {body}" if name else body


def register_context_appender(appender: ContextAppender | None) -> None:
    global _appender
    _appender = appender


def get_context_appender() -> ContextAppender | None:
    return _appender


async def append_conversation_context(thread_id: str | None, text: str) -> bool:
    if not thread_id or not text:
        return False
    appender = _appender
    if appender is None:
        logger.warning("No conversation-context appender registered; dropping ingest-only message")
        return False
    try:
        await appender(thread_id, text)
    except Exception:
        logger.warning("Failed to append ingest-only context to conversation %s", thread_id, exc_info=True)
        return False
    return True
