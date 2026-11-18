from __future__ import annotations

import re
from collections.abc import Callable
from collections.abc import Mapping
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
from decimal import Decimal
from decimal import InvalidOperation
from difflib import SequenceMatcher
from typing import Any

MAX_TABLES_SHOWN = 6
MAX_ROWS_SHOWN = 60
MAX_CELLS_PER_ROW = 8
MAX_CELL_CHARS = 80
MAX_KEY_CHARS = 60

KEY_FILLED_SHARE = 0.8
HEADER_PAIR_SHARE = 0.5

_CELL_SPLIT = re.compile(r"(?<!\\)\|")
_SEPARATOR_ROW = re.compile(r"^\|(?:\s*:?-{3,}:?\s*\|)+$")
_SPACE = re.compile(r"\s+")
_NUMBER = re.compile(r"^([+-]?\d+(?:[.,]\d+)*)\s*(.*)$")
_ROW_RANGE = re.compile(r"^(?:(?P<sheet>.*):\s*)?Zeilen?\s+\d+(?:-\d+)?$")
_LEADING_ZERO = re.compile(r"^[+-]?0\d")
_DOT_GROUPS = re.compile(r"^[+-]?\d{1,3}(?:\.\d{3})+$")


@dataclass(frozen=True)
class TableChunk:
    page: str
    locator: str
    text: str


@dataclass(frozen=True)
class CellChange:
    column: str
    first: str
    second: str


@dataclass(frozen=True)
class RowChange:
    key: str
    cells: tuple[CellChange, ...]
    first_place: str
    second_place: str


@dataclass(frozen=True)
class RowOnly:
    key: str
    cells: tuple[str, ...]
    place: str


@dataclass(frozen=True)
class TableDiff:
    first_label: str
    second_label: str
    key_column: str | None
    equal_rows: int
    changed: tuple[RowChange, ...]
    only_first: tuple[RowOnly, ...]
    only_second: tuple[RowOnly, ...]
    columns_only_first: tuple[str, ...] = ()
    columns_only_second: tuple[str, ...] = ()

    @property
    def differs(self) -> bool:
        return bool(
            self.changed or self.only_first or self.only_second or self.columns_only_first or self.columns_only_second
        )


@dataclass(frozen=True)
class TablesDiff:
    tables: tuple[TableDiff, ...] = ()
    unpaired_first: tuple[str, ...] = ()
    unpaired_second: tuple[str, ...] = ()

    @property
    def found(self) -> bool:
        return bool(self.tables or self.unpaired_first or self.unpaired_second)

    @property
    def differs(self) -> bool:
        return bool(self.unpaired_first or self.unpaired_second or any(table.differs for table in self.tables))


@dataclass
class _Row:
    cells: list[str]
    place: str


@dataclass
class _Table:
    name: str
    header: list[str]
    scope: tuple[str, str] | None = None
    rows: list[_Row] = field(default_factory=list)
    pages: list[str] = field(default_factory=list)

    @property
    def label(self) -> str:
        pages = list(dict.fromkeys(self.pages))
        return self.name if len(pages) < 2 else f"pages {pages[0]}–{pages[-1]}"

    @property
    def header_key(self) -> tuple[str, ...]:
        return tuple(_fold(name) for name in self.header)


def _fold(value: str) -> str:
    return _SPACE.sub(" ", value).strip().casefold()


def _cells(line: str) -> list[str]:
    parts = _CELL_SPLIT.split(line.strip())
    return [_SPACE.sub(" ", part.replace("\\|", "|")).strip() for part in parts[1:-1]]


def _place(chunk: TableChunk) -> str:
    page = chunk.page.strip()
    page_text = f"page {page}" if page.isdigit() else (f"„{page}“" if page else "")
    locator = chunk.locator.strip()
    if not locator:
        return page_text or "table"
    if not page_text or (page and page in locator):
        return locator
    return f"{locator}, {page_text}"


def _sheet(chunk: TableChunk) -> str:
    rows = _ROW_RANGE.match(chunk.locator.strip())
    named = (rows.group("sheet") or "").strip() if rows else ""
    page = chunk.page.strip()
    return named or ("" if page.isdigit() else page)


def _label(chunk: TableChunk) -> str:
    sheet = _sheet(chunk)
    if sheet:
        return f"„{sheet}“"
    if _ROW_RANGE.match(chunk.locator.strip()):
        page = chunk.page.strip()
        return f"page {page}" if page else "table"
    return _place(chunk)


def _column_names(header: list[str], width: int) -> list[str]:
    padded = [*header, *[""] * (width - len(header))][:width]
    return [name or f"column {index}" for index, name in enumerate(padded, start=1)]


