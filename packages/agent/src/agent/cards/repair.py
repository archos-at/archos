from __future__ import annotations

import asyncio
import logging
from typing import Any

from langchain_core.messages import HumanMessage
from langchain_core.messages import SystemMessage

from agent.cards.generate import _ainvoke_card_llm
from agent.cards.generate import _parse_cards_text
from agent.common.message_utils import response_text

logger = logging.getLogger(__name__)

CARD_REPAIR_TIMEOUT_S = 20.0

_SYSTEM_PROMPT = (
    "You fix ONE rich-UI card object that failed validation. You are given the answer it belongs to, "
    "the card as it was written, why it was refused, and the exact shape the card type needs. "
    "Return the corrected card as ONE JSON object of the same `type`, carrying only the content of "
    "the original — never invent a value, a reference or a number to satisfy a field; leave an "
    "optional field out rather than guess it, and use `needs_input` where the shape offers it. "
    "Return only the JSON object."
)


def _prompt(card: dict[str, Any], refusal: str, answer: str) -> list[Any]:
    import json

    return [
        SystemMessage(content=_SYSTEM_PROMPT),
        HumanMessage(
            content=(
                f"THE ANSWER THE CARD BELONGS TO:\n{answer[:4000]}\n\n"
                f"THE CARD AS WRITTEN:\n{json.dumps(card, ensure_ascii=False)}\n\n"
                f"WHY IT WAS REFUSED, AND THE SHAPE IT NEEDS:\n{refusal}"
            )
        ),
    ]


async def repair_card(llm: Any, card: dict[str, Any], refusal: str, answer: str) -> dict[str, Any] | None:
    try:
        response = await asyncio.wait_for(_ainvoke_card_llm(llm, _prompt(card, refusal, answer)), CARD_REPAIR_TIMEOUT_S)
    except TimeoutError:
        logger.warning("card repair timed out after %.0fs", CARD_REPAIR_TIMEOUT_S)
        return None
    except Exception as exc:  # noqa: BLE001 — a failed repair keeps the answer
        logger.warning("card repair failed: %s", str(exc).split("\n")[0])
        return None
    parsed = _parse_cards_text(response_text(response))
    if not parsed:
        logger.warning("card repair returned nothing parseable")
        return None
    candidate = parsed[0]
    if not isinstance(candidate, dict) or candidate.get("type") != card.get("type"):
        logger.warning("card repair returned a different shape than asked (%r)", type(candidate).__name__)
        return None
    return candidate
