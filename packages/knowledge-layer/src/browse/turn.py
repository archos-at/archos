from __future__ import annotations

import asyncio
import logging
from collections.abc import Iterable
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from agent.common.source_kinds import canonical_shelf_value
from nat.plugin_api import Context

from .rows import _SHELF_LABELS
from .rows import KNOWN_SHELVES
from .rows import USER_SHELVES
from .rows import FileRow
from .rows import file_rows

logger = logging.getLogger("knowledge_layer.browse.tool")


def _session_collection() -> str | None:
    try:
        ctx = Context.get()
        return ctx.conversation_id if ctx else None
    except Exception:  # noqa: BLE001 — no context is a valid standalone run
        return None


def _scope_entries(search_config: Any) -> list[Any]:
    from knowledge_layer.search import resolve_base_collection
    from knowledge_layer.search import scoped_collections_for_site

    return list(
        scoped_collections_for_site(search_config, _session_collection(), resolve_base_collection(search_config))
    )


def _entry_shelf(entry: Any) -> str | None:
    shelf = getattr(entry, "shelf", None)
    return canonical_shelf_value(str(getattr(shelf, "value", shelf))) if shelf else None


async def _readable_rows(search_config: Any) -> list[FileRow]:
    from agent.knowledge.inventory import get_turn_documents
    from agent.knowledge.restricted_use import without_restricted

    bound = get_turn_documents()
    if bound:
        return file_rows(bound)
    from agent.knowledge import get_available_documents_async

    entries = without_restricted(_scope_entries(search_config))
    listings = await asyncio.gather(
        *(get_available_documents_async(entry.collection) for entry in entries), return_exceptions=True
    )
    rows: list[dict[str, Any]] = []
    for entry, docs in zip(entries, listings, strict=True):
        if isinstance(docs, BaseException):
            logger.warning("list_files: no rows for %s: %s", entry.collection, docs)
            continue
        for doc in docs:
            data = doc.model_dump() if hasattr(doc, "model_dump") else dict(doc)
            rows.append({**data, "collection": entry.collection, "shelf": _entry_shelf(entry)})
    return file_rows(rows)


@dataclass(frozen=True)
class TurnRows:

    rows: list[FileRow]
    own_shelves: tuple[str, ...]
    allowed: frozenset[str] | None = None


def restrict_rows_to_turn(rows: Sequence[FileRow]) -> TurnRows:
    try:
        from agent.common.focus_file import get_turn_shelves

        allowed = get_turn_shelves()
    except Exception:  # noqa: BLE001 — no turn intent is a valid standalone run
        allowed = None
    if not allowed:
        return TurnRows(list(rows), USER_SHELVES)
    kept = [row for row in rows if row.shelf is None or row.shelf in allowed]
    if not kept:
        return TurnRows(list(rows), USER_SHELVES)
    own = tuple(shelf for shelf in USER_SHELVES if shelf in allowed)
    own = own or tuple(shelf for shelf in KNOWN_SHELVES if shelf in allowed) or USER_SHELVES
    return TurnRows(kept, own, frozenset(allowed))


def shelf_restricted_message(shelf: str, allowed: Iterable[str]) -> str:
    allowed = set(allowed)
    names = [_SHELF_LABELS[known] for known in KNOWN_SHELVES if known in allowed]
    where = names[0] if len(names) == 1 else f"{', '.join(names[:-1])} and {names[-1]}"
    return (
        f"The user's current selection limits this question to {where}, so {_SHELF_LABELS.get(shelf, shelf)} "
        "is not listed here. That says nothing about what lies there; only the user changes the selection."
    )
