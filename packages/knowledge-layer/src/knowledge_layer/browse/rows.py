from __future__ import annotations

from collections.abc import Iterable
from collections.abc import Mapping
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
from typing import Any

from agent.common.source_kinds import canonical_shelf_value
from agent.knowledge.mail_facts import mail_thread_date
from agent.knowledge.mail_facts import normalise_mail_origin
from agent.knowledge.mail_facts import normalise_mail_thread
from agent.knowledge.page_count import page_number
from agent.knowledge.title_block import display_date
from agent.knowledge.title_block import document_key
from agent.knowledge.title_block import newest_first
from knowledge_layer.revision_series import find_revision_series
from knowledge_layer.revision_series import revision_label

from .text import _words
from .text import fold

DEFAULT_PAGE_SIZE = 40

MAX_PAGE_SIZE = 100

MAX_FOLDER_LINES = 30

MAX_TYPE_COUNTS = 8

MAX_TOPIC_COUNTS = 8

MAX_SUMMARY_CHARS = 160

USER_SHELVES = ("project", "office_shelf", "session")

KNOWN_SHELVES = (*USER_SHELVES, "base")

_SHELF_LABELS = {
    "project": "Projektwissen",
    "office_shelf": "Büroablage",
    "session": "Private Sitzung",
    "base": "Basiswissen",
}

MAX_ROW_FACTS = 6

MAX_ROW_REFERENCES = 8


@dataclass(frozen=True)
class FileRow:
    file_name: str
    shelf: str | None
    collection: str
    folder: str = ""
    display_title: str | None = None
    doc_class: str | None = None
    tags: tuple[str, ...] = ()
    summary: str = ""
    added_at: str | None = None
    topics: tuple[str, ...] = ()
    captured_at: str | None = None
    camera: str | None = None
    superseded_by: str | None = None
    supersedes: tuple[str, ...] = ()
    licence_class: str | None = None
    quote_max_chars: int | None = None
    ai_processing_attested: bool = False
    change_summary: str | None = None
    change_basis: str | None = None
    revision_facts: Mapping[str, Any] | None = field(default=None, compare=False)
    page_count: int | None = None
    document_type: str | None = None
    facts: tuple[str, ...] = ()
    references: tuple[str, ...] = ()
    pages_not_read: int = 0
    fact_changes: tuple[str, ...] = ()
    mail_thread: Mapping[str, Any] | None = field(default=None, compare=False)
    mail_origin: Mapping[str, Any] | None = field(default=None, compare=False)

    @property
    def document_date(self) -> str | None:
        thread_date = mail_thread_date(self.mail_thread)
        stamp = str((self.revision_facts or {}).get("revision_date") or self.captured_at or thread_date or "")
        return stamp.strip()[:10] or None

    @property
    def searchable(self) -> str:
        return " ".join(_words(f"{self.file_name} {self.display_title or ''}"))


def _attr(row: Any, name: str) -> Any:
    return row.get(name) if isinstance(row, dict) else getattr(row, name, None)


def file_row(row: Any) -> FileRow | None:
    file_name = str(_attr(row, "file_name") or "").strip()
    if not file_name:
        return None
    shelf = _attr(row, "shelf")
    shelf = getattr(shelf, "value", shelf)
    capture = _attr(row, "capture")
    capture = capture if isinstance(capture, dict) else {}
    revision_facts = _attr(row, "revision_facts")
    return FileRow(
        file_name=file_name,
        shelf=canonical_shelf_value(str(shelf)) if shelf else None,
        collection=str(_attr(row, "collection") or ""),
        folder=str(_attr(row, "folder_path") or "").strip().strip("/"),
        display_title=(str(_attr(row, "display_title") or "").strip() or None),
        doc_class=(str(_attr(row, "doc_class") or "").strip() or None),
        tags=tuple(str(tag) for tag in (_attr(row, "tags") or ()) if tag),
        summary=" ".join(str(_attr(row, "summary") or "").split()),
        added_at=(str(_attr(row, "added_at") or "").strip()[:10] or None),
        topics=tuple(str(topic) for topic in (_attr(row, "topics") or ()) if topic),
        captured_at=(str(capture.get("captured_at") or "").strip() or None),
        camera=(str(capture.get("camera") or "").strip() or None),
        superseded_by=(str(_attr(row, "superseded_by") or "").strip() or None),
        supersedes=tuple(str(name) for name in (_attr(row, "supersedes") or ()) if name),
        change_summary=(str(_attr(row, "change_summary") or "").strip() or None),
        change_basis=(str(_attr(row, "change_basis") or "").strip() or None),
        revision_facts=revision_facts if isinstance(revision_facts, dict) and revision_facts else None,
        page_count=page_number(_attr(row, "page_count")),
        mail_thread=normalise_mail_thread(_attr(row, "mail_thread")),
        mail_origin=normalise_mail_origin(_attr(row, "mail_origin")),
        **_reading_fields(row),
    )


