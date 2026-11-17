from __future__ import annotations

import logging
from collections.abc import Mapping
from collections.abc import Sequence
from typing import Any

from agent.common.source_kinds import canonical_shelf_value

from .turn import _entry_shelf

logger = logging.getLogger("knowledge_layer.browse.tool")

SEARCH_SHELVES = {
    "project": "project",
    "office": "office_shelf",
    "office_shelf": "office_shelf",
    "session": "session",
    "base": "base",
}


def _has_literal_word(pattern: str) -> bool:
    from knowledge_layer.vector_store import user_literal_tokens

    return bool(user_literal_tokens(pattern))


def _collection_filter(
    collection: str,
    *,
    base: str,
    search_config: Any,
    caller_filters: dict[str, Any] | None,
    files: Sequence[str] | None,
    folder_key: str | None = None,
) -> dict[str, Any] | None:
    from knowledge_layer.vector_store import FOLDER_FIELD

    clauses = [
        clause
        for clause in (
            {"file_name": {"$in": sorted(files)}} if files is not None else None,
            {FOLDER_FIELD: folder_key} if folder_key else None,
        )
        if clause
    ]
    narrowing = None if not clauses else clauses[0] if len(clauses) == 1 else {"$and": clauses}
    if collection != base:
        return narrowing
    from knowledge_layer.search import base_collection_filters

    extra = [clause for clause in (caller_filters, narrowing) if clause]
    combined = extra[0] if len(extra) == 1 else ({"$and": extra} if extra else None)
    return base_collection_filters(search_config, combined)


async def _candidate_counts(
    retriever: Any,
    capped: Sequence[Any],
    pattern: str,
    filters_by_collection: Mapping[str, dict[str, Any] | None],
    *,
    regex_mode: bool,
) -> dict[str, int] | None:
    counter = getattr(retriever, "candidate_counts", None)
    if counter is None or not capped:
        return None
    totals: dict[str, int] = {}
    for entry in capped:
        try:
            counts = await counter(
                entry.collection, pattern, filters_by_collection.get(entry.collection), user_regex=regex_mode
            )
        except Exception:  # noqa: BLE001 — the counts are an addition to an answer the scan already gave
            logger.warning("exact search: candidate counts for %s failed", entry.collection, exc_info=True)
            continue
        for name, count in (counts or {}).items():
            totals[name] = totals.get(name, 0) + count
    return totals or None


def entries_on_shelf(entries: Sequence[Any], shelf: str | None) -> tuple[list[Any], str]:
    entries = list(entries)
    asked = (shelf or "").strip().lower()
    if not asked:
        return entries, ""
    wanted = SEARCH_SHELVES.get(canonical_shelf_value(asked))
    if wanted is None:
        return [], f"`shelf` must be one of project, office, base (or omitted for every shelf), got {shelf!r}."
    kept = [entry for entry in entries if _entry_shelf(entry) == wanted]
    if not kept:
        return [], (
            f"The shelf {asked!r} is not part of this question's scope, so it was not searched. That says nothing "
            "about what lies there; only the user changes the selection."
        )
    return kept, ""
