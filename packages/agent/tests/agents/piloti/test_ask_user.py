from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock
from unittest.mock import MagicMock
from unittest.mock import patch

import pytest

from agent.agents.piloti import ask_user as ask_user_module
from agent.agents.piloti.ask_user import AskUserConfig
from agent.agents.piloti.ask_user import ask_user
from agent.auth.request_identity import user_context
from nat.plugin_api import HumanPromptRadio
from nat.plugin_api import HumanResponseRadio
from nat.plugin_api import HumanResponseText
from nat.plugin_api import InteractionResponse
from nat.plugin_api import MultipleChoiceOption


@pytest.fixture(autouse=True)
def _clean_guards():
    ask_user_module.reset_ask_user_guard()
    yield
    ask_user_module.reset_ask_user_guard()


def _interaction_response(content) -> InteractionResponse:
    return InteractionResponse(id="i-1", timestamp="2026-08-18T10:00:00Z", content=content)


def _fake_context(prompt_user_input, *, conversation_id="conv-1", user_message_id="turn-1"):
    manager = MagicMock()
    manager.prompt_user_input = prompt_user_input
    context = MagicMock()
    context.conversation_id = conversation_id
    context.user_message_id = user_message_id
    context.user_interaction_manager = manager
    holder = MagicMock()
    holder.get = MagicMock(return_value=context)
    return holder


async def _call(prompt_user_input=None, *, context=None, **kwargs):
    async with ask_user(AskUserConfig(), MagicMock()) as info:
        payload = info.input_schema(**kwargs)
        if prompt_user_input is None and context is None:
            return await info.single_fn(payload)
        holder = context or _fake_context(prompt_user_input)
        with patch("agent.agents.piloti.ask_user.Context", holder):
            return await info.single_fn(payload)


class TestAskUserAnswers:
    @pytest.mark.asyncio
    async def test_picked_option_is_returned(self):
        prompt_user_input = AsyncMock(
            return_value=_interaction_response(
                HumanResponseRadio(selected_option=MultipleChoiceOption(value="Castle.ifc", label="Castle.ifc"))
            )
        )

        result = await _call(
            prompt_user_input,
            question="Welches Modell meinst du?",
            options=["Castle.ifc", "Institute.ifc"],
        )

        assert "Castle.ifc" in result

    @pytest.mark.asyncio
    async def test_the_prompt_carries_the_options_as_structured_data(self):
        prompt_user_input = AsyncMock(return_value=_interaction_response(HumanResponseText(text="Castle.ifc")))

        await _call(
            prompt_user_input,
            question="Welches Modell meinst du?",
            options=["Castle.ifc", "Institute.ifc"],
        )

        prompt = prompt_user_input.await_args.args[0]
        assert isinstance(prompt, HumanPromptRadio)
        assert [option.value for option in prompt.options] == ["Castle.ifc", "Institute.ifc"]
        assert prompt.text == "Welches Modell meinst du?"

    @pytest.mark.asyncio
    async def test_free_text_answer_is_returned(self):
        prompt_user_input = AsyncMock(
            return_value=_interaction_response(HumanResponseText(text="Das dritte, aus dem Archiv"))
        )

        result = await _call(prompt_user_input, question="Welches Modell?", options=["A.ifc", "B.ifc"])

        assert "Das dritte, aus dem Archiv" in result

    @pytest.mark.asyncio
    async def test_declining_tells_the_agent_to_assume(self):
        prompt_user_input = AsyncMock(return_value=_interaction_response(HumanResponseText(text="egal")))

        result = await _call(prompt_user_input, question="Welches Modell?", options=["A.ifc", "B.ifc"])

        assert "assumption" in result
        assert "declined" in result

    @pytest.mark.asyncio
    async def test_options_may_arrive_as_a_json_string(self):
        prompt_user_input = AsyncMock(return_value=_interaction_response(HumanResponseText(text="A.ifc")))

        result = await _call(prompt_user_input, question="Welches Modell?", options='["A.ifc", "B.ifc"]')

        assert "A.ifc" in result
        assert isinstance(prompt_user_input.await_args.args[0], HumanPromptRadio)


