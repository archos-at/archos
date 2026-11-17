import asyncio
import json
import logging
import re
from dataclasses import dataclass
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage
from langchain_core.messages import SystemMessage

from agent.cards.models import validate_cards
from agent.cards.prompt import build_card_generation_prompt
from agent.common.message_utils import response_text

logger = logging.getLogger(__name__)

_CARD_LLM_TIMEOUT_S = 30.0

_CARDS_RESPONSE_FORMAT: dict[str, Any] = {"type": "json_object"}


def _coerce_to_card_list(parsed: Any) -> list[Any] | None:
    if isinstance(parsed, dict):
        if isinstance(parsed.get("cards"), list):
            return parsed["cards"]
        return [parsed]
    if isinstance(parsed, list):
        return parsed
    return None


def _parse_cards_text(raw_text: Any) -> list[Any] | None:
    text = response_text(raw_text).strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

    try:
        return _coerce_to_card_list(json.loads(text))
    except json.JSONDecodeError:
        pass

    for open_ch, close_ch in (("[", "]"), ("{", "}")):
        for start_match in re.finditer(re.escape(open_ch), text):
            start = start_match.start()
            depth = 0
            for i, char in enumerate(text[start:]):
                if char == open_ch:
                    depth += 1
                elif char == close_ch:
                    depth -= 1
                    if depth == 0:
                        try:
                            return _coerce_to_card_list(json.loads(text[start : start + i + 1]))
                        except json.JSONDecodeError:
                            break

    logger.warning("Card generation: no parseable JSON in LLM response")
    return None


async def _ainvoke_card_llm(llm: Any, messages: list[Any]) -> Any:
    if isinstance(llm, BaseChatModel):
        try:
            return await llm.bind(response_format=_CARDS_RESPONSE_FORMAT).ainvoke(messages)
        except Exception as e:
            logger.warning(
                "JSON-mode card generation failed (%s); retrying without response_format",
                str(e).split("\n")[0],
            )
    return await llm.ainvoke(messages)


@dataclass(frozen=True)
class CardGenerationResult:
    """What post-hoc card generation produced, and whether it was TRIED and lost.

    ``cards`` is ``None`` whenever nothing usable came out. ``failed`` separates
    the two ways that happens: the model was never asked (no LLM, empty inputs)
    or answered that the report warrants no cards — ordinary, not failed — from a
    timeout, a provider error, unparseable output or a batch in which no card
    survived validation. The job runner records the second kind as a degraded
    reason on the answer; the first kind is not a caveat.
    """

    cards: list[dict[str, Any]] | None
    failed: bool = False


async def generate_cards(llm: Any, query: str, research_context: str) -> list[dict[str, Any]] | None:
    return (await generate_cards_result(llm, query, research_context)).cards


async def generate_cards_result(llm: Any, query: str, research_context: str) -> CardGenerationResult:
    if llm is None or not query or not research_context:
        return CardGenerationResult(cards=None)

    prompt = build_card_generation_prompt()
    messages = [
        SystemMessage(content=prompt),
        HumanMessage(content=f"Question: {query}\n\nResearch context:\n{research_context}"),
    ]

    try:
        response = await asyncio.wait_for(_ainvoke_card_llm(llm, messages), timeout=_CARD_LLM_TIMEOUT_S)
    except TimeoutError:
        logger.warning("Card generation timed out after %ss; returning no cards", _CARD_LLM_TIMEOUT_S)
        return CardGenerationResult(cards=None, failed=True)
    except Exception as e:
        logger.exception("Card generation failed: %s", e)
        return CardGenerationResult(cards=None, failed=True)

    try:
        parsed = _parse_cards_text(response_text(response))
        if parsed is None:
            return CardGenerationResult(cards=None, failed=True)
        if not parsed:
            return CardGenerationResult(cards=[])
        validated = validate_cards(parsed)
        if not validated:
            return CardGenerationResult(cards=None, failed=True)
        return CardGenerationResult(cards=validated)
    except Exception as e:
        logger.exception("Card validation failed: %s", e)
        return CardGenerationResult(cards=None, failed=True)
