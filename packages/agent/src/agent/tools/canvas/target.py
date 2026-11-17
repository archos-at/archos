from __future__ import annotations

import asyncio
import re
import unicodedata
from dataclasses import dataclass
from typing import Any

from agent.common.bff_http import SignedEnvelope
from agent.common.focus_file import get_focused_document_id
from agent.common.focus_file import get_focused_file_name
from agent.common.source_kinds import Shelf
from agent.common.source_kinds import parse_shelf
from agent.knowledge.inventory import get_turn_documents

from .client import lookup_document_id

_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

_MAX_NAMED = 8
_MAX_PROBED_COLLECTIONS = 8

_DOCUMENT_SHELVES = frozenset({Shelf.PROJECT, Shelf.OFFICE_SHELF, Shelf.SESSION})


def is_uuid(value: str) -> bool:
    return bool(_UUID.match(value.strip()))


def _nfc(value: str) -> str:
    return unicodedata.normalize("NFC", value or "").strip()


def _key(value: str) -> str:
    return _nfc(value).casefold()


def _attr(row: Any, name: str) -> Any:
    return row.get(name) if isinstance(row, dict) else getattr(row, name, None)


@dataclass(frozen=True)
class Target:

    document_id: str | None = None
    file_name: str | None = None
    collection: str | None = None

    def body(self) -> dict[str, str]:
        return {"documentId": self.document_id} if self.document_id else {}


@dataclass(frozen=True)
class Unresolved:

    message: str
    ambiguous: bool = False


@dataclass(frozen=True)
class _Row:
    file_name: str
    collection: str


def _rows() -> list[_Row]:
    rows: list[_Row] = []
    for row in get_turn_documents():
        file_name = _nfc(str(_attr(row, "file_name") or ""))
        collection = str(_attr(row, "collection") or "")
        if file_name and collection and parse_shelf(_attr(row, "shelf")) in _DOCUMENT_SHELVES:
            rows.append(_Row(file_name, collection))
    return rows


def _named(rows: list[_Row]) -> str:
    shown = [f"`{row.file_name}`" for row in rows[:_MAX_NAMED]]
    rest = len(rows) - len(shown)
    return ", ".join(shown) + (f" (and {rest} more)" if rest > 0 else "")


def match_document(name: str) -> _Row | Unresolved:
    wanted = _key(name)
    rows = _rows()
    for candidates in (
        [row for row in rows if _key(row.file_name) == wanted],
        [row for row in rows if _key(row.file_name.rsplit(".", 1)[0]) == wanted],
        [row for row in rows if wanted in _key(row.file_name)],
    ):
        if len(candidates) == 1:
            return candidates[0]
        if len(candidates) > 1:
            return Unresolved(
                f"Ambiguous: „{_nfc(name)}“ matches {_named(candidates)}. Ask which document is meant, "
                "and call the tool again with the exact file name in `document`.",
                ambiguous=True,
            )
    return Unresolved(
        f"Not found: „{_nfc(name)}“ is not in this conversation's file overview. Give the exact "
        "file name in `document` or ask for it; do not guess."
    )


_CANNOT_NAME = (
    "This document cannot be addressed by its name right now (the document service does not know it "
    "or is unreachable). Ask the person to open the document and ask you there."
)


async def resolve_target(document: str, envelope: SignedEnvelope) -> Target | Unresolved:
    named = (document or "").strip()
    if not named:
        return Target(get_focused_document_id(), get_focused_file_name())
    if is_uuid(named):
        focus_id = get_focused_document_id()
        return Target(named, get_focused_file_name() if focus_id == named else None)
    row = match_document(named)
    if isinstance(row, Unresolved):
        return row
    document_id = await asyncio.to_thread(lookup_document_id, row.collection, row.file_name, envelope)
    if document_id is None:
        return Unresolved(_CANNOT_NAME)
    return Target(document_id, row.file_name, row.collection)


def collection_of(file_name: str) -> str | None:
    wanted = _key(file_name)
    found = {row.collection for row in _rows() if _key(row.file_name) == wanted}
    return found.pop() if len(found) == 1 else None


def probe_collections() -> list[str]:
    from agent.knowledge.scoping import get_scoped_collections_from_context

    try:
        entries = get_scoped_collections_from_context() or []
    except Exception:  # noqa: BLE001 - an unreadable scope reads nothing
        return []
    collections = [
        entry.collection
        for entry in entries
        if getattr(entry, "collection", None) and parse_shelf(getattr(entry, "shelf", None)) in _DOCUMENT_SHELVES
    ]
    return list(dict.fromkeys(collections))[:_MAX_PROBED_COLLECTIONS]
