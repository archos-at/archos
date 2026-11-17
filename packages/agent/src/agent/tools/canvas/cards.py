from __future__ import annotations

from typing import Any

from agent.cards.canvas_activity_card import MAX_CANVAS_ACTIVITY_ITEMS
from agent.cards.models import answer_card_adapter
from agent.cards.registry import extend_or_add
from agent.cards.registry import get_card_registry

CARD_TYPE = "canvas_activity"

EXCERPT_CHARS = 300


def excerpt(text: str) -> str:
    flat = " ".join(str(text or "").split())
    return flat if len(flat) <= EXCERPT_CHARS else flat[: EXCERPT_CHARS - 1].rstrip() + "…"


def record_canvas_activity(document: dict[str, str], items: list[dict[str, Any]]) -> int:
    registry = get_card_registry()
    if registry is None or not items:
        return 0
    landed = 0
    for item in items:
        landed += _add(registry, document, item)
    return landed


def _add(registry: Any, document: dict[str, str], item: dict[str, Any]) -> int:
    def owns(card: dict[str, Any]) -> bool:
        return card.get("type") == CARD_TYPE and (card.get("document") or {}).get("id") == document.get("id", "")

    def build(items: list[dict[str, Any]]) -> dict[str, Any]:
        card = {"type": CARD_TYPE, "document": document, "items": items}
        return answer_card_adapter.validate_python(card).model_dump(exclude_none=True)

    position = extend_or_add(registry, item, owns=owns, build=build, max_items=MAX_CANVAS_ACTIVITY_ITEMS)
    return 0 if position is None else 1
