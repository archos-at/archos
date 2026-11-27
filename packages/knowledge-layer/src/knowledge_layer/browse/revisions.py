from __future__ import annotations

import re
from collections import Counter
from collections.abc import Sequence
from dataclasses import replace

from agent.knowledge.title_block import document_key
from agent.knowledge.title_block import newest_first
from agent.knowledge.title_block import title_block_label
from knowledge_layer.revision_series import find_revision_series
from knowledge_layer.revision_series import parse_revision_name
from knowledge_layer.revision_series import revision_label
from knowledge_layer.revision_series import series_key_of

from .render import MAX_CHAIN_CHANGE_CHARS
from .render import _change_text
from .render import _compared_with_own_upload
from .rows import _SHELF_LABELS
from .rows import USER_SHELVES
from .rows import FileRow
from .rows import RowIndex
from .rows import _folder_matches
from .rows import _in_folder
from .rows import confirmed_revision_marks
from .text import _words
from .text import fold

MAX_CHAIN_LINES = 30

MAX_CHAIN_CANDIDATES = 8

_EXTENSION = re.compile(r"\.([a-z0-9]{1,5})\Z", re.IGNORECASE | re.ASCII)


def _series_ident(file_name: str) -> tuple[str, str]:
    extension = _EXTENSION.search(file_name.strip())
    return series_key_of(file_name), extension.group(1).lower() if extension else ""


def _chain_members(rows: Sequence[FileRow], start: FileRow) -> list[FileRow]:
    same = [row for row in rows if row.collection == start.collection]
    index = RowIndex(same)
    by_key = {row.key: row for row in same}
    neighbours: dict[tuple[str, str], set[tuple[str, str]]] = {key: set() for key in by_key}
    for row in same:
        newer = index.newer(row)
        if newer is not None and newer is not row:
            neighbours[row.key].add(newer.key)
            neighbours[newer.key].add(row.key)
    groups: dict[tuple[str, ...], list[FileRow]] = {}
    for row in same:
        groups.setdefault(("name", *_series_ident(row.file_name)), []).append(row)
        number = document_key((row.revision_facts or {}).get("document_number"))
        if number is not None:
            groups.setdefault(("plankopf", number), []).append(row)
    for members in groups.values():
        names = [row.file_name for row in members]
        namesakes = len(set(names)) < len(names)
        for row in members:
            neighbours[row.key].update(
                other.key
                for other in members
                if other.file_name != row.file_name and (not namesakes or other.folder == row.folder)
            )
    seen = {start.key}
    queue = [start.key]
    while queue:
        for other in neighbours[queue.pop()]:
            if other not in seen:
                seen.add(other)
                queue.append(other)
    return sorted((by_key[key] for key in seen), key=lambda row: (fold(row.file_name), row.key))


def _with_supersedes(members: Sequence[FileRow]) -> list[FileRow]:
    index = RowIndex(members)
    return [
        replace(row, supersedes=tuple(sorted(old.file_name for old in members if index.newer(old) is row)))
        for row in members
    ]


def _by_title_block(members: Sequence[FileRow]) -> bool:
    return len(members) > 1 and all(
        (row.revision_facts or {}).get("revision") or (row.revision_facts or {}).get("revision_date") for row in members
    )


def _sheet_order(members: Sequence[FileRow]) -> list[FileRow]:
    return list(newest_first(members, lambda row: row.revision_facts, lambda row: row.added_at or ""))


def _name_order(members: Sequence[FileRow]) -> list[FileRow]:
    ordered: list[FileRow] = []
    for series in find_revision_series(
        [row for row in members if parse_revision_name(row.file_name)],
        filename=lambda row: row.file_name,
        created_at=lambda row: row.added_at,
    ):
        ordered += [series.current.item, *(entry.item for entry in series.older)]
    return ordered


def _chain_order(members: Sequence[FileRow]) -> list[FileRow]:
    index = RowIndex(members)
    ranked = _sheet_order(members) if _by_title_block(members) else _name_order(members)
    ranked_keys = {row.key for row in ranked}
    rest = sorted((row for row in members if row.key not in ranked_keys), key=lambda row: fold(row.file_name))
    rest.sort(key=lambda row: row.added_at or "", reverse=True)
    position = {row.key: number for number, row in enumerate([*ranked, *rest])}

    pending = sorted(members, key=lambda row: position[row.key])
    ordered: list[FileRow] = []
    while pending:
        ready = [row for row in pending if index.newer(row) not in pending]
        row = (ready or pending)[0]
        pending.remove(row)
        ordered.append(row)
    return ordered


def _chain_line(position: int, row: FileRow, *, current: bool, mark: str | None, basis: str) -> str:
    revision = parse_revision_name(row.file_name)
    label = revision_label(revision) if revision is not None else ""
    bits = [label or "no Index and no date in the name"]
    title_block = title_block_label(row.revision_facts)
    if title_block:
        bits.append(f"Plankopf: {title_block}")
    if current:
        bits.append("current Fassung" + ("" if mark else f" ({basis})"))
    elif not mark:
        bits.append(f"older Fassung ({basis})")
    if mark:
        bits.append(mark)
    if row.added_at:
        bits.append(f"uploaded {row.added_at}")
    text = _change_text(row, MAX_CHAIN_CHANGE_CHARS)
    if text and _compared_with_own_upload(row):
        bits.append(f"changed against its previous upload (same file name): {text}")
    elif text and row.change_basis:
        bits.append(f"changed against {row.change_basis}: {text}")
    elif text:
        bits.append(f"changed: {text}")
    else:
        bits.append("no change note stored")
    return f"{position}. {row.file_name} · {' · '.join(bits)}"


