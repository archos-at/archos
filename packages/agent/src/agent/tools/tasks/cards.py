from __future__ import annotations

import logging
from typing import Any

from pydantic import ValidationError

from agent.cards.models import answer_card_adapter
from agent.cards.registry import get_card_registry

logger = logging.getLogger(__name__)


def _text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def emit_task_card(body: dict[str, Any], *, goal: str, kind: str) -> bool:
    registry = get_card_registry()
    if registry is None:
        return False

    task_id = _text(body.get("taskId"))
    if not task_id:
        logger.warning("Task API answered without a task id; no card emitted")
        return False

    card = {
        "type": "task_created",
        "task_id": task_id,
        "kind": _text(body.get("kind")) or kind,
        "title": _text(body.get("title")) or goal,
        "goal": goal,
        "due_at": _text(body.get("dueAt")),
        "conversation_id": _text(body.get("conversationId")),
    }
    try:
        validated = answer_card_adapter.validate_python(card).model_dump(exclude_none=True)
    except ValidationError:
        logger.exception("Failed to build task_created card for %s", task_id)
        return False
    registry.add(validated)
    logger.info("Emitted task_created card (task=%s kind=%s)", task_id, card["kind"])
    return True
