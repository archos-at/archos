from __future__ import annotations

from collections.abc import Mapping
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from knowledge_layer.revision_series import parse_revision_name
from knowledge_layer.revision_series import revision_label

from .render import _in_flight_line
from .rows import MAX_TYPE_COUNTS
from .rows import FileRow
from .rows import _RowKey
from .rows import _state_label
from .rows import _subfolders
from .rows import _type_profile
from .rows import confirmed_revision_marks
from .rows import revision_marks
from .rows import title_block_marks
from .text import fold

DEFAULT_TREE_DEPTH = 2

MAX_TREE_DEPTH = 4

MAX_TREE_CARDS = 30

MAX_CURRENT_LINES = 3

MAX_CARD_SUBFOLDERS = 8

MAX_REPLACED_NAMES = 3

MAX_CARD_FILES = 8

TREE_PARAGRAPH = (
    '`view="tree"` (`depth=` 1-4, default 2) returns a card per folder instead of file lines: counts, '
    "Dokumentart mix, pages, dates, the current Fassung; filters apply, no paging.\n"
)


@dataclass(frozen=True)
class FolderCard:
    path: str
    depth: int
    direct: int
    total: int
    subfolders: tuple[tuple[str, int], ...]
    types: tuple[tuple[str, int], ...]
    untyped: int
    pages: int
    pages_unknown: int
    first_added: str | None
    last_added: str | None
    newest: str
    current: tuple[str, ...]
    superseded: int
    newest_document: str = ""
    files: tuple[str, ...] = ()


@dataclass(frozen=True)
class _Series:
    head: FileRow
    basis: str
    older: tuple[str, ...]


def _confirmed_head(row: FileRow, by_key: dict[_RowKey, FileRow]) -> FileRow | None:
    seen: set[_RowKey] = set()
    current = row
    while current.superseded_by and (current.collection, current.superseded_by) in by_key:
        seen.add((current.collection, current.file_name))
        current = by_key[(current.collection, current.superseded_by)]
        if (current.collection, current.file_name) in seen:
            return None
    return current


def _revision_series(rows: Sequence[FileRow]) -> list[_Series]:
    by_key = {(row.collection, row.file_name): row for row in rows}
    confirmed = confirmed_revision_marks(rows)
    heads: dict[_RowKey, _RowKey] = {}
    for row in rows:
        if row.superseded_by and (row.collection, row.superseded_by) in by_key:
            head = _confirmed_head(row, by_key)
            if head is not None:
                heads[(row.collection, row.file_name)] = (head.collection, head.file_name)
    replaced: dict[_RowKey, list[str]] = {}
    for key, head_key in heads.items():
        replaced.setdefault(head_key, []).append(key[1])
    _, block_series_of = title_block_marks(rows)
    _, name_series_of = revision_marks(rows)
    grouped: list[tuple[str, dict[_RowKey, list[str]]]] = []
    for basis, series_of, skip in (
        ("by Plankopf", block_series_of, set(confirmed)),
        ("by file name", name_series_of, set(confirmed) | set(block_series_of)),
    ):
        groups: dict[_RowKey, list[str]] = {}
        for key, head_key in series_of.items():
            if key == head_key or key in skip:
                continue
            if head_key in heads:
                replaced.setdefault(heads[head_key], []).append(key[1])
            else:
                groups.setdefault(head_key, []).append(key[1])
        grouped.append((basis, groups))
    series = [_Series(by_key[head], "confirmed", tuple(sorted(names, key=fold))) for head, names in replaced.items()]
    for basis, groups in grouped:
        series += [_Series(by_key[head], basis, tuple(sorted(names, key=fold))) for head, names in groups.items()]
    return series


def _series_label(head: FileRow, basis: str) -> str:
    facts = head.revision_facts or {}
    state = _state_label(facts) if facts.get("revision") or facts.get("revision_date") else ""
    if not state:
        name_revision = parse_revision_name(head.file_name)
        state = revision_label(name_revision) if name_revision is not None else ""
    return "; ".join(part for part in (state, basis) if part)