def _scope(chunk: TableChunk) -> tuple[str, str] | None:
    sheet = _sheet(chunk)
    if sheet:
        return "sheet", _fold(sheet)
    locator = chunk.locator.strip()
    return None if not locator or _ROW_RANGE.match(locator) else ("caption", _fold(locator))


def parse_tables(chunks: Sequence[TableChunk]) -> list[_Table]:
    tables: dict[tuple[tuple[str, str] | None, tuple[str, ...]], _Table] = {}
    for chunk in chunks:
        lines = [line.strip() for line in chunk.text.splitlines() if line.lstrip().startswith("|")]
        if len(lines) < 2 or not _SEPARATOR_ROW.match(lines[1].replace(" ", "")):
            continue
        rows = [_cells(line) for line in lines]
        width = max(len(row) for row in rows)
        header = _column_names(rows[0], width)
        scope = _scope(chunk)
        table = tables.setdefault(
            (scope, tuple(_fold(name) for name in header)), _Table(name=_label(chunk), header=header, scope=scope)
        )
        if scope is None:
            table.pages.append(chunk.page.strip())
        table.rows.extend(_filled_rows(rows[2:], width, _place(chunk)))
    return [table for table in tables.values() if table.rows]


def _filled_rows(rows: list[list[str]], width: int, place: str) -> list[_Row]:
    padded = ([*row, *[""] * (width - len(row))][:width] for row in rows)
    return [_Row(cells=cells, place=place) for cells in padded if any(cells)]


def _header_share(first: _Table, second: _Table) -> float:
    one, two = set(first.header_key), set(second.header_key)
    return len(one & two) / len(one | two) if one | two else 0.0


def _same_place(table: _Table, left: list[_Table]) -> _Table | None:
    return next((other for other in left if (other.scope, other.header_key) == (table.scope, table.header_key)), None)


def _same_header(table: _Table, left: list[_Table]) -> _Table | None:
    return next((other for other in left if other.header_key == table.header_key), None)


def _like_header(table: _Table, left: list[_Table]) -> _Table | None:
    best = max(left, key=lambda other: _header_share(table, other), default=None)
    return best if best is not None and _header_share(table, best) >= HEADER_PAIR_SHARE else None


def _take_pairs(
    waiting: list[_Table], left: list[_Table], match: Callable[[_Table, list[_Table]], _Table | None]
) -> tuple[list[tuple[_Table, _Table]], list[_Table]]:
    pairs: list[tuple[_Table, _Table]] = []
    unpaired: list[_Table] = []
    for table in waiting:
        other = match(table, left)
        if other is None:
            unpaired.append(table)
            continue
        left.remove(other)
        pairs.append((table, other))
    return pairs, unpaired


def _pair_tables(
    first: list[_Table], second: list[_Table]
) -> tuple[list[tuple[_Table, _Table]], list[_Table], list[_Table]]:
    pairs: list[tuple[_Table, _Table]] = []
    waiting, left = list(first), list(second)
    for match in (_same_place, _same_header, _like_header):
        found, waiting = _take_pairs(waiting, left, match)
        pairs.extend(found)
    order = {id(table): index for index, table in enumerate(first)}
    pairs.sort(key=lambda pair: order[id(pair[0])])
    return pairs, waiting, left


def _shared_columns(first: _Table, second: _Table) -> list[tuple[str, int, int]]:
    positions: dict[str, int] = {}
    for index, name in enumerate(second.header_key):
        positions.setdefault(name, index)
    shared: list[tuple[str, int, int]] = []
    seen: set[str] = set()
    for index, name in enumerate(first.header_key):
        if name in positions and name not in seen:
            seen.add(name)
            shared.append((first.header[index], index, positions[name]))
    return shared


def _key_values(table: _Table, column: int) -> list[str] | None:
    values = [_fold(row.cells[column]) for row in table.rows]
    filled = [value for value in values if value]
    if not filled or len(filled) < KEY_FILLED_SHARE * len(values) or len(set(filled)) != len(filled):
        return None
    return values


def _key_column(first: _Table, second: _Table, shared: list[tuple[str, int, int]]) -> tuple[str, int, int] | None:
    best: tuple[int, tuple[str, int, int]] | None = None
    for column in shared:
        one, two = _key_values(first, column[1]), _key_values(second, column[2])
        if one is None or two is None:
            continue
        overlap = len(set(one) & set(two) - {""})
        if overlap and (best is None or overlap > best[0]):
            best = (overlap, column)
    return best[1] if best else None


