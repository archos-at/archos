from __future__ import annotations

from typing import Literal

from agent.common.source_kinds import is_office_shelf_collection


def _source_for_collection(collection: str) -> Literal["project", "office"] | None:
    if collection.startswith("proj_"):
        return "project"
    if is_office_shelf_collection(collection):
        return "office"
    return None


def _source_for_target(
    collection: str,
    source_by_collection: dict[str, str],
) -> Literal["project", "office"] | None:
    if source_by_collection:
        raw = source_by_collection.get(collection)
        return raw if raw in ("project", "office") else None
    return _source_for_collection(collection)


def _target_collections(
    scope: list[str] | None,
    *,
    shelf: str | None = None,
    scoped: list | None = None,
) -> list[str]:
    from agent.common.source_kinds import parse_shelf

    wanted = parse_shelf(shelf)
    if scoped:
        return _scoped_targets(scoped, wanted)
    return _scope_targets(scope, wanted)


def _scoped_targets(scoped: list, wanted: object) -> list[str]:
    from agent.common.source_kinds import Shelf
    from agent.knowledge.restricted_collections import is_restricted_collection

    seen: set[str] = set()
    targets: list[str] = []
    for entry in scoped:
        entry_shelf = getattr(entry, "shelf", None)
        collection = getattr(entry, "collection", None)
        if not collection or collection in seen or is_restricted_collection(collection):
            continue
        if entry_shelf is Shelf.BASE:
            continue
        if wanted is not None and entry_shelf != wanted:
            continue
        if wanted is None and entry_shelf not in (Shelf.PROJECT, Shelf.OFFICE_SHELF):
            continue
        seen.add(collection)
        targets.append(collection)
    return targets


def _scope_targets(scope: list[str] | None, wanted: object) -> list[str]:
    from agent.common.source_kinds import Shelf
    from agent.knowledge.restricted_collections import is_restricted_collection

    seen: set[str] = set()
    targets: list[str] = []
    for collection in scope or []:
        source = _source_for_collection(collection)
        if source is None or is_restricted_collection(collection):
            continue
        if wanted is Shelf.OFFICE_SHELF and source != "office":
            continue
        if wanted is Shelf.PROJECT and source != "project":
            continue
        if collection not in seen:
            seen.add(collection)
            targets.append(collection)
    return targets


def _target_shelves(targets: list[str], scoped: list | None) -> set[str]:
    from agent.common.source_kinds import Shelf

    by_collection = {}
    for entry in scoped or []:
        entry_shelf = getattr(entry, "shelf", None)
        if entry_shelf is Shelf.PROJECT:
            by_collection[getattr(entry, "collection", None)] = "project"
        elif entry_shelf is Shelf.OFFICE_SHELF:
            by_collection[getattr(entry, "collection", None)] = "office"
    shelves: set[str] = set()
    for collection in targets:
        source = _source_for_target(collection, by_collection)
        if source == "project":
            shelves.add("project")
        elif source == "office":
            shelves.add("office_shelf")
    return shelves


def _match_known_filename(requested: str, known: list[str]) -> str | None:
    needle = (requested or "").strip()
    if not needle or not known:
        return None
    if needle in known:
        return needle
    lowered = {name.lower(): name for name in known}
    if needle.lower() in lowered:
        return lowered[needle.lower()]
    for name in sorted(known, key=len, reverse=True):
        if name.lower() in needle.lower() or needle.lower() in name.lower():
            return name
    return None


def _filename_mentioned_in_query(query: str, known: list[str]) -> str | None:
    text = (query or "").strip().lower()
    if not text or not known:
        return None
    for name in sorted(known, key=len, reverse=True):
        if name.lower() in text:
            return name
    return None