def _reading_fields(row: Any) -> dict[str, Any]:
    dossier = _attr(row, "dossier")
    dossier = dossier if isinstance(dossier, dict) else {}
    facts = []
    for fact in dossier.get("facts") or []:
        if not isinstance(fact, dict) or not fact.get("key") or not fact.get("value"):
            continue
        unit = f" {fact['unit']}" if fact.get("unit") else ""
        page = f" (p. {fact['page']})" if fact.get("page") else ""
        facts.append(f"{fact['key']} {fact['value']}{unit}{page}")
    references = [
        str(ref.get("label") or ref.get("key"))
        for ref in (_attr(row, "doc_references") or [])
        if isinstance(ref, dict) and (ref.get("label") or ref.get("key"))
    ]
    coverage = _attr(row, "coverage")
    not_read = coverage.get("not_read") if isinstance(coverage, dict) else 0
    document_type = dossier.get("document_type")
    changes = [
        f"{change['key']} {change.get('before') or '–'} → {change.get('after') or '–'}"
        for change in dossier.get("changes") or []
        if isinstance(change, dict) and change.get("key")
    ]
    return {
        "fact_changes": tuple(changes[:MAX_ROW_FACTS]),
        "document_type": str(document_type) if document_type else None,
        "facts": tuple(facts[:MAX_ROW_FACTS]),
        "references": tuple(references[:MAX_ROW_REFERENCES]),
        "pages_not_read": not_read if isinstance(not_read, int) and not_read > 0 else 0,
    }


def file_rows(rows: Iterable[Any]) -> list[FileRow]:
    seen: set[tuple[str, str]] = set()
    out: list[FileRow] = []
    for raw in rows:
        row = file_row(raw)
        if row is None or (row.collection, row.file_name) in seen:
            continue
        seen.add((row.collection, row.file_name))
        out.append(row)
    return out


def _in_folder(row: FileRow, folder: str) -> bool:
    return row.folder == folder or row.folder.startswith(f"{folder}/")


def _folder_matches(rows: Sequence[FileRow], folder: str) -> str | None:
    wanted = fold(folder)
    for row in rows:
        parts = row.folder.split("/") if row.folder else []
        for depth in range(1, len(parts) + 1):
            candidate = "/".join(parts[:depth])
            if fold(candidate) == wanted:
                return candidate
    return None


@dataclass
class Listing:
    rows: list[FileRow]
    total: int
    offset: int
    limit: int
    folder: str | None
    subfolders: list[tuple[str, int]] = field(default_factory=list)
    here: int = 0
    shelves: tuple[str, ...] = ()
    notes: list[str] = field(default_factory=list)
    types: list[tuple[str, int]] = field(default_factory=list)
    untyped: int = 0
    topics: list[tuple[str, int]] = field(default_factory=list)
    revision_marks: dict[tuple[str, str], str] = field(default_factory=dict)
    revision_series: int = 0
    confirmed_replacements: int = 0
    title_block_series: int = 0


def _type_profile(rows: Sequence[FileRow]) -> tuple[list[tuple[str, int]], int]:
    from agent.knowledge.document_classification import DOCUMENT_TYPE_TAGS

    known = set(DOCUMENT_TYPE_TAGS)
    counts: dict[str, int] = {}
    untyped = 0
    for row in rows:
        types = [tag for tag in dict.fromkeys(row.tags) if tag in known]
        if not types:
            untyped += 1
        for tag in types:
            counts[tag] = counts.get(tag, 0) + 1
    order = {tag: index for index, tag in enumerate(DOCUMENT_TYPE_TAGS)}
    ranked = sorted(counts.items(), key=lambda item: (item[0] == "Sonstiges", -item[1], order[item[0]]))
    return ranked, untyped


