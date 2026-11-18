from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Awaitable
from collections.abc import Callable
from collections.abc import Collection
from collections.abc import Sequence
from typing import Any

from langchain_core.messages import ToolMessage

from agent.common import content_to_text
from agent.common.answer_envelope import AnswerMeta
from agent.observability.langfuse_scores import card_validity_score
from agent.observability.langfuse_scores import emit_scores
from agent.observability.langfuse_scores import formula_provenance_score

logger = logging.getLogger(__name__)

CardRepairFn = Callable[[dict[str, Any], str, str], Awaitable[dict[str, Any] | None]]

_CARD_MARKER_NUMBER_RE = re.compile(r"\[\[card:(\d+)\]\]")


def _handed_markers(messages: Sequence[Any]) -> set[int]:
    handed: set[int] = set()
    for message in messages:
        if not isinstance(message, ToolMessage):
            continue
        for match in _CARD_MARKER_NUMBER_RE.finditer(content_to_text(message.content)):
            handed.add(int(match.group(1)))
    return handed


def _envelope_index(number: int, handed: Collection[int]) -> int | None:
    if number in handed:
        return None
    offset = max(handed, default=0)
    return number - offset if number > offset else number


def _renumber_envelope_markers(
    content: str,
    *,
    handed: set[int],
    positions: dict[int, int],
    count: int,
    fallbacks: dict[int, str] | None = None,
) -> str:
    if count == 0:
        return content
    fallbacks = dict(fallbacks or {})
    placed: set[int] = set()

    def substitute(match: re.Match[str]) -> str:
        index = _envelope_index(int(match.group(1)), handed)
        if index is None or not 1 <= index <= count:
            return match.group(0)
        position = positions.get(index)
        if position is not None:
            return f"[[card:{position}]]"
        if index in fallbacks and index not in placed:
            placed.add(index)
            return f"\n\n{fallbacks[index]}\n\n"
        return ""

    content = _CARD_MARKER_NUMBER_RE.sub(substitute, content)
    if not fallbacks:
        return content
    trailing = [fallbacks[index] for index in sorted(fallbacks) if index not in placed]
    if trailing:
        content = content.rstrip() + "\n\n" + "\n\n".join(trailing)
    return re.sub(r"\n{3,}", "\n\n", content)


async def _register_envelope_cards(
    meta: AnswerMeta | None,
    content: str,
    messages: Sequence[Any],
    card_repair: CardRepairFn | None,
) -> str:
    from agent.cards.envelope import envelope_card_objects
    from agent.cards.envelope import register_envelope_card
    from agent.cards.registry import get_card_registry

    raw = envelope_card_objects(meta.cards if meta is not None else None)
    if not raw:
        return content
    registry = get_card_registry()
    if registry is None:
        logger.info("answer envelope carried %d card(s) with no card registry bound; dropped", len(raw))
        return content
    handed = _handed_markers(messages)
    checked = await asyncio.gather(
        *(_checked_envelope_card(payload, index, content, card_repair) for index, payload in enumerate(raw))
    )
    positions: dict[int, int] = {}
    fallbacks: dict[int, str] = {}
    for index, validated in enumerate(checked):
        if validated is None:
            _lay_out_retired(raw[index], index, fallbacks)
            continue
        await register_envelope_card(registry, validated)
        positions[index + 1] = len(registry)
        provenance = formula_provenance_score(validated, index=len(registry))
        if provenance is not None:
            emit_scores([provenance], writer="piloti")
        logger.info("answer envelope registered a '%s' card as card %d", validated["type"], len(registry))
    return _renumber_envelope_markers(content, handed=handed, positions=positions, count=len(raw), fallbacks=fallbacks)


def _lay_out_retired(payload: Any, index: int, fallbacks: dict[int, str]) -> None:
    from agent.cards.catalog import retired_card_markdown

    markdown = retired_card_markdown(payload)
    if markdown:
        fallbacks[index + 1] = markdown
        logger.info("answer envelope's retired '%s' card laid out as Markdown", payload.get("type"))


async def _checked_envelope_card(
    payload: Any, index: int, content: str, card_repair: CardRepairFn | None
) -> dict[str, Any] | None:
    from agent.cards.envelope import REFUSED_SHAPE
    from agent.cards.envelope import validate_model_card
    from agent.cards.formula_card import stated_result_fields
    from agent.common.turn_notices import CARD_INVALID_DROPPED
    from agent.common.turn_notices import CARD_INVALID_REPAIRED
    from agent.common.turn_notices import emit_card_invalid

    validated, refusal = validate_model_card(payload)
    card_type = refusal.card_type if refusal is not None else str(validated["type"])
    if validated is None and refusal is not None and refusal.kind == REFUSED_SHAPE and card_repair is not None:
        repaired = await card_repair(payload, refusal.for_repair(), content)
        if repaired is not None:
            validated, _ = validate_model_card(repaired)
        if validated is not None:
            emit_card_invalid(card_type=card_type, index=index, outcome=CARD_INVALID_REPAIRED)
            emit_scores([card_validity_score(outcome="repaired", card_type=card_type, index=index)], writer="piloti")
    if validated is None:
        emit_card_invalid(card_type=card_type, index=index, outcome=CARD_INVALID_DROPPED)
        emit_scores([card_validity_score(outcome="dropped", card_type=card_type, index=index)], writer="piloti")
        return None
    stated = stated_result_fields(payload)
    if stated:
        logger.info("envelope card %d (%s): %d stated result field(s) removed", index, card_type, stated)
        emit_scores(
            [card_validity_score(outcome="stripped", card_type=card_type, index=index, fields=stated)],
            writer="piloti",
        )
    return validated
