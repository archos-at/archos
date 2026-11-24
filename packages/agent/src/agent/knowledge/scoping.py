import base64
import logging
import os
from dataclasses import dataclass
from typing import Any

from agent.common.source_kinds import Shelf
from agent.common.source_kinds import parse_shelf
from agent.common.turn_decision import current_turn_decision
from agent.common.turn_decision import decision_missing
from agent.knowledge.restricted_collections import is_restricted_collection
from agent.knowledge.restricted_use import current_restricted_use

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ScopedCollection:
    collection: str
    shelf: Shelf | None = None


def _normalize_collection_name(name: str) -> str:
    while name.startswith("s_s_"):
        name = name[2:]
    return name


def _base64url_decode(value: str) -> bytes:
    padding = 4 - len(value) % 4
    if padding != 4:
        value += "=" * padding
    return base64.urlsafe_b64decode(value)


class _UnreadableScopeEntry:
    __slots__ = ()

    def __repr__(self) -> str:  # pragma: no cover - debugging aid only
        return "<unreadable scope entry>"


_UNREADABLE = _UnreadableScopeEntry()


def _parse_scope_entry(item: Any) -> ScopedCollection | _UnreadableScopeEntry | None:
    if isinstance(item, str):
        name = item.strip()
        return ScopedCollection(_normalize_collection_name(name)) if name else None
    if isinstance(item, dict):
        raw_name = item.get("collection")
        if not isinstance(raw_name, str):
            return _UNREADABLE
        name = raw_name.strip()
        if not name:
            return None
        return ScopedCollection(
            _normalize_collection_name(name),
            parse_shelf(item.get("shelf")),
        )
    return _UNREADABLE


def _parse_scope_payload(scope: Any) -> list[ScopedCollection] | None:
    if not isinstance(scope, list):
        return None
    entries: list[ScopedCollection] = []
    seen: set[str] = set()
    for item in scope:
        parsed = _parse_scope_entry(item)
        if isinstance(parsed, _UnreadableScopeEntry):
            logger.debug("Unreadable collection-scope entry, ignoring the whole scope: %r", item)
            return None
        if parsed is None:
            logger.debug("Blank collection name in collection-scope, skipping this entry only: %r", item)
            continue
        if parsed.collection in seen:
            continue
        seen.add(parsed.collection)
        entries.append(parsed)
    return entries


def turn_scope_is_bound() -> bool:
    return current_turn_decision() is not None or decision_missing()


def _signed_envelope_scope() -> Any:
    from agent.project_context import get_signed_request_context

    if not os.environ.get("INTERNAL_API_TOKEN"):
        return None
    ctx = get_signed_request_context()
    if ctx is None or not ctx.envelope_signature:
        return None
    return ctx.collection_scope_entries if ctx.collection_scope_entries is not None else ctx.collection_scope


def bound_scope_entries() -> list[Any] | None:
    decision = current_turn_decision()
    if decision is not None:
        return list(decision.shelves)
    return [] if decision_missing() else None


def _turn_scope() -> list[ScopedCollection]:
    decision = current_turn_decision()
    if decision is None:
        logger.warning("A turn without a signed decision reads nothing")
        return []
    return _drawable_only(_parse_scope_payload(list(decision.shelves))) or []


def get_scoped_collections_from_context() -> list[ScopedCollection] | None:
    if turn_scope_is_bound():
        return _turn_scope()
    signed = _signed_envelope_scope()
    return _drawable_only(_parse_scope_payload(signed)) if signed is not None else None


def _drawable_only(entries: list[ScopedCollection] | None) -> list[ScopedCollection] | None:
    use = current_restricted_use()
    if entries is None or use is None:
        return entries
    return [
        entry for entry in entries if not is_restricted_collection(entry.collection) or use.allows(entry.collection)
    ]


def get_collection_scope_from_context() -> list[str] | None:
    entries = get_scoped_collections_from_context()
    return None if entries is None else [entry.collection for entry in entries]
