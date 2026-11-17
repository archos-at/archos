from __future__ import annotations

from collections.abc import Sequence

from agent.common.wire_v2 import InteractionOption
from agent.common.wire_v2 import InteractionRequestValue
from agent.common.wire_v2 import OptionAnswer
from agent.common.wire_v2 import TextAnswer
from nat.plugin_api import HumanPrompt
from nat.plugin_api import HumanPromptRadio
from nat.plugin_api import HumanPromptText
from nat.plugin_api import HumanResponse
from nat.plugin_api import HumanResponseRadio
from nat.plugin_api import HumanResponseText
from nat.plugin_api import InteractionPrompt
from nat.plugin_api import InteractionResponse
from nat.plugin_api import MultipleChoiceOption

DEFAULT_TEXT_PLACEHOLDER = "Please provide more details..."
"""Placeholder for the free-text box, kept identical for both prompt shapes."""


def build_human_prompt(
    text: str,
    options: Sequence[str] | None = None,
    *,
    placeholder: str = DEFAULT_TEXT_PLACEHOLDER,
) -> HumanPrompt:
    labels = [str(option).strip() for option in (options or []) if str(option).strip()]
    if not labels:
        return HumanPromptText(text=text, required=True, placeholder=placeholder)

    return HumanPromptRadio(
        text=text,
        options=[
            MultipleChoiceOption(id=str(index), label=label, value=label, description="")
            for index, label in enumerate(labels, start=1)
        ],
    )


def interaction_request(prompt: InteractionPrompt, *, expires_at: int) -> InteractionRequestValue:
    content = prompt.content
    if isinstance(content, HumanPromptRadio):
        return InteractionRequestValue(
            interaction_id=prompt.id,
            input="choice",
            text=content.text,
            options=[InteractionOption(id=option.id, label=option.label) for option in content.options],
            placeholder=DEFAULT_TEXT_PLACEHOLDER,
            expires_at=expires_at,
        )
    if isinstance(content, HumanPromptText):
        return InteractionRequestValue(
            interaction_id=prompt.id,
            input="text",
            text=content.text,
            placeholder=content.placeholder,
            expires_at=expires_at,
        )
    raise TypeError(f"No wire shape for a {type(content).__name__}; build prompts with build_human_prompt")


def human_response(prompt: HumanPrompt, answer: TextAnswer | OptionAnswer) -> HumanResponse:
    if isinstance(answer, TextAnswer):
        return HumanResponseText(text=answer.text)
    options = prompt.options if isinstance(prompt, HumanPromptRadio) else []
    chosen = next((option for option in options if option.id == answer.option_id), None)
    if chosen is None:
        raise ValueError(f"option {answer.option_id!r} was not offered")
    return HumanResponseRadio(selected_option=chosen)


def extract_user_response(response: InteractionResponse) -> str:
    content = response.content
    if isinstance(content, HumanResponseRadio):
        return content.selected_option.value
    if isinstance(content, HumanResponseText):
        return content.text
    raise TypeError(f"No answer text in a {type(content).__name__}")
