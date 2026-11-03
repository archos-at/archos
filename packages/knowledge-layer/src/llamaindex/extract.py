"""The page fan-out's first step: parse a file once, store the parse, list the pages that need a model (ADR-0151).

With ``INGEST_PAGE_FAN_OUT`` on, a standard file is read in steps that may land on
different workers. :func:`extract` downloads the original, runs the text pass,
the triage and the table pass through ``parsed_store`` (so the assembly reads them
back instead of parsing again), applies the upload screen's verdict to what it
read, and answers which pages need a transcription or a drawing's reading:
one ``read_page`` task each. It returns references and counts only, never a
document's text. Free of the orchestrator's SDK.

A file it does not fan out (not a one-file job the BFF dispatched, not a PDF, no
vision key, an unreadable PDF, a file the screen holds, a failed download) is
left whole to the assembly, which reads it exactly as the one-step path does and
records what went wrong there.
"""

from __future__ import annotations

import logging
from typing import Any

from .read_page import DRAWING
from .read_page import TRANSCRIBE
from .read_page import delete
from .read_page import download
from .read_page import vision_settings

logger = logging.getLogger(__name__)


def fans_out(prepared: Any) -> bool:
    """Only a one-file job the BFF dispatched has a version to store step outputs under."""
    return len(prepared.file_paths) == 1 and bool(prepared.config.get("document_id"))


def _not_fanned_out(reason: str) -> dict[str, Any]:
    return {"fan_out": False, "reason": reason, "content_hash": None, "pages": []}


def extract(ingestor: Any, prepared: Any) -> dict[str, Any]:
    """Parse the file and store the parse; which pages need a model. ``fan_out`` false leaves it to the assembly."""
    if not fans_out(prepared):
        return _not_fanned_out("not_one_dispatched_file")
    source, downloaded = download(prepared)
    try:
        if source is None:
            return _not_fanned_out("download_failed")
        return _extract_pdf(ingestor, prepared, ingestor._job_config(prepared), source)
    finally:
        delete(downloaded)


def _extract_pdf(ingestor: Any, prepared: Any, config: dict[str, Any], source: str) -> dict[str, Any]:
    from . import adapter
    from . import parsed_store
    from .chunk_identity import file_version

    if not (config.get("extraction_paths") or source.lower().endswith(".pdf") or adapter._looks_like_pdf(source)):
        return _not_fanned_out("not_a_pdf")
    if not vision_settings(ingestor, config).api_key:
        return _not_fanned_out("no_vision_key")
    content_hash = file_version(source)
    with parsed_store.open_for(config, prepared.collection_name, source) as parse:
        text_pages = parse.text_pages(source)
        if adapter.unreadable_pdf_verdict(text_pages):
            return _not_fanned_out("unreadable")
        page_texts = adapter.page_texts_for_visual_heuristic(text_pages)
        triage = parse.triage(
            source,
            page_texts,
            min_text_chars=adapter.VISUAL_PAGE_MIN_TEXT_CHARS,
            min_paths=adapter.VISUAL_PAGE_MIN_PATHS,
        )
        vision_reads = adapter.RENDER_VISUAL_PAGES
        tables = []
        if config.get("extract_tables", ingestor.extract_tables):
            tables = _tables(parse, config, source, text_pages, triage, vision_reads)
        if _held_by_screen(config, page_texts, tables):
            return _not_fanned_out("held")
        parse.save()
    pages = _pages_to_read(triage, vision_reads)
    return {"fan_out": bool(pages), "reason": None, "content_hash": content_hash, "pages": pages}


def _tables(parse: Any, config: dict[str, Any], source: str, text_pages: Any, triage: Any, vision_reads: bool) -> list:
    """The table pass as ``_ingest_job`` runs it, so the parse it stores is the one the assembly reads back."""
    from . import adapter
    from .screening import ScreeningRules
    from .section_chunking import uncaptioned_table_documents

    # ``_ingest_job`` hands the skip the triage only when the screen measured it (rules present).
    screened = ScreeningRules.from_config(config.get("screening")) is not None
    taken = {page["page_number"]: page.get("table_boxes") or [] for page in text_pages}
    skip = adapter._table_pass_skips(
        getattr(text_pages, "dense_pages", []), triage if screened else None, vision_reads=vision_reads
    )
    tables = parse.tables(source, taken, skip)
    return [document for table in tables for document in uncaptioned_table_documents(table, "", 0)]


def _held_by_screen(config: dict[str, Any], page_texts: dict[int, str], table_documents: list[Any]) -> bool:
    """The upload screen's pre-verdict on the text layer and the tables, before any page reaches a model.

    A held file fans nothing out; the assembly screens it again and records the
    quarantine as the one-step path does.
    """
    from agent.common.content_screen import screening_config_unusable

    from . import screening

    if screening_config_unusable(config.get("screening")):
        return True
    rules = screening.ScreeningRules.from_config(config.get("screening"))
    if rules is None:
        return False
    body = sorted(page_texts.items())
    pages = [*body, *screening.document_pages(table_documents)]
    if not any(text.strip() for _page, text in pages):
        return False
    return screening.screen_pages(pages, rules, checked="partial", stream=body).matched


def _pages_to_read(triage: Any, vision_reads: bool) -> list[dict[str, Any]]:
    """The pages the pipeline would read with a model: scans and garbled pages, and drawings within the cap."""
    from . import adapter

    if triage is None:
        return []
    pages = [{"page": n, "kind": TRANSCRIBE} for n in sorted(triage.transcribed)[: adapter.MAX_OCR_PAGES]]
    if vision_reads:
        pages += [{"page": n, "kind": DRAWING} for n in sorted(triage.drawings)[: adapter.MAX_RENDERED_PAGES]]
    return sorted(pages, key=lambda page: page["page"])
