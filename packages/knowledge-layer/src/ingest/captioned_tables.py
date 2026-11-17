from __future__ import annotations

import re
from dataclasses import dataclass
from dataclasses import field
from typing import Any

CAPTION_RE = re.compile(r"^Tabelle\s+(?P<id>\d+[a-z]?)\s*:\s*(?P<title>.*)$")
_CAPTION_REACH = 72
_CONTINUATION_TOP = 140
MAX_CHUNK_CHARS = 1600


@dataclass
class PageTable:

    table_id: str
    title: str
    rows: list[list[str]]
    page_number: int
    continuation: bool = False


@dataclass
class Table:

    table_id: str
    title: str
    rows: list[list[str]]
    page_start: int
    page_end: int
    header_rows: int = 1
    pages: list[int] = field(default_factory=list)


def _clean(cell: Any) -> str:
    return re.sub(r"\s+", " ", str(cell or "")).strip().replace("|", "/")


def _caption_above(page: Any, top: float) -> tuple[str, str] | None:
    x0, page_top, x1, _bottom = page.bbox
    region = page.within_bbox((x0, max(page_top, top - _CAPTION_REACH), x1, max(page_top + 1.0, top)))
    lines = [line.strip() for line in (region.extract_text() or "").splitlines() if line.strip()]
    for index in range(len(lines) - 1, -1, -1):
        match = CAPTION_RE.match(lines[index])
        if match:
            title = " ".join([match.group("title"), *lines[index + 1 :]]).strip()
            return match.group("id"), title
    return None


def _continues(previous: PageTable | None, page_number: int) -> bool:
    return previous is not None and page_number == previous.page_number + 1


def extract_page_tables(page: Any, page_number: int, previous: PageTable | None) -> list[tuple[PageTable, tuple]]:
    found: list[tuple[PageTable, tuple]] = []
    for table in page.find_tables():
        rows = [[_clean(cell) for cell in row] for row in (table.extract() or [])]
        rows = [row for row in rows if any(row)]
        if len(rows) < 2 or len(rows[0]) < 2:
            continue
        caption = _caption_above(page, table.bbox[1])
        if caption:
            found.append((PageTable(caption[0], caption[1], rows, page_number), table.bbox))
        elif _continues(previous, page_number) and not found and table.bbox[1] - page.bbox[1] < _CONTINUATION_TOP:
            found.append(
                (PageTable(previous.table_id, previous.title, rows, page_number, continuation=True), table.bbox)
            )
    return found


def _header_rows(rows: list[list[str]]) -> int:
    return 2 if len(rows) > 2 and not rows[1][0] and any(rows[1][1:]) else 1


def join_fragments(fragments: list[PageTable]) -> list[Table]:
    tables: list[Table] = []
    for fragment in fragments:
        if fragment.continuation and tables and tables[-1].table_id == fragment.table_id:
            table = tables[-1]
            rows = fragment.rows
            header = table.rows[: table.header_rows]
            if rows[: len(header)] == header:
                rows = rows[len(header) :]
            table.rows.extend(rows)
            table.page_end = fragment.page_number
            table.pages.append(fragment.page_number)
            continue
        tables.append(
            Table(
                table_id=fragment.table_id,
                title=fragment.title,
                rows=list(fragment.rows),
                page_start=fragment.page_number,
                page_end=fragment.page_number,
                header_rows=_header_rows(fragment.rows),
                pages=[fragment.page_number],
            )
        )
    return tables


def _markdown_row(row: list[str], width: int) -> str:
    cells = [*row, *[""] * (width - len(row))][:width]
    return "| " + " | ".join(cells) + " |"


def _header_markdown(table: Table, width: int) -> list[str]:
    header = table.rows[: table.header_rows]
    if not header:
        return [_markdown_row([], width), "|" + "---|" * width]
    if len(header) == 2:
        merged, last = [], ""
        for top, sub in zip(header[0] + [""] * width, header[1] + [""] * width, strict=False):
            last = top or last
            merged.append(f"{last} {sub}".strip() if sub else top)
        header = [merged[:width]]
    return [_markdown_row(header[0], width), "|" + "---|" * width]


def markdown_chunks(table: Table, max_chars: int = MAX_CHUNK_CHARS) -> list[str]:
    return [text for _first, _last, text in markdown_row_groups(table, max_chars)]


def markdown_row_groups(table: Table, max_chars: int = MAX_CHUNK_CHARS) -> list[tuple[int, int, str]]:
    width = max(len(row) for row in table.rows)
    head = _header_markdown(table, width)
    head_chars = sum(len(line) + 1 for line in head)
    groups: list[tuple[int, list[str]]] = [(0, [])]
    size = head_chars
    for index, row in enumerate(table.rows[table.header_rows :]):
        line = _markdown_row(row, width)
        if groups[-1][1] and size + len(line) + 1 > max_chars:
            groups.append((index, []))
            size = head_chars
        groups[-1][1].append(line)
        size += len(line) + 1
    return [(first, first + len(body) - 1, "\n".join([*head, *body])) for first, body in groups if body]


def page_text_with_tables(text: str, tables: list[PageTable]) -> str:
    parts = [text] if text else []
    for fragment in tables:
        table = join_fragments([fragment])[0]
        if fragment.continuation:
            table.header_rows = 0
        label = f"Tabelle {table.table_id}"
        caption = "" if fragment.continuation else (f"{label}: {table.title}" if table.title else label)
        body = "\n".join(markdown_chunks(table, max_chars=10**9))
        parts.append("\n\n".join(part for part in (caption, body) if part))
    return "\n\n".join(parts)