def _number(value: str) -> tuple[Decimal, str, str] | None:
    match = _NUMBER.match(value.strip())
    if not match:
        return None
    digits = match.group(1)
    if _LEADING_ZERO.match(digits):
        return None
    mark = "," if "," in digits else "."
    if mark == ",":
        digits = digits.replace(".", "").replace(",", ".")
    elif _DOT_GROUPS.match(digits):
        if digits.count(".") == 1:
            return None
        digits = digits.replace(".", "")
    try:
        return Decimal(digits), _fold(match.group(2)), mark if "." in digits else ""
    except InvalidOperation:
        return None


def same_cell(first: str, second: str) -> bool:
    if _fold(first) == _fold(second):
        return True
    one, two = _number(first), _number(second)
    if one is None or two is None or one[:2] != two[:2]:
        return False
    written_two_ways = bool(one[1]) or one[2] != two[2]
    return written_two_ways or one[0].as_tuple().exponent == two[0].as_tuple().exponent


def _clip(text: str, limit: int = MAX_CELL_CHARS) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _row_name(row: _Row, key: int | None) -> str:
    if key is not None and row.cells[key]:
        return _clip(row.cells[key], MAX_KEY_CHARS)
    return _clip(" | ".join(cell for cell in row.cells if cell), MAX_KEY_CHARS)


def _cell_changes(first: _Row, second: _Row, shared: list[tuple[str, int, int]]) -> tuple[CellChange, ...]:
    return tuple(
        CellChange(column=name, first=first.cells[i], second=second.cells[j])
        for name, i, j in shared
        if not same_cell(first.cells[i], second.cells[j])
    )


def _only(row: _Row, key: int | None) -> RowOnly:
    return RowOnly(key=_row_name(row, key), cells=tuple(row.cells), place=row.place)


def _row_change(first: _Row, second: _Row, shared: list[tuple[str, int, int]], key: int | None) -> RowChange | None:
    cells = _cell_changes(first, second, shared)
    if not cells:
        return None
    return RowChange(key=_row_name(second, key), cells=cells, first_place=first.place, second_place=second.place)


def _by_key(first: _Table, second: _Table, shared: list[tuple[str, int, int]], key: tuple[str, int, int]) -> TableDiff:
    _name, i, j = key
    theirs = {_fold(row.cells[j]): row for row in second.rows if row.cells[j]}
    matched: set[str] = set()
    equal = 0
    changed: list[RowChange] = []
    only_first: list[RowOnly] = []
    for row in first.rows:
        other = theirs.get(_fold(row.cells[i])) if row.cells[i] else None
        if other is None:
            only_first.append(_only(row, i))
            continue
        matched.add(_fold(row.cells[i]))
        change = _row_change(row, other, shared, j)
        if change is None:
            equal += 1
        else:
            changed.append(change)
    only_second = [_only(row, j) for row in second.rows if not row.cells[j] or _fold(row.cells[j]) not in matched]
    return _table_diff(first, second, shared, key[0], equal, changed, only_first, only_second)


def _in_order(first: _Table, second: _Table, shared: list[tuple[str, int, int]]) -> TableDiff:
    one = [tuple(_fold(row.cells[i]) for _name, i, _j in shared) for row in first.rows]
    two = [tuple(_fold(row.cells[j]) for _name, _i, j in shared) for row in second.rows]
    equal = 0
    changed: list[RowChange] = []
    only_first: list[RowOnly] = []
    only_second: list[RowOnly] = []
    for tag, i1, i2, j1, j2 in SequenceMatcher(a=one, b=two, autojunk=False).get_opcodes():
        if tag == "equal":
            equal += i2 - i1
            continue
        old_block, new_block = first.rows[i1:i2], second.rows[j1:j2]
        paired = min(len(old_block), len(new_block)) if tag == "replace" else 0
        changes = [
            _row_change(old_row, new_row, shared, None)
            for old_row, new_row in zip(old_block[:paired], new_block[:paired], strict=True)
        ]
        changed.extend(change for change in changes if change is not None)
        equal += changes.count(None)
        only_first.extend(_only(row, None) for row in old_block[paired:])
        only_second.extend(_only(row, None) for row in new_block[paired:])
    return _table_diff(first, second, shared, None, equal, changed, only_first, only_second)


def _table_diff(
    first: _Table,
    second: _Table,
    shared: list[tuple[str, int, int]],
    key_column: str | None,
    equal: int,
    changed: list[RowChange],
    only_first: list[RowOnly],
    only_second: list[RowOnly],
) -> TableDiff:
    shared_first = {i for _name, i, _j in shared}
    shared_second = {j for _name, _i, j in shared}
    return TableDiff(
        first_label=first.label,
        second_label=second.label,
        key_column=key_column,
        equal_rows=equal,
        changed=tuple(changed),
        only_first=tuple(only_first),
        only_second=tuple(only_second),
        columns_only_first=tuple(name for index, name in enumerate(first.header) if index not in shared_first),
        columns_only_second=tuple(name for index, name in enumerate(second.header) if index not in shared_second),
    )


