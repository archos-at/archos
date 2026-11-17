import base64
import json
import logging
from dataclasses import dataclass
from typing import Any

from agent.common.source_kinds import Shelf
from agent.common.source_kinds import parse_shelf
from agent.knowledge.restricted_collections import is_restricted_collection
from agent.knowledge.restricted_use import current_restricted_use
from nat.plugin_api import Context

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


def _raw_collection_scope_from_header() -> list[Any] | None:
    try:
        ctx = Context.get()
        if ctx is None:
            return None
        metadata = ctx.metadata
        if metadata is None:
            return None
        raw = metadata.headers.get("x-grid-collection-scope")
        if raw is None:
            return None
    except Exception:
        logger.debug("Failed to read X-Grid-Collection-Scope from context", exc_info=True)
        return None

    try:
        decoded = _base64url_decode(raw)
        scope: Any = json.loads(decoded)
    except Exception:
        logger.debug("Failed to decode X-Grid-Collection-Scope header", exc_info=True)
        return None

    if not isinstance(scope, list):
        logger.debug("X-Grid-Collection-Scope is not a list: %s", scope)
        return None

    return scope


def get_scoped_collections_from_context() -> list[ScopedCollection] | None:
    scope: Any = None
    try:
        from agent.project_context import RequestContext

        ctx = RequestContext.from_context()
        scope = ctx.collection_scope_entries if ctx.collection_scope_entries is not None else ctx.collection_scope
    except Exception:
        logger.debug("Verified collection-scope read failed; falling back to raw header", exc_info=True)
        scope = _raw_collection_scope_from_header()

    return _drawable_only(_parse_scope_payload(scope))


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


def get_scoped_collections_from_context_or(
    config: Any,
    session_id: str | None,
) -> list[ScopedCollection]:
    scope = get_scoped_collections_from_context()
    if scope:
        return scope
    from knowledge_layer.search import scoped_collections_for_site

    return scoped_collections_for_site(config, session_id)


def get_collection_scope_from_context_or(
    config: Any,
    session_id: str | None,
) -> list[str]:
    return [entry.collection for entry in get_scoped_collections_from_context_or(config, session_id)]
