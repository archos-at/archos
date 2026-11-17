import logging
from collections.abc import Sequence
from typing import Any

from . import limits

logger = logging.getLogger(__name__)


def _table_pass_skips(dense_pages: Sequence[int], triage: Any, *, vision_reads: bool) -> list[int]:
    skip = set(dense_pages)
    if vision_reads and triage is not None:
        skip.update(sorted(triage.drawings)[: limits.MAX_RENDERED_PAGES])
    return sorted(skip)


def _extract_tables_from_pdf(
    pdf_path: str, taken: dict[int, list[tuple]] | None = None, skip_pages: Sequence[int] = ()
) -> list[dict[str, Any]]:
    taken = taken or {}
    try:
        import pdfplumber
    except ImportError:
        logger.warning("pdfplumber not installed. Install with: pip install pdfplumber")
        return []

    tables: list[dict[str, Any]] = []
    try:
        with pdfplumber.open(pdf_path) as pdf:
            _collect_tables(pdf, tables, taken, set(skip_pages))

        logger.info(f"Extracted {len(tables)} tables from {pdf_path}")

    except Exception as e:
        logger.error(f"Error extracting tables from PDF: {e}")

    return tables


def _collect_tables(pdf: Any, tables: list[dict[str, Any]], taken: dict[int, list[tuple]], skipped: set[int]) -> None:
    for page_num, page in enumerate(pdf.pages):
        if page_num + 1 in skipped:
            continue
        try:
            tables.extend(_page_tables(page, page_num, taken.get(page_num + 1) or []))
        finally:
            page.close()


def _page_tables(page: Any, page_num: int, skip: list[tuple]) -> list[dict[str, Any]]:
    tables = []
    for table_idx, found in enumerate(page.find_tables()):
        if tuple(found.bbox) in skip:
            continue
        table = found.extract()
        if not table or len(table) < 2:
            continue
        markdown = _table_to_markdown(table)
        if markdown:
            tables.append(
                {
                    "table_text": markdown,
                    "cells": table,
                    "page_number": page_num + 1,
                    "table_index": table_idx,
                    "rows": len(table),
                    "cols": len(table[0]),
                }
            )
    return tables


def _clean_cell(cell: Any) -> str:
    if cell is None:
        return ""
    return str(cell).replace("|", "\\|").replace("\n", " ").strip()


def _table_to_markdown(table: list[list[str]]) -> str:
    if not table or not table[0]:
        return ""

    lines = []

    header = [_clean_cell(cell) for cell in table[0]]
    lines.append("| " + " | ".join(header) + " |")
    lines.append("| " + " | ".join(["---"] * len(header)) + " |")

    for row in table[1:]:
        cells = [_clean_cell(cell) for cell in row]
        cells.extend([""] * (len(header) - len(cells)))
        lines.append("| " + " | ".join(cells[: len(header)]) + " |")

    return "\n".join(lines)
