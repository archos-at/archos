from __future__ import annotations

import pytest

from agent.conversation_context import MAX_CONTEXT_AUTHOR_CHARS
from agent.conversation_context import MAX_CONTEXT_MESSAGE_CHARS
from agent.conversation_context import ContextOnlyMessage
from agent.conversation_context import append_conversation_context
from agent.conversation_context import format_context_turn
from agent.conversation_context import get_context_appender
from agent.conversation_context import register_context_appender


@pytest.fixture(autouse=True)
def _clear_appender():
    register_context_appender(None)
    yield
    register_context_appender(None)


class TestFormatContextTurn:
    def test_attributes_the_turn_to_its_author(self) -> None:
        message = ContextOnlyMessage(text="Ja, eigener Abschnitt.", author="Anna Weber")

        assert format_context_turn(message) == "Anna Weber: Ja, eigener Abschnitt."

    def test_the_verified_principal_beats_the_client_supplied_name(self) -> None:
        message = ContextOnlyMessage(text="Bemerkung", author="Matthias Bigl")

        assert format_context_turn(message, author="Anna Weber") == "Anna Weber: Bemerkung"

    def test_an_unknown_author_yields_the_words_alone(self) -> None:
        assert format_context_turn(ContextOnlyMessage(text="Bemerkung")) == "Bemerkung"

    def test_an_oversized_body_is_truncated(self) -> None:
        message = ContextOnlyMessage(text="x" * (MAX_CONTEXT_MESSAGE_CHARS * 3), author="Anna")

        rendered = format_context_turn(message)

        assert len(rendered) == len("Anna: ") + MAX_CONTEXT_MESSAGE_CHARS
        assert rendered.startswith("Anna: xxx")

    def test_truncation_prefers_a_line_boundary(self) -> None:
        body = "erste Zeile\n" + "y" * (MAX_CONTEXT_MESSAGE_CHARS * 2)

        rendered = format_context_turn(ContextOnlyMessage(text=body))

        assert rendered == "erste Zeile"

    def test_an_oversized_author_name_is_truncated(self) -> None:
        message = ContextOnlyMessage(text="kurz", author="A" * (MAX_CONTEXT_AUTHOR_CHARS * 2))

        rendered = format_context_turn(message)

        assert rendered == "A" * MAX_CONTEXT_AUTHOR_CHARS + ": kurz"


class TestAppendConversationContext:
    @pytest.mark.asyncio
    async def test_appends_through_the_registered_appender(self) -> None:
        seen: list[tuple[str, str]] = []

        async def appender(thread_id: str, text: str) -> None:
            seen.append((thread_id, text))

        register_context_appender(appender)
        assert get_context_appender() is appender

        assert await append_conversation_context("conv-1", "Anna: ja") is True
        assert seen == [("conv-1", "Anna: ja")]

    @pytest.mark.asyncio
    async def test_no_registered_appender_is_a_logged_no_op(self) -> None:
        assert await append_conversation_context("conv-1", "Anna: ja") is False

    @pytest.mark.asyncio
    async def test_an_appender_that_raises_never_propagates(self) -> None:
        async def boom(_thread_id: str, _text: str) -> None:
            raise RuntimeError("checkpointer down")

        register_context_appender(boom)

        assert await append_conversation_context("conv-1", "Anna: ja") is False

    @pytest.mark.asyncio
    async def test_missing_thread_or_text_is_refused_without_calling_out(self) -> None:
        calls: list[tuple[str, str]] = []

        async def appender(thread_id: str, text: str) -> None:
            calls.append((thread_id, text))

        register_context_appender(appender)

        assert await append_conversation_context(None, "Anna: ja") is False
        assert await append_conversation_context("conv-1", "") is False
        assert calls == []
