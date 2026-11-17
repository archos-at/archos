from __future__ import annotations

import contextvars
import logging
import threading
from collections import OrderedDict
from collections.abc import Callable
from typing import Any

from pydantic import ValidationError

logger = logging.getLogger(__name__)


class CardRegistry:

    def __init__(self) -> None:
        self._cards: list[dict[str, Any]] = []
        self._held: dict[str, list[Any]] = {}

    def add(self, card: dict[str, Any]) -> None:
        self._cards.append(card)

    def __len__(self) -> int:
        return len(self._cards)

    def replace(self, index: int, card: dict[str, Any]) -> None:
        self._cards[index] = card

    def snapshot(self) -> list[dict[str, Any]]:
        return list(self._cards)

    def hold(self, kind: str, entry: Any) -> int:
        held = self._held.setdefault(kind, [])
        held.append(entry)
        return len(held)

    def take_held(self, kind: str) -> list[Any]:
        return self._held.pop(kind, [])

    def clear(self) -> None:
        self._cards.clear()
        self._held.clear()


def extend_or_add(
    registry: CardRegistry,
    item: dict[str, Any],
    *,
    owns: Callable[[dict[str, Any]], bool],
    build: Callable[[list[dict[str, Any]]], dict[str, Any]],
    max_items: int,
) -> int | None:
    existing = next(
        (
            (index, card)
            for index, card in enumerate(registry.snapshot())
            if owns(card) and len(card.get("items") or []) < max_items
        ),
        None,
    )
    items = [*((existing[1].get("items") or []) if existing else []), item]
    try:
        card = build(items)
    except ValidationError:
        logger.exception("A card entry did not validate (card owner %s)", getattr(owns, "__name__", "?"))
        return None
    if existing is not None:
        registry.replace(existing[0], card)
        return existing[0] + 1
    registry.add(card)
    return len(registry)


_session_card_registry: contextvars.ContextVar[CardRegistry | None] = contextvars.ContextVar(
    "_session_card_registry", default=None
)

_MAX_SESSION_REGISTRIES = 1000
_session_registries: OrderedDict[str, CardRegistry] = OrderedDict()
_session_registries_lock = threading.Lock()


def get_or_create_card_registry(session_id: str | None) -> CardRegistry:
    if session_id is None:
        return CardRegistry()
    with _session_registries_lock:
        if session_id in _session_registries:
            _session_registries.move_to_end(session_id)
            return _session_registries[session_id]
        registry = CardRegistry()
        _session_registries[session_id] = registry
        while len(_session_registries) > _MAX_SESSION_REGISTRIES:
            _session_registries.popitem(last=False)
        return registry


def set_card_registry(registry: CardRegistry | None) -> contextvars.Token:
    return _session_card_registry.set(registry)


def reset_card_registry(token: contextvars.Token) -> None:
    _session_card_registry.reset(token)


def get_card_registry() -> CardRegistry | None:
    return _session_card_registry.get()
