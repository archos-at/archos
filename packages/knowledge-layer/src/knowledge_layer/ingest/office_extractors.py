from __future__ import annotations

import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

MAX_TABLE_ROWS = 10_000
MAX_TABLE_COLS = 60
MAX_CELL_CHARS = 500


def _clean_cell(value: Any) -> str:
    if value is None:
        return ""
    return str(value).replace("|", "\\|").replace("\n", " ").strip()[:MAX_CELL_CHARS]


def _cells_cut(row: tuple[Any, ...]) -> int:
    beyond = sum(1 for value in row[MAX_TABLE_COLS:] if value not in (None, ""))
    shortened = sum(
        1 for value in row[:MAX_TABLE_COLS] if value is not None and len(str(value).strip()) > MAX_CELL_CHARS
    )
    return beyond + shortened


def _sheet_rows(sheet: Any) -> tuple[list[tuple[int, list[str]]], int, int]:
    rows: list[tuple[int, list[str]]] = []
    over_cap = 0
    cut = 0
    for number, row in enumerate(sheet.iter_rows(values_only=True), start=1):
        cells = [_clean_cell(cell) for cell in row[:MAX_TABLE_COLS]]
        if not any(cells) and not any(value not in (None, "") for value in row[MAX_TABLE_COLS:]):
            continue
        if len(rows) >= MAX_TABLE_ROWS:
            over_cap += 1
            continue
        cut += _cells_cut(row)
        if any(cells):
            rows.append((number, cells))
    return rows, over_cap, cut


def _sheet_units(
    title: str, rows: list[tuple[int, list[str]]], over_cap: int, cut: int = 0
) -> list[tuple[str, str, dict]]:
    from knowledge_layer.ingest.captioned_tables import Table
    from knowledge_layer.ingest.captioned_tables import markdown_row_groups

    header_rows = 1 if len(rows) > 1 else 0
    table = Table("", "", [cells for _number, cells in rows], page_start=0, page_end=0, header_rows=header_rows)
    numbers = [number for number, _cells in rows[header_rows:]]
    groups = markdown_row_groups(table)
    units = []
    for part, (first, last, markdown) in enumerate(groups, start=1):
        rows_label = f"Zeilen {numbers[first]}-{numbers[last]}" if last != first else f"Zeile {numbers[first]}"
        suffix = f" (Teil {part} von {len(groups)})" if len(groups) > 1 else ""
        text = f"Tabellenblatt „{title}“, {rows_label}{suffix}\n\n{markdown}"
        extra: dict[str, Any] = {"clause_id": f"{title}: {rows_label}", "table_part": part, "chunking": "table"}
        if part == len(groups) and over_cap:
            text += f"\n\n[Tabelle gekürzt: {over_cap} weitere Zeilen nach den ersten {MAX_TABLE_ROWS} nicht indexiert]"
            extra["rows_over_cap"] = over_cap
        if part == len(groups) and cut:
            extra["content_cut"] = cut
        units.append((title, text, extra))
    return units


def _extract_xlsx(file_path: str) -> list[tuple[str, str, dict]]:
    from openpyxl import load_workbook

    units: list[tuple[str, str, dict]] = []
    workbook = load_workbook(file_path, read_only=True, data_only=True)
    try:
        for sheet in workbook.worksheets:
            rows, over_cap, cut = _sheet_rows(sheet)
            if rows:
                units.extend(_sheet_units(sheet.title, rows, over_cap, cut))
    finally:
        workbook.close()
    return units


def _slide_notes(slide: Any) -> str:
    if not getattr(slide, "has_notes_slide", False):
        return ""
    frame = slide.notes_slide.notes_text_frame
    return frame.text.strip() if frame is not None else ""


def _is_hidden(slide: Any) -> bool:
    return slide._element.get("show") in ("0", "false")


def _extract_pptx_notes(file_path: str) -> list[tuple[str, str]]:
    from pptx import Presentation

    units: list[tuple[str, str]] = []
    visible = [slide for slide in Presentation(file_path).slides if not _is_hidden(slide)]
    for page, slide in enumerate(visible, start=1):
        note_text = _slide_notes(slide)
        if note_text:
            units.append((str(page), f"Folie {page}, Notizen des Vortragenden\n\n{note_text}"))
    return units


_HANDLERS: dict[str, Callable[[str], list[tuple[str, str, dict]]]] = {
    ".xlsx": _extract_xlsx,
    ".xlsm": _extract_xlsx,
}

SUPPORTED_EXTENSIONS = frozenset(_HANDLERS)


_RENDITION_COMPANIONS: dict[str, Callable[[str], list[tuple[str, str]]]] = {
    ".pptx": _extract_pptx_notes,
    ".pptm": _extract_pptx_notes,
}


def _documents(units: list[tuple], file_name: str, file_size: int, content_type: str) -> list[Any]:
    from llama_index.core import Document

    from knowledge_layer.ingest.section_chunking import apply_exclusions

    documents = []
    for label, text, *extra in units:
        metadata = {"file_name": file_name, "file_size": file_size, "page_label": label, "content_type": content_type}
        documents.append(Document(text=text, metadata={**metadata, **(extra[0] if extra else {})}))
        apply_exclusions(documents[-1])
    return documents


def rows_over_cap(documents: list[Any]) -> int:
    return sum(int((getattr(doc, "metadata", None) or {}).get("rows_over_cap") or 0) for doc in documents)


def content_cut(documents: list[Any]) -> int:
    return sum(int((getattr(doc, "metadata", None) or {}).get("content_cut") or 0) for doc in documents)


def extract_rendition_companions(file_path: str, file_name: str, file_size: int) -> list[Any]:
    extension = (Path(file_name).suffix or Path(file_path).suffix).lower()
    handler = _RENDITION_COMPANIONS.get(extension)
    if handler is None:
        return []
    units = handler(file_path)
    logger.info("Rendition companion (%s): %d unit(s) from %s", extension, len(units), file_name)
    return _documents(units, file_name, file_size, "text")


def extract_office_documents(file_path: str, file_name: str, file_size: int) -> list[Any] | None:
    extension = (Path(file_name).suffix or Path(file_path).suffix).lower()
    handler = _HANDLERS.get(extension)
    if handler is None:
        return None

    units = handler(file_path)
    logger.info("Office extraction (%s): %d unit(s) from %s", extension, len(units), file_name)
    return _documents(units, file_name, file_size, "table")
