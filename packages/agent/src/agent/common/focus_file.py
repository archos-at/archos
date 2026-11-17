from __future__ import annotations

from contextvars import ContextVar

from agent.common.source_kinds import canonical_shelf_value

SHELVES = frozenset({"office_shelf", "project", "session", "base"})
PRESETS = frozenset({"law", "project", "office"})

_focused_file_name: ContextVar[str | None] = ContextVar("focused_file_name", default=None)
_focused_shelf: ContextVar[str | None] = ContextVar("focused_shelf", default=None)
_turn_shelves: ContextVar[frozenset[str] | None] = ContextVar("turn_shelves", default=None)
_focused_document_id: ContextVar[str | None] = ContextVar("focused_document_id", default=None)


def _normalize_shelf(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = canonical_shelf_value(value)
    return trimmed if trimmed in SHELVES else None


def _normalize_preset(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = value.strip().lower()
    return trimmed if trimmed in PRESETS else None


def shelves_for_turn(*, focus_shelf: object = None, source_preset: object = None) -> frozenset[str] | None:
    shelf = _normalize_shelf(focus_shelf)
    if shelf == "session":
        return frozenset({"session", "base"})
    if shelf == "project":
        return frozenset({"project", "session", "base"})
    if shelf == "office_shelf":
        return frozenset({"office_shelf", "session", "base"})
    preset = _normalize_preset(source_preset)
    if preset == "law":
        return frozenset({"base"})
    if preset == "project":
        return frozenset({"project", "session", "base"})
    if preset == "office":
        return frozenset({"office_shelf", "session", "base"})
    return None


def set_turn_intent(
    *,
    file_name: object = None,
    shelf: object = None,
    source_preset: object = None,
    document_id: object = None,
) -> None:
    trimmed = file_name.strip() if isinstance(file_name, str) else ""
    _focused_file_name.set(trimmed or None)
    _focused_document_id.set(document_id.strip() or None if isinstance(document_id, str) else None)
    _focused_shelf.set(_normalize_shelf(shelf))
    _turn_shelves.set(shelves_for_turn(focus_shelf=shelf, source_preset=source_preset))


def set_focused_file_name(name: str | None) -> None:
    set_turn_intent(file_name=name)


def set_focus(
    *,
    file_name: str | None = None,
    shelf: str | None = None,
    source_preset: object = None,
    include_shelves: object = None,
) -> None:
    del include_shelves
    set_turn_intent(file_name=file_name, shelf=shelf, source_preset=source_preset)


def get_focused_file_name() -> str | None:
    return _focused_file_name.get()


def get_focused_shelf() -> str | None:
    return _focused_shelf.get()


def get_turn_shelves() -> frozenset[str] | None:
    return _turn_shelves.get()


def get_focused_document_id() -> str | None:
    return _focused_document_id.get()