def _topic_profile(rows: Sequence[FileRow]) -> list[tuple[str, int]]:
    counts: dict[str, int] = {}
    spelling: dict[str, str] = {}
    for row in rows:
        seen: set[str] = set()
        for topic in row.topics:
            key = fold(topic)
            if key in seen:
                continue
            seen.add(key)
            spelling.setdefault(key, topic)
            counts[key] = counts.get(key, 0) + 1
    ranked = sorted(counts, key=lambda key: (-counts[key], key))
    return [(spelling[key], counts[key]) for key in ranked]


def _subfolders(rows: Sequence[FileRow], folder: str | None) -> tuple[list[tuple[str, int]], int]:
    counts: dict[str, int] = {}
    here = 0
    base = folder or ""
    for row in rows:
        rest = row.folder[len(base) :].lstrip("/") if base else row.folder
        if not rest:
            here += 1
            continue
        child = rest.split("/", 1)[0]
        path = f"{base}/{child}" if base else child
        counts[path] = counts.get(path, 0) + 1
    return sorted(counts.items(), key=lambda item: fold(item[0])), here


_RowKey = tuple[str, str]


def revision_marks(rows: Sequence[FileRow]) -> tuple[dict[_RowKey, str], dict[_RowKey, _RowKey]]:
    by_collection: dict[str, list[FileRow]] = {}
    for row in rows:
        by_collection.setdefault(row.collection, []).append(row)
    marks: dict[tuple[str, str], str] = {}
    series_of: dict[_RowKey, _RowKey] = {}
    for members in by_collection.values():
        for series in find_revision_series(
            members, filename=lambda row: row.file_name, created_at=lambda row: row.added_at
        ):
            head = series.current.item
            label = revision_label(series.current.revision)
            head_key = (head.collection, head.file_name)
            series_of[head_key] = head_key
            marks[(head.collection, head.file_name)] = (
                f"current Fassung ({label}; {len(series.older)} older, by file name)"
            )
            for member in series.older:
                older = member.item
                series_of[(older.collection, older.file_name)] = head_key
                marks[(older.collection, older.file_name)] = (
                    f"older Fassung ({revision_label(member.revision)}), current by file name: {head.file_name}"
                )
    return marks, series_of


def _state_label(facts: Mapping[str, Any] | None) -> str:
    facts = facts or {}
    parts = [f"Index {facts['revision']}"] if facts.get("revision") else []
    if facts.get("revision_date"):
        parts.append(f"Stand {display_date(str(facts['revision_date']))}")
    return ", ".join(parts) or "no Index"


def title_block_marks(rows: Sequence[FileRow]) -> tuple[dict[_RowKey, str], dict[_RowKey, _RowKey]]:
    groups: dict[tuple[str, str], list[FileRow]] = {}
    for row in rows:
        key = document_key((row.revision_facts or {}).get("document_number"))
        if key is not None:
            groups.setdefault((row.collection, key), []).append(row)
    marks: dict[_RowKey, str] = {}
    series_of: dict[_RowKey, _RowKey] = {}
    for members in groups.values():
        states = {
            ((m.revision_facts or {}).get("revision"), (m.revision_facts or {}).get("revision_date")) for m in members
        }
        if len(members) < 2 or len(states) < 2:
            continue
        ordered = newest_first(members, lambda row: row.revision_facts, lambda row: row.added_at or "")
        head, older = ordered[0], ordered[1:]
        head_key = (head.collection, head.file_name)
        series_of[head_key] = head_key
        marks[head_key] = f"current Fassung by Plankopf ({_state_label(head.revision_facts)}; {len(older)} older)"
        for row in older:
            series_of[(row.collection, row.file_name)] = head_key
            marks[(row.collection, row.file_name)] = (
                f"older Fassung by Plankopf ({_state_label(row.revision_facts)}), current by Plankopf: {head.file_name}"
            )
    return marks, series_of


def confirmed_revision_marks(rows: Sequence[FileRow]) -> dict[_RowKey, str]:
    present = {(row.collection, row.file_name) for row in rows}
    marks: dict[_RowKey, list[str]] = {}
    for row in rows:
        key = (row.collection, row.file_name)
        if row.superseded_by and (row.collection, row.superseded_by) in present:
            marks.setdefault(key, []).append(f"replaced by {row.superseded_by} (confirmed)")
        replaced = [name for name in row.supersedes if (row.collection, name) in present]
        if replaced:
            marks.setdefault(key, []).append(f"replaces {', '.join(replaced)} (confirmed)")
    return {key: "; ".join(parts) for key, parts in marks.items()}