def diff_tables(first: Sequence[TableChunk], second: Sequence[TableChunk]) -> TablesDiff:
    pairs, unpaired_first, unpaired_second = _pair_tables(parse_tables(first), parse_tables(second))
    tables: list[TableDiff] = []
    for one, two in pairs:
        shared = _shared_columns(one, two)
        key = _key_column(one, two, shared)
        tables.append(_by_key(one, two, shared, key) if key else _in_order(one, two, shared))
    return TablesDiff(
        tables=tuple(tables),
        unpaired_first=tuple(table.label for table in unpaired_first),
        unpaired_second=tuple(table.label for table in unpaired_second),
    )


def table_chunk_from_store(text: str | None, metadata: Mapping[str, Any] | None) -> TableChunk | None:
    metadata = metadata or {}
    if str(metadata.get("content_type") or "") != "table" or not text:
        return None
    return TableChunk(
        page=str(metadata.get("page_label") or ""), locator=str(metadata.get("clause_id") or ""), text=text
    )


def _places(change: RowChange, first_name: str, second_name: str) -> str:
    return f"[„{first_name}“: {change.first_place} · „{second_name}“: {change.second_place}]"


def _changed_line(change: RowChange, first_name: str, second_name: str) -> str:
    cells = "; ".join(
        f"{cell.column} {_clip(cell.first) or '—'} → {_clip(cell.second) or '—'}"
        for cell in change.cells[:MAX_CELLS_PER_ROW]
    )
    more = len(change.cells) - MAX_CELLS_PER_ROW
    rest = f" and {more} more columns" if more > 0 else ""
    return f"- Row „{change.key}“: {cells}{rest}. {_places(change, first_name, second_name)}"


def _only_line(row: RowOnly, file_name: str) -> str:
    cells = " | ".join(_clip(cell) for cell in row.cells[:MAX_CELLS_PER_ROW] if cell)
    return f"- Only in „{file_name}“: row „{row.key}“ ({cells}). [{row.place}]"


def _table_lines(table: TableDiff, first_name: str, second_name: str) -> list[str]:
    same_place = table.first_label == table.second_label
    title = table.first_label if same_place else f"{table.first_label} ↔ {table.second_label}"
    matched = (
        f"rows matched by column „{table.key_column}“"
        if table.key_column
        else "no column identifies a row in both files, so rows are matched in their order"
    )
    lines = [
        f"Table {title}: {matched}; {table.equal_rows} equal, {len(table.changed)} differ, "
        f"{len(table.only_first)} only in „{first_name}“, {len(table.only_second)} only in „{second_name}“."
    ]
    if table.columns_only_first:
        lines.append(f"Columns only in „{first_name}“ (not compared): {', '.join(table.columns_only_first)}.")
    if table.columns_only_second:
        lines.append(f"Columns only in „{second_name}“ (not compared): {', '.join(table.columns_only_second)}.")
    rows = [
        *(_changed_line(change, first_name, second_name) for change in table.changed),
        *(_only_line(row, first_name) for row in table.only_first),
        *(_only_line(row, second_name) for row in table.only_second),
    ]
    lines.extend(rows[:MAX_ROWS_SHOWN])
    if len(rows) > MAX_ROWS_SHOWN:
        lines.append(
            f"… and {len(rows) - MAX_ROWS_SHOWN} more deviating rows in this table that are NOT listed here; "
            "say that the list is cut, and read the table itself for the rest."
        )
    return lines


def render_tables(diff: TablesDiff, first_name: str, second_name: str) -> list[str]:
    if not diff.found:
        return []
    lines = [f"Tables, row by row („{first_name}“ → „{second_name}“):"]
    shown = sorted(diff.tables, key=lambda table: not table.differs)[:MAX_TABLES_SHOWN]
    for table in shown:
        lines.extend(_table_lines(table, first_name, second_name))
    if len(diff.tables) > MAX_TABLES_SHOWN:
        lines.append(f"… and {len(diff.tables) - MAX_TABLES_SHOWN} more tables that are not listed here.")
    if diff.unpaired_first:
        lines.append(f"Tables only in „{first_name}“: {', '.join(diff.unpaired_first[:MAX_TABLES_SHOWN])}.")
    if diff.unpaired_second:
        lines.append(f"Tables only in „{second_name}“: {', '.join(diff.unpaired_second[:MAX_TABLES_SHOWN])}.")
    return lines