def _current_lines(series: Sequence[_Series], keys: set[_RowKey]) -> tuple[list[str], int]:
    lines: list[str] = []
    older_held = 0
    for entry in sorted(series, key=lambda item: fold(item.head.file_name)):
        collection = entry.head.collection
        older_held += sum(1 for name in entry.older if (collection, name) in keys)
        if (collection, entry.head.file_name) not in keys:
            continue
        shown = ", ".join(entry.older[:MAX_REPLACED_NAMES])
        more = len(entry.older) - MAX_REPLACED_NAMES
        replaces = f"{shown} and {more} more" if more > 0 else shown
        lines.append(f"{entry.head.file_name} ({_series_label(entry.head, entry.basis)}) replaces {replaces}")
    return lines, older_held


def _folder_card(path: str, depth: int, rows: Sequence[FileRow], series: Sequence[_Series]) -> FolderCard:
    subfolders, direct = _subfolders(rows, path or None)
    types, untyped = _type_profile(rows)
    dated = [row for row in rows if row.added_at]
    newest = max(dated, key=lambda row: (row.added_at or "", fold(row.file_name)), default=None)
    current, older_held = _current_lines(series, {(row.collection, row.file_name) for row in rows})
    own_dated = [row for row in rows if row.document_date]
    newest_own = max(own_dated, key=lambda row: (row.document_date or "", fold(row.file_name)), default=None)
    direct_rows = sorted((row for row in rows if row.folder == path), key=lambda row: fold(row.file_name))
    return FolderCard(
        path=path,
        depth=depth,
        direct=direct,
        total=len(rows),
        subfolders=tuple(subfolders),
        types=tuple(types),
        untyped=untyped,
        pages=sum(row.page_count or 0 for row in rows),
        pages_unknown=sum(1 for row in rows if row.page_count is None),
        first_added=min((row.added_at or "" for row in dated), default=None),
        last_added=max((row.added_at or "" for row in dated), default=None),
        newest=f"{newest.file_name} ({newest.added_at})" if newest else "",
        newest_document=f"{newest_own.file_name} ({newest_own.document_date})" if newest_own else "",
        files=tuple(row.file_name for row in direct_rows) if 0 < len(direct_rows) <= MAX_CARD_FILES else (),
        current=tuple(current),
        superseded=older_held,
    )


def _card_ancestors(folder: str, root: str, depth: int) -> list[str]:
    base = len(root.split("/")) if root else 0
    parts = folder.split("/") if folder else []
    return ["/".join(parts[:count]) for count in range(base, min(len(parts), base + depth) + 1)]


def _card_order(card: FolderCard) -> list[str]:
    return [fold(part) for part in card.path.split("/")] if card.path else []


def folder_cards(
    rows: Sequence[FileRow],
    *,
    root: str | None,
    depth: int = DEFAULT_TREE_DEPTH,
    series_rows: Sequence[FileRow] | None = None,
) -> list[FolderCard]:
    root = root or ""
    depth = max(0, min(depth, MAX_TREE_DEPTH))
    members: dict[str, list[FileRow]] = {}
    for row in rows:
        for path in _card_ancestors(row.folder, root, depth):
            members.setdefault(path, []).append(row)
    series = _revision_series(series_rows if series_rows is not None else rows)
    base = len(root.split("/")) if root else 0
    cards = [
        _folder_card(path, (len(path.split("/")) if path else 0) - base, group, series)
        for path, group in members.items()
    ]
    return sorted(cards, key=_card_order)


def _count(number: int, noun: str) -> str:
    return f"{number} {noun}{'' if number == 1 else 's'}"


def abstract_lines(found: Mapping[tuple[str, str], Any]) -> dict[str, list[str]]:
    lines: dict[str, list[str]] = {}
    for (_collection, path), card in sorted(found.items()):
        line = f"About: {card.abstract}"
        if card.status != "fresh":
            written = f", written {str(card.generated_at)[:10]}" if card.generated_at else ""
            line += f" ({card.status}{written})"
        lines.setdefault(path, []).append(line)
    return lines


