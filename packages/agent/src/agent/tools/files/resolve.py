from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from typing import Any
from typing import Literal

from agent.common.source_kinds import Shelf
from agent.common.source_kinds import parse_shelf
from agent.knowledge.inventory import get_turn_documents

DocumentSource = Literal["project", "office"]

_SHELF_SOURCES: dict[Shelf, DocumentSource] = {Shelf.PROJECT: "project", Shelf.OFFICE_SHELF: "office"}

_MAX_NAMED_CANDIDATES = 8


def _nfc(value: str) -> str:
    return unicodedata.normalize("NFC", value or "").strip()


def _key(value: str) -> str:
    return _nfc(value).casefold()


def _attr(row: Any, name: str) -> Any:
    return row.get(name) if isinstance(row, dict) else getattr(row, name, None)


@dataclass(frozen=True)
class Refusal:

    message: str


@dataclass(frozen=True)
class ResolvedDocument:

    file_name: str
    source: DocumentSource
    folder_path: str


def _rows() -> list[ResolvedDocument]:
    out: list[ResolvedDocument] = []
    for row in get_turn_documents():
        source = _SHELF_SOURCES.get(parse_shelf(_attr(row, "shelf")))
        file_name = _nfc(str(_attr(row, "file_name") or ""))
        if source is None or not file_name:
            continue
        out.append(
            ResolvedDocument(
                file_name=file_name,
                source=source,
                folder_path=_nfc(str(_attr(row, "folder_path") or "")),
            )
        )
    return out


def _named(candidates: list[ResolvedDocument]) -> str:
    shown = [f"`{doc.file_name}`" for doc in candidates[:_MAX_NAMED_CANDIDATES]]
    rest = len(candidates) - len(shown)
    return ", ".join(shown) + (f" (und {rest} weitere)" if rest > 0 else "")


def resolve_document(name: str) -> ResolvedDocument | Refusal:
    wanted = _key(name)
    if not wanted:
        return Refusal("Error: No file name was given. Name the file exactly as it appears in the overview.")

    rows = _rows()
    if not rows:
        return Refusal(
            "Error: This conversation sees no project or office-shelf files, so there is nothing "
            "to organise. Say so instead of making a proposal."
        )

    for candidates in (
        [doc for doc in rows if _key(doc.file_name) == wanted],
        [doc for doc in rows if _key(doc.file_name.rsplit(".", 1)[0]) == wanted],
        [doc for doc in rows if wanted in _key(doc.file_name)],
    ):
        if len(candidates) == 1:
            return candidates[0]
        if len(candidates) > 1:
            return Refusal(
                f"Ambiguous: „{_nfc(name)}“ matches {_named(candidates)}. Ask the user which file "
                "is meant, and call the tool again with the exact file name."
            )

    return Refusal(
        f"Not found: „{_nfc(name)}“ is not in this conversation's file overview. Give the "
        "exact file name from the overview or ask the user for it — do not guess."
    )


def known_folders() -> list[str]:
    paths: set[str] = set()
    for doc in _rows():
        if not doc.folder_path:
            continue
        segments = [segment for segment in doc.folder_path.split("/") if segment.strip()]
        for depth in range(1, len(segments) + 1):
            paths.add("/".join(segments[:depth]))
    return sorted(paths, key=str.casefold)


_ROOT_WORDS = frozenset({"", "/", ".", "root", "stamm", "projektstamm", "hauptordner", "oberste ebene"})


def resolve_folder(path: str) -> str | Refusal:
    wanted = _key(path)
    if wanted in _ROOT_WORDS:
        return ""

    folders = known_folders()
    if not folders:
        return Refusal(
            f"Not found: This project has no folders yet, so no „{_nfc(path)}“ either. Propose a folder with "
            '`propose_file_change(operation="create_folder")` before you put anything in it.'
        )

    for candidates in (
        [folder for folder in folders if _key(folder) == wanted],
        [folder for folder in folders if _key(folder.rsplit("/", 1)[-1]) == wanted],
    ):
        if len(candidates) == 1:
            return candidates[0]
        if len(candidates) > 1:
            listed = ", ".join(f"`{folder}`" for folder in candidates[:_MAX_NAMED_CANDIDATES])
            return Refusal(f"Ambiguous: „{_nfc(path)}“ matches {listed}. Ask which folder is meant.")

    listed = ", ".join(f"`{folder}`" for folder in folders[:_MAX_NAMED_CANDIDATES])
    return Refusal(
        f"Not found: There is no folder „{_nfc(path)}“. Existing folders: {listed}. Name one of them "
        'or first propose the new folder with `propose_file_change(operation="create_folder")`.'
    )
