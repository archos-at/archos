import asyncio
from typing import ClassVar
from unittest.mock import AsyncMock
from unittest.mock import MagicMock

import pytest
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage

from agent.cards.generate import CardGenerationResult
from agent.cards.generate import _parse_cards_text
from agent.cards.generate import generate_cards
from agent.cards.generate import generate_cards_result

_ONE_CARD_OBJECT = '{"cards": [{"type": "ifc_model_picker", "title": "Überblick"}]}'


class TestParseCardsText:
    def test_object_wrapper(self):
        assert _parse_cards_text(_ONE_CARD_OBJECT) == [{"type": "ifc_model_picker", "title": "Überblick"}]

    def test_bare_array(self):
        assert _parse_cards_text('[{"type": "summary", "title": "T"}]') == [{"type": "summary", "title": "T"}]

    def test_single_object_is_wrapped(self):
        assert _parse_cards_text('{"type": "summary", "title": "T"}') == [{"type": "summary", "title": "T"}]

    def test_code_fence_wrapping(self):
        assert _parse_cards_text("```json\n" + _ONE_CARD_OBJECT + "\n```")[0]["title"] == "Überblick"

    def test_leading_and_trailing_prose_is_salvaged(self):
        text = "Here are the cards you asked for:\n" + _ONE_CARD_OBJECT + "\nHope that helps!"
        assert _parse_cards_text(text) == [{"type": "ifc_model_picker", "title": "Überblick"}]

    def test_unparseable_returns_none(self):
        assert _parse_cards_text("no json here at all") is None

    def test_empty_cards_array(self):
        assert _parse_cards_text('{"cards": []}') == []

    def test_list_content_blocks_are_joined(self):
        blocks = [
            {"type": "text", "text": '{"cards": '},
            {"type": "text", "text": '[{"type": "summary", "title": "T"}]}'},
        ]
        assert _parse_cards_text(blocks) == [{"type": "summary", "title": "T"}]

    def test_plain_string_blocks_are_joined(self):
        assert _parse_cards_text(["hello ", "world"]) is None

    def test_none_content_returns_none(self):
        assert _parse_cards_text(None) is None


class _BindSpyChatModel(FakeMessagesListChatModel):
    bind_kwargs: ClassVar[list[dict]] = []

    def bind(self, **kwargs):
        type(self).bind_kwargs.append(kwargs)
        return super().bind(**kwargs)


class _StructuredRejectingChatModel(FakeMessagesListChatModel):
    def bind(self, **kwargs):
        failing = MagicMock()
        failing.ainvoke = AsyncMock(side_effect=Exception("400: response_format is not supported by this model"))
        return failing