def named_rows(rows: Sequence[FileRow], wanted: str) -> list[FileRow]:
    from knowledge_layer.document_address import addressed

    named = addressed(
        rows,
        wanted,
        names=lambda row: (row.file_name, row.display_title or ""),
        folder=lambda row: row.folder,
        document_id=lambda row: row.document_id,
    )
    if named:
        return named
    folded = fold(wanted.strip())
    return [row for row in rows if folded in (fold(row.file_name), fold(row.display_title or ""))]


def _chain_candidates(rows: Sequence[FileRow], wanted: str) -> list[FileRow]:
    exact = named_rows(rows, wanted)
    if exact:
        return exact
    words = set(_words(wanted))
    return [row for row in rows if words and words <= set(row.searchable.split())]


def addresses(rows: Sequence[FileRow]) -> list[str]:
    from knowledge_layer.document_address import citation_form

    shared = Counter(fold(row.file_name) for row in rows)
    return [
        f"{citation_form(row.folder, row.file_name)} (Document-ID: {row.document_id})"
        if shared[fold(row.file_name)] > 1 and row.document_id
        else row.file_name
        for row in rows
    ]


def _chains(scoped: Sequence[FileRow], matches: Sequence[FileRow]) -> dict[frozenset[tuple[str, str]], list[FileRow]]:
    chains: dict[frozenset[tuple[str, str]], list[FileRow]] = {}
    for row in matches:
        members = _chain_members(scoped, row)
        chains.setdefault(frozenset(member.key for member in members), members)
    return chains


def _resolve_chain(
    rows: Sequence[FileRow],
    wanted: str,
    *,
    shelf: str | None,
    default_shelves: Sequence[str],
    folder: str | None = None,
) -> tuple[list[FileRow], str]:
    shelves = (shelf,) if shelf else tuple(default_shelves)
    scoped = [row for row in rows if row.shelf in shelves or (not shelf and row.shelf is None)]
    where = " and ".join(_SHELF_LABELS.get(name, name) for name in shelves)
    matches = _chain_candidates(scoped, wanted)
    if not matches:
        return [], (
            f'No file on {where} is named or contains "{wanted.strip()}". Find the exact name with '
            "`list_files(name_contains=…)`."
        )
    chains = _chains(scoped, matches)
    folder = (folder or "").strip().strip("/")
    if len(chains) > 1 and folder:
        held = _folder_matches(scoped, folder)
        inside = [row for row in matches if held is not None and _in_folder(row, held)]
        if not inside:
            return [], (
                f'No file in folder "{folder}" is named or contains "{wanted.strip()}". Its documents: '
                f"{'; '.join(addresses(matches)[:MAX_CHAIN_CANDIDATES])}."
            )
        matches, chains = inside, _chains(scoped, inside)
    if len(chains) > 1:
        names = addresses(matches)[:MAX_CHAIN_CANDIDATES]
        rest = len(matches) - len(names)
        return [], (
            f'"{wanted.strip()}" matches {len(chains)} different documents: {"; ".join(names)}'
            f"{f' and {rest} more' if rest > 0 else ''}. Call `list_files(revisions_of=…)` with one of them as "
            "written here."
        )
    return _chain_order(_with_supersedes(next(iter(chains.values())))), ""


def render_revisions(
    rows: Sequence[FileRow],
    wanted: str,
    *,
    shelf: str | None = None,
    default_shelves: Sequence[str] = USER_SHELVES,
    folder: str | None = None,
) -> str:
    members, refusal = _resolve_chain(rows, wanted, shelf=shelf, default_shelves=default_shelves, folder=folder)
    if refusal:
        return refusal
    confirmed = confirmed_revision_marks(members)
    where = " and ".join(dict.fromkeys(_SHELF_LABELS.get(row.shelf or "", row.shelf or "") for row in members))
    basis = "by Plankopf" if _by_title_block(members) else "by file name"
    asked = wanted.strip()
    lines = [
        f'Fassungen of "{asked}" on {where}: {len(members)} files, newest first.'
        if len(members) > 1
        else f'"{asked}" on {where}: only this one Fassung.'
    ]
    for number, row in enumerate(members[:MAX_CHAIN_LINES], start=1):
        lines.append(_chain_line(number, row, current=number == 1, mark=confirmed.get(row.key), basis=basis))
    if len(members) > MAX_CHAIN_LINES:
        lines.append(f"… and {len(members) - MAX_CHAIN_LINES} more, older Fassungen.")
    if len(members) == 1:
        lines.append(
            "No other file name on this shelf belongs to it by name (Index, date), and no person has confirmed a "
            "replacement. If the same file was uploaded again, the row says so as a change against the previous "
            "upload."
        )
        return "\n".join(lines)
    lines.append(
        "The change note sits on the NEWER Fassung and compares it with the base named beside it; between two "
        "Fassungen that are not neighbours, read the rows in between together. It is a summary by Piloti, not "
        "proof: what changed page by page is shown by `list_files(revisions_of=…, compare_to=…)`, and you check a "
        "measurement by reading the document. An older Fassung stays readable on request; otherwise "
        "rely on the current one. Write file names exactly as they appear here."
    )
    return "\n".join(lines)