class TestAskUserRefusals:
    @pytest.mark.asyncio
    async def test_no_interaction_channel_degrades(self):
        result = await _call(question="Welches Modell?", options=["A.ifc", "B.ifc"])

        assert "assumption" in result
        assert "No channel" in result

    @pytest.mark.asyncio
    async def test_timeout_degrades(self):
        prompt_user_input = AsyncMock(side_effect=TimeoutError)

        result = await _call(prompt_user_input, question="Welches Modell?", options=["A.ifc", "B.ifc"])

        assert "did not answer" in result
        assert "assumption" in result

    @pytest.mark.asyncio
    async def test_unexpected_failure_is_swallowed(self):
        prompt_user_input = AsyncMock(side_effect=RuntimeError("socket gone"))

        result = await _call(prompt_user_input, question="Welches Modell?", options=["A.ifc", "B.ifc"])

        assert "could not be delivered" in result

    @pytest.mark.asyncio
    async def test_too_few_options_is_refused(self):
        prompt_user_input = AsyncMock()

        result = await _call(prompt_user_input, question="Welches Modell?", options=["A.ifc"])

        assert "at least 2 options" in result
        prompt_user_input.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_too_many_options_is_refused(self):
        prompt_user_input = AsyncMock()

        result = await _call(
            prompt_user_input,
            question="Welches Modell?",
            options=[f"{i}.ifc" for i in range(7)],
        )

        assert "at most 6 options" in result
        prompt_user_input.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_empty_question_is_refused(self):
        prompt_user_input = AsyncMock()

        result = await _call(prompt_user_input, question="   ", options=["A.ifc", "B.ifc"])

        assert "empty" in result
        prompt_user_input.assert_not_awaited()


class TestAskUserPendingSlot:
    @pytest.mark.asyncio
    async def test_a_second_question_does_not_steal_the_pending_slot(self):
        released = asyncio.Event()
        first_prompt_arrived = asyncio.Event()

        async def _slow_prompt(prompt):
            first_prompt_arrived.set()
            await released.wait()
            return _interaction_response(HumanResponseText(text="A.ifc"))

        holder = _fake_context(_slow_prompt)

        async def _first():
            return await _call(context=holder, question="Erste Frage?", options=["A.ifc", "B.ifc"])

        first = asyncio.create_task(_first())
        await asyncio.wait_for(first_prompt_arrived.wait(), timeout=2)

        second = await _call(context=holder, question="Zweite Frage?", options=["C.ifc", "D.ifc"])

        assert "already waiting" in second
        assert "assumption" in second

        released.set()
        assert "A.ifc" in await asyncio.wait_for(first, timeout=2)

    @pytest.mark.asyncio
    async def test_only_one_question_per_turn(self):
        prompt_user_input = AsyncMock(return_value=_interaction_response(HumanResponseText(text="A.ifc")))
        holder = _fake_context(prompt_user_input, conversation_id="conv-turn", user_message_id="turn-7")

        first = await _call(context=holder, question="Welches Modell?", options=["A.ifc", "B.ifc"])
        second = await _call(context=holder, question="Und welches Geschoss?", options=["EG", "OG"])

        assert "A.ifc" in first
        assert "already asked the user once this turn" in second
        assert prompt_user_input.await_count == 1

    @pytest.mark.asyncio
    async def test_a_new_turn_may_ask_again(self):
        prompt_user_input = AsyncMock(return_value=_interaction_response(HumanResponseText(text="A.ifc")))

        first = await _call(
            context=_fake_context(prompt_user_input, conversation_id="conv-next", user_message_id="turn-1"),
            question="Welches Modell?",
            options=["A.ifc", "B.ifc"],
        )
        second = await _call(
            context=_fake_context(prompt_user_input, conversation_id="conv-next", user_message_id="turn-2"),
            question="Welches Modell?",
            options=["A.ifc", "B.ifc"],
        )

        assert "A.ifc" in first
        assert "A.ifc" in second
        assert prompt_user_input.await_count == 2


class TestToolDescriptionPrefersAskingWhenOptionsAreNameable:
    def test_prefers_asking_when_options_would_change_the_answer(self):
        description = ask_user_module._TOOL_DESCRIPTION.lower()

        assert "prefer asking over silently guessing" in description
        assert "worse than one that answers" not in description

    def test_keeps_the_necessity_and_frequency_guardrails(self):
        description = ask_user_module._TOOL_DESCRIPTION.lower()

        assert "a search or another tool could" in description
        assert "project context already states" in description
        assert "at most one ask_user per turn" in description
        assert "never for an open question" in description


class TestAHeadlessTurnIsNeverAsked:
    @pytest.mark.asyncio
    async def test_the_tool_refuses_without_prompting_and_points_at_the_thread(self):
        prompt_user_input = AsyncMock()
        with user_context({"type": "internal", "headless": True}):
            result = await _call(
                prompt_user_input,
                question="Welches Modell meinst du?",
                options=["Castle.ifc", "Institute.ifc"],
            )

        prompt_user_input.assert_not_awaited()
        assert "canvas__reply" in result
        assert "assumption" in result

    @pytest.mark.asyncio
    async def test_an_anonymous_caller_that_only_skips_the_clarifier_is_still_asked(self):
        prompt_user_input = AsyncMock(return_value=_interaction_response(HumanResponseText(text="Castle.ifc")))
        with user_context({"type": "anonymous", "skip_clarifier": True}):
            result = await _call(
                prompt_user_input,
                question="Welches Modell meinst du?",
                options=["Castle.ifc", "Institute.ifc"],
            )

        prompt_user_input.assert_awaited_once()
        assert "Castle.ifc" in result
