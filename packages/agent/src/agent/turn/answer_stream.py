from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any
from typing import Protocol

from langchain_core.callbacks import AsyncCallbackHandler
from langchain_core.callbacks.manager import AsyncCallbackManager
from langchain_core.runnables.config import ensure_config

from agent.common import turn_status
from agent.common.answer_prose_stream import AnswerProseStream
from agent.common.wire_v2 import AnswerRetractedBody
from agent.common.wire_v2 import AnswerSnapshot
from agent.common.wire_v2 import CardBody
from agent.common.wire_v2 import CardRefusedBody
from agent.common.wire_v2 import CardRefusedValue
from agent.common.wire_v2 import CardValue
from agent.common.wire_v2 import EmptyValue
from agent.common.wire_v2 import EventBody
from agent.common.wire_v2 import MastheadBody
from agent.common.wire_v2 import MastheadValue
from agent.common.wire_v2 import StateSnapshotBody
from agent.common.wire_v2 import TextMessageContentBody
from agent.common.wire_v2 import TextMessageEndBody
from agent.common.wire_v2 import TextMessageStartBody
from agent.common.wire_v2 import card_key

logger = logging.getLogger(__name__)


RELAY_WINDOW_S = 0.05


class Live(Protocol):

    def masthead(self, fields: dict[str, Any], prose: str = "") -> dict[str, Any] | None: ...

    def settle(self, prose: str, sources_text: str, fields: dict[str, Any] | None) -> Any: ...

    def tool_cards(self) -> list[dict[str, Any]]: ...

    def place(self, text: str) -> str: ...

    def card(self, payload: Any) -> dict[str, Any] | None: ...


@dataclass
class LiveProse:

    message_id: str
    streamed: bool = False


_PROSE: ContextVar[LiveProse | None] = ContextVar("live_prose", default=None)


def answer_streaming_enabled() -> bool:
    from agent.common.retrieval_settings import get_retrieval_setting

    return get_retrieval_setting("chat.answer_streaming", 1) == 1


@contextmanager
def bound_live_prose(message_id: str) -> Iterator[LiveProse]:
    prose = LiveProse(message_id)
    token = _PROSE.set(prose)
    try:
        yield prose
    finally:
        _PROSE.reset(token)