def on_shelves(rows: Sequence[FileRow], *, shelf: str | None, default_shelves: Sequence[str]) -> list[FileRow]:
    shelves = (shelf,) if shelf else tuple(default_shelves)
    return [row for row in rows if row.shelf in shelves or (not shelf and row.shelf is None)]


def _filter_rows(
    rows: list[FileRow],
    *,
    doc_class: str | None,
    added_since: str | None,
    name_contains: str | None,
    topic: str | None,
) -> list[FileRow]:
    if doc_class:
        rows = [row for row in rows if row.doc_class == doc_class]
    if added_since:
        rows = [row for row in rows if row.added_at and row.added_at >= added_since]
    if name_contains:
        words = _words(name_contains)
        rows = [row for row in rows if all(word in row.searchable for word in words)]
    if topic:
        needle = fold(topic)
        rows = [row for row in rows if any(needle in fold(name) for name in row.topics)]
    return rows


def _sort_rows(rows: list[FileRow], sort: str) -> None:
    if sort == "newest":
        rows.sort(key=lambda row: (row.added_at or "", fold(row.file_name)), reverse=True)
        rows.sort(key=lambda row: row.added_at is None)
    elif sort == "name":
        rows.sort(key=lambda row: fold(row.file_name))
    else:
        rows.sort(key=lambda row: (fold(row.folder), fold(row.file_name)))


def select_files(
    rows: Sequence[FileRow],
    *,
    shelf: str | None = None,
    folder: str | None = None,
    name_contains: str | None = None,
    doc_class: str | None = None,
    added_since: str | None = None,
    topic: str | None = None,
    sort: str = "folder",
    offset: int = 0,
    limit: int = DEFAULT_PAGE_SIZE,
    default_shelves: Sequence[str] = USER_SHELVES,
) -> Listing:
    notes: list[str] = []
    shelves = (shelf,) if shelf else tuple(default_shelves)
    selected = on_shelves(rows, shelf=shelf, default_shelves=default_shelves)
    marks, series_of = revision_marks(selected)
    block_marks, block_series_of = title_block_marks(selected)
    confirmed = confirmed_revision_marks(selected)

    resolved_folder: str | None = None
    if folder:
        resolved_folder = _folder_matches(selected, folder)
        if resolved_folder is None:
            notes.append(f'No folder "{folder}" on these shelves. Call without `folder` to see the folders.')
            return Listing([], 0, offset, limit, folder, shelves=shelves, notes=notes)
        selected = [row for row in selected if _in_folder(row, resolved_folder)]

    selected = _filter_rows(
        selected, doc_class=doc_class, added_since=added_since, name_contains=name_contains, topic=topic
    )

    filtered = bool(doc_class or added_since or name_contains or topic)
    subfolders, here = ([], 0) if filtered else _subfolders(selected, resolved_folder)

    _sort_rows(selected, sort)

    total = len(selected)
    page = selected[offset : offset + limit]
    types, untyped = _type_profile(selected)
    keys = {(row.collection, row.file_name) for row in selected}
    return Listing(
        page,
        total,
        offset,
        limit,
        resolved_folder,
        subfolders,
        here,
        shelves,
        notes,
        types,
        untyped,
        topics=_topic_profile(selected),
        revision_marks={key: mark for key, mark in {**marks, **block_marks, **confirmed}.items() if key in keys},
        revision_series=len(
            {series_of[key] for key in keys if key in series_of and key not in confirmed and key not in block_marks}
        ),
        title_block_series=len(
            {block_series_of[key] for key in keys if key in block_series_of and key not in confirmed}
        ),
        confirmed_replacements=sum(
            1 for row in selected if row.superseded_by and (row.collection, row.file_name) in confirmed
        ),
    )


def _check_shelf(shelf: str | None) -> tuple[str | None, str]:
    shelf = canonical_shelf_value(shelf or "") or None
    if shelf is not None and shelf not in KNOWN_SHELVES:
        return None, f"`shelf` must be one of {', '.join(KNOWN_SHELVES)}, or omitted for the reader's own files."
    return shelf, ""