def _card_lines(card: FolderCard, about: Sequence[str] = ()) -> list[str]:
    older = f"; {card.superseded} older Fassung{'' if card.superseded == 1 else 'en'}" if card.superseded else ""
    here = f"{card.direct} here, {card.total - card.direct} below{older}" if card.subfolders else f"all here{older}"
    head = f"{card.path}/" if card.path else "Top level"
    head += f"  {_count(card.total, 'document')} ({here})"
    if card.subfolders:
        head += f", {_count(len(card.subfolders), 'subfolder')}"
    if card.pages:
        head += f", {_count(card.pages, 'page')}"
        head += f" ({card.pages_unknown} without count)" if card.pages_unknown else ""
    lines = [head, *(f"  {line}" for line in about)]
    types = [f"{tag} {count}" for tag, count in card.types[:MAX_TYPE_COUNTS]]
    if card.untyped:
        types.append(f"untyped {card.untyped}")
    lines.append(f"  Dokumentart: {' · '.join(types)}")
    if card.first_added:
        span = card.first_added if card.first_added == card.last_added else f"{card.first_added} to {card.last_added}"
        if card.newest_document:
            lines.append(f"  Added: {span}. Newest by document date (Plankopf Stand or photo): {card.newest_document}")
        else:
            lines.append(f"  Added: {span}. Newest upload (no document date known): {card.newest}")
    if card.files:
        lines.append(f"  Files here: {' · '.join(card.files)}")
    elif card.direct > MAX_CARD_FILES:
        call = "a listing of the folder"
        lines.append(
            f"  Files here: {card.direct}, too many to name (a card names them up to {MAX_CARD_FILES}); "
            f"{call} lists them."
        )
    lines.extend(f"  Current Fassung: {line}" for line in card.current[:MAX_CURRENT_LINES])
    if len(card.current) > MAX_CURRENT_LINES:
        lines.append(f"  … and {len(card.current) - MAX_CURRENT_LINES} more documents with several Fassungen")
    if card.subfolders:
        names = [f"{path.rsplit('/', 1)[-1]}/ ({count})" for path, count in card.subfolders[:MAX_CARD_SUBFOLDERS]]
        rest = len(card.subfolders) - MAX_CARD_SUBFOLDERS
        lines.append(f"  Subfolders: {' · '.join(names)}{f' · and {rest} more' if rest > 0 else ''}")
    indent = "  " * card.depth
    return [indent + line for line in lines]


def render_tree(
    cards: Sequence[FolderCard],
    *,
    total_rows: int,
    notes: Sequence[str] = (),
    scope: str = "",
    in_flight: Sequence[str] = (),
    abstracts: Mapping[str, Sequence[str]] | None = None,
) -> str:
    abstracts = abstracts or {}
    lines: list[str] = [*notes]
    if not cards:
        if not notes:
            lines.append(f"No file{f' on {scope}' if scope else ''} matches these filters.")
        return "\n".join(lines)
    lines.append(f"{_count(total_rows, 'document')}{f' on {scope}' if scope else ''}, as folder cards:")
    shown = sorted(
        sorted(cards, key=lambda card: (card.depth, -card.total, _card_order(card)))[:MAX_TREE_CARDS], key=_card_order
    )
    for card in shown:
        lines.extend(_card_lines(card, abstracts.get(card.path, ())))
    hidden = len(cards) - len(shown)
    if hidden:
        lines.append(
            f"… {_count(hidden, 'folder')} not shown (the {MAX_TREE_CARDS} largest of the shallowest levels are). "
            'Open one with `list_files(folder="…", view="tree")`.'
        )
    if in_flight:
        lines.append(_in_flight_line(in_flight))
    lines.append(
        'The files of a folder: `list_files(folder="…")`. An index, not a source: never cite it; '
        "open a document with read_passage."
    )
    return "\n".join(lines)