class _ProseTokenHandler(AsyncCallbackHandler):

    def __init__(self, prose: LiveProse, live: Live | None) -> None:
        self._prose = prose
        self._live = live
        self._reader: AnswerProseStream | None = None
        self._reset()

    def _reset(self) -> None:
        self._masthead_read = self._settled = self._started = self._ended = False
        self._shown = False
        self._cards = 0
        self._pending = ""
        self._flushed_at: float | None = None

    async def on_chat_model_start(self, *args: Any, **kwargs: Any) -> None:
        self._reader = None if self._prose.streamed else AnswerProseStream()
        self._reset()

    async def on_llm_new_token(self, token: Any, **kwargs: Any) -> None:
        reader = self._reader
        if reader is None:
            return
        delta = reader.feed(token_text(token))
        if not self._masthead_read and reader.masthead is not None:
            self._masthead_read = True
            self._show_masthead(reader.masthead)
        if delta:
            self._append(self._placed(delta))
        if reader.closed and not self._settled:
            self._settled = True
            self._end()
            await self._settle_prose(reader)
            tool_cards = self._guarded("tool cards", lambda live: live.tool_cards()) or []
            for card in tool_cards if reader.emitted else ():
                self._show_card(card)
            self._cards = len(tool_cards)
            self._show_envelope_cards(reader.take_cards())
        elif self._settled:
            self._show_envelope_cards(reader.take_cards())

    async def on_llm_end(self, response: Any, **kwargs: Any) -> None:
        self._reader = None
        if self._shown and _calls_tools(response):
            logger.info("answer_stream: the streamed call asked for tools; retracting its prose")
            self._write(AnswerRetractedBody(value=EmptyValue()))
            self._prose.streamed = False
            return
        self._end()

    def _append(self, delta: str) -> None:
        if not self._started:
            self._started = True
            self._write(TextMessageStartBody(message_id=self._prose.message_id))
        self._pending += delta
        now = time.monotonic()
        if self._flushed_at is None or now - self._flushed_at >= RELAY_WINDOW_S:
            self._flush()

    def _flush(self) -> None:
        if not self._pending:
            return
        body = TextMessageContentBody(message_id=self._prose.message_id, delta=self._pending)
        self._pending = ""
        self._flushed_at = time.monotonic()
        turn_status.emit(body)

    def _end(self) -> None:
        if self._started and not self._ended:
            self._ended = True
            self._write(TextMessageEndBody(message_id=self._prose.message_id))

    def _write(self, body: EventBody) -> None:
        self._flush()
        self._shown = self._prose.streamed = True
        turn_status.emit(body)

    def _show_masthead(self, fields: dict[str, Any]) -> None:
        meta = self._guarded("masthead", lambda live: live.masthead(fields))
        if meta:
            self._write(MastheadBody(value=MastheadValue(answer_meta=meta)))

    async def _settle_prose(self, reader: AnswerProseStream) -> None:
        if not reader.emitted or self._live is None:
            return
        live = self._live
        try:
            settled = await asyncio.to_thread(live.settle, reader.emitted, reader.sources_text, reader.masthead)
        except Exception:  # noqa: BLE001 - RUN_FINISHED carries it anyway
            logger.warning("answer_stream: the live settle failed", exc_info=True)
            return
        if settled is None:
            return
        snapshot = AnswerSnapshot(
            text=self._placed(settled.content), sources=list(settled.sources), answer_meta=settled.answer_meta
        )
        self._write(StateSnapshotBody(snapshot=snapshot))

    def _placed(self, text: str) -> str:
        if "[[card:" not in text:
            return text
        placed = self._guarded("placement", lambda live: live.place(text))
        return placed if isinstance(placed, str) else text

    def _show_envelope_cards(self, payloads: list[dict[str, Any]]) -> None:
        for payload in payloads:
            card = self._guarded("card", lambda live, payload=payload: live.card(payload))
            if card is None:
                self._write(CardRefusedBody(value=CardRefusedValue(index=self._cards)))
                self._cards += 1
            else:
                self._show_card(card)

    def _show_card(self, card: dict[str, Any]) -> None:
        self._write(CardBody(value=CardValue(index=self._cards, key=card_key(card), card=card)))
        self._cards += 1

    def _guarded(self, what: str, call: Any) -> Any:
        if self._live is None:
            return None
        try:
            return call(self._live)
        except Exception:  # noqa: BLE001 - RUN_FINISHED carries it anyway
            logger.warning("answer_stream: the live %s failed", what, exc_info=True)
            return None


def _calls_tools(response: Any) -> bool:
    generations = getattr(response, "generations", None) or []
    return any(_message_calls_tools(getattr(g, "message", None)) for batch in generations for g in batch)


def _message_calls_tools(message: Any) -> bool:
    if message is None:
        return False
    if getattr(message, "tool_calls", None) or getattr(message, "tool_call_chunks", None):
        return True
    return bool((getattr(message, "additional_kwargs", None) or {}).get("tool_calls"))


def token_text(token: Any) -> str:
    if isinstance(token, str):
        return token
    if not isinstance(token, list):
        return ""
    return "".join(
        block.get("text") or ""
        for block in token
        if isinstance(block, dict) and block.get("type") in {"text", "output_text"}
    )


def streaming_call(
    llm: Any, messages_config: dict[str, Any] | None = None, *, live: Live | None = None
) -> tuple[Any, dict[str, Any] | None]:
    prose = _PROSE.get()
    if prose is None or prose.streamed or not hasattr(llm, "bind"):
        return llm, None
    config = ensure_config(messages_config)
    inherited = config.get("callbacks")
    if inherited is None:
        manager = AsyncCallbackManager(handlers=[])
    elif isinstance(inherited, list):
        manager = AsyncCallbackManager(handlers=list(inherited), inheritable_handlers=list(inherited))
    else:
        manager = inherited.copy()
    manager.add_handler(_ProseTokenHandler(prose, live), inherit=True)
    return llm.bind(stream=True), {**config, "callbacks": manager}
