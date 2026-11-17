from __future__ import annotations

import asyncio
import logging
import weakref
from typing import Any

from pydantic import ValidationError

from agent.cards.models import answer_card_adapter
from agent.cards.registry import CardRegistry
from agent.cards.registry import get_card_registry
from agent.tools.proposals_client import add_card

logger = logging.getLogger(__name__)

CARD_TYPE = "file_operation_proposal"

_registry_locks: weakref.WeakKeyDictionary[CardRegistry, asyncio.Lock] = weakref.WeakKeyDictionary()


def _lock_for(registry: CardRegistry) -> asyncio.Lock:
    lock = _registry_locks.get(registry)
    if lock is None:
        lock = _registry_locks[registry] = asyncio.Lock()
    return lock


def _validated(card: dict[str, Any]) -> dict[str, Any] | None:
    try:
        return answer_card_adapter.validate_python(card).model_dump(exclude_none=True)
    except ValidationError:
        logger.exception("Failed to build file_operation_proposal card (operation=%s)", card.get("operation"))
        return None


async def propose_file_operation(*, operation: str, title: str, item: dict[str, Any], note: str | None = None) -> bool:
    registry = get_card_registry()
    if registry is None:
        return False
    single = _validated({"type": CARD_TYPE, "title": title, "operation": operation, "operations": [item], "note": note})
    if single is None:
        return False

    payload: dict[str, Any] = {"operation": operation, "operations": single["operations"]}
    if single.get("note"):
        payload["note"] = single["note"]
    async with _lock_for(registry):
        proposal_id = await add_card(registry, single, kind="file_operation", payload=payload)
    if proposal_id is None:
        logger.warning("Could not store the %s file operation as a proposal; its card stays read-only", operation)
        return False
    logger.info("Proposed %s file operation as proposal %s", operation, proposal_id)
    return True