class TestGenerateCards:
    @pytest.mark.asyncio
    async def test_returns_none_on_missing_inputs(self):
        llm = MagicMock()
        assert await generate_cards(None, "q", "ctx") is None
        assert await generate_cards(llm, "", "ctx") is None
        assert await generate_cards(llm, "q", "") is None

    @pytest.mark.asyncio
    async def test_chat_model_gets_json_object_binding(self):
        _BindSpyChatModel.bind_kwargs.clear()
        llm = _BindSpyChatModel(responses=[AIMessage(content=_ONE_CARD_OBJECT)])

        cards = await generate_cards(llm, "Was ist GK4?", "Ein Gebäude der Klasse 4.")

        assert cards == [{"type": "ifc_model_picker", "title": "Überblick"}]
        assert len(_BindSpyChatModel.bind_kwargs) == 1
        assert _BindSpyChatModel.bind_kwargs[0]["response_format"] == {"type": "json_object"}

    @pytest.mark.asyncio
    async def test_structured_output_rejection_falls_back_to_plain_call(self):
        llm = _StructuredRejectingChatModel(responses=[AIMessage(content=_ONE_CARD_OBJECT)])

        cards = await generate_cards(llm, "Was ist GK4?", "Ein Gebäude der Klasse 4.")

        assert cards == [{"type": "ifc_model_picker", "title": "Überblick"}]

    @pytest.mark.asyncio
    async def test_prose_wrapped_response_still_yields_cards(self):
        llm = MagicMock()
        llm.ainvoke = AsyncMock(
            return_value=AIMessage(content="Sure! " + _ONE_CARD_OBJECT + " Let me know if you need more.")
        )

        cards = await generate_cards(llm, "Was ist GK4?", "Ein Gebäude der Klasse 4.")

        assert cards == [{"type": "ifc_model_picker", "title": "Überblick"}]

    @pytest.mark.asyncio
    async def test_invalid_cards_dropped_but_valid_kept(self):
        payload = (
            '{"cards": ['
            '{"type": "ifc_model_picker", "title": "Gut"},'
            '{"type": "summary"}'  # missing required title → dropped by validate_cards
            "]}"
        )
        llm = MagicMock()
        llm.ainvoke = AsyncMock(return_value=AIMessage(content=payload))

        cards = await generate_cards(llm, "q", "ctx")

        assert cards == [{"type": "ifc_model_picker", "title": "Gut"}]

    @pytest.mark.asyncio
    async def test_llm_exception_returns_none(self):
        llm = MagicMock()
        llm.ainvoke = AsyncMock(side_effect=RuntimeError("boom"))

        assert await generate_cards(llm, "q", "ctx") is None

    @pytest.mark.asyncio
    async def test_hung_llm_is_bounded_by_timeout(self, monkeypatch):
        monkeypatch.setattr("agent.cards.generate._CARD_LLM_TIMEOUT_S", 0.05)

        async def _never_returns(*_args, **_kwargs):
            await asyncio.sleep(10)

        llm = MagicMock()
        llm.ainvoke = _never_returns

        assert await generate_cards(llm, "q", "ctx") is None


class TestGenerateCardsResult:
    @pytest.mark.asyncio
    async def test_nothing_to_do_is_not_a_failure(self):
        assert await generate_cards_result(None, "q", "ctx") == CardGenerationResult(cards=None)
        assert await generate_cards_result(MagicMock(), "", "ctx") == CardGenerationResult(cards=None)

    @pytest.mark.asyncio
    async def test_the_model_declining_to_propose_is_not_a_failure(self):
        llm = MagicMock()
        llm.ainvoke = AsyncMock(return_value=AIMessage(content='{"cards": []}'))

        assert await generate_cards_result(llm, "q", "ctx") == CardGenerationResult(cards=[])

    @pytest.mark.asyncio
    async def test_a_provider_error_is_a_failure(self):
        llm = MagicMock()
        llm.ainvoke = AsyncMock(side_effect=RuntimeError("boom"))

        assert await generate_cards_result(llm, "q", "ctx") == CardGenerationResult(cards=None, failed=True)

    @pytest.mark.asyncio
    async def test_unparseable_output_is_a_failure(self):
        llm = MagicMock()
        llm.ainvoke = AsyncMock(return_value=AIMessage(content="I cannot produce JSON today."))

        assert await generate_cards_result(llm, "q", "ctx") == CardGenerationResult(cards=None, failed=True)

    @pytest.mark.asyncio
    async def test_a_batch_with_no_well_formed_card_is_a_failure(self):
        llm = MagicMock()
        llm.ainvoke = AsyncMock(return_value=AIMessage(content='{"cards": [{"type": "summary"}]}'))

        assert await generate_cards_result(llm, "q", "ctx") == CardGenerationResult(cards=None, failed=True)

    @pytest.mark.asyncio
    async def test_a_good_batch_is_not_a_failure(self):
        llm = MagicMock()
        llm.ainvoke = AsyncMock(return_value=AIMessage(content=_ONE_CARD_OBJECT))

        result = await generate_cards_result(llm, "q", "ctx")

        assert result.failed is False
        assert result.cards == [{"type": "ifc_model_picker", "title": "Überblick"}]
