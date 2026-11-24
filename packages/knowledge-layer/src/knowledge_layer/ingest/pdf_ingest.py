import logging
from dataclasses import dataclass
from dataclasses import field
from typing import Any

from agent.knowledge.schema import FileStatus

from . import limits
from . import pdf_rasters
from .chunking_choice import is_released_text as _released
from .chunking_choice import text_documents_for_pages as _chunk
from .file_ingest import Extracted
from .file_ingest import FileRun
from .file_ingest import text_extracted
from .ingest_run import JobRun
from .measures import _stage
from .memory_use import _log_memory
from .pdf_tables import _table_pass_skips
from .pdf_text import unreadable_pdf_verdict
from .text_chunks import page_texts_for_visual_heuristic

logger = logging.getLogger(__name__)


@dataclass
class _PdfText:
    text_pages: Any
    page_routes: Any
    text_documents: list[Any]
    companions: list[Any] = field(default_factory=list)
    tables: list[dict[str, Any]] = field(default_factory=list)
    table_documents: list[Any] = field(default_factory=list)


def _rendition_companions(original_path: str, file_name: str, file_size: int) -> list[Any]:
    from knowledge_layer.ingest import office_extractors

    try:
        return office_extractors.extract_rendition_companions(original_path, file_name, file_size)
    except Exception as error:  # noqa: BLE001 — per-unit fail-open, named in the log
        logger.warning("Speaker notes of %s skipped: %s", file_name, type(error).__name__)
        return []


def read_pdf(ingestor: Any, run: JobRun, file: FileRun) -> Extracted | None:
    read = _read_pdf_text(ingestor, run, file)
    if read is None:
        return None
    all_documents = text_extracted(read.text_documents)
    all_documents.extend(read.companions)
    if run.extract_tables:
        all_documents.extend(read.table_documents)
        run.total_tables += len(read.tables)
        logger.info(f"  Table extraction: {len(read.tables)} tables")
    visuals, drawing_pages = _read_visuals(ingestor, run, file, read)
    all_documents.extend(visuals)
    return Extracted(read.text_documents, all_documents, drawing_pages)


def _parsed_text(ingestor: Any, run: JobRun, file: FileRun) -> tuple[Any, Any] | None:
    from knowledge_layer.ingest import parsed_store

    with _stage(file.stages, "text"):
        parse = file.scope.enter_context(parsed_store.open_for(run.config, run.collection_name, file.source_path))
        text_pages = parse.text_pages(file.source_path)
    dense_pages = getattr(text_pages, "dense_pages", [])
    _log_memory(f"text:done pages={len(text_pages)} without_layout={len(dense_pages)}")
    if dense_pages:
        ingestor._record_file_counts(run.job, file.index, pages_read_without_layout=len(dense_pages))
    unreadable = unreadable_pdf_verdict(text_pages)
    if unreadable:
        ingestor._update_file_status(run.job, file.index, FileStatus.FAILED, error=unreadable)
        logger.warning("Failing %s: %s", file.file_name, unreadable)
        return None
    ingestor._record_failed_pages(run.job, file.index, text_pages)
    return parse, text_pages


def _screened_tables(
    ingestor: Any, run: JobRun, file: FileRun, parse: Any, text_pages: Any, screen: Any
) -> tuple[list[dict[str, Any]], list[Any]] | None:
    from knowledge_layer.ingest.section_chunking import uncaptioned_table_documents

    taken = {page["page_number"]: page.get("table_boxes") or [] for page in text_pages}
    skip = _table_pass_skips(
        getattr(text_pages, "dense_pages", []),
        screen.triage,
        vision_reads=bool(run.vlm_api_key) and limits.RENDER_VISUAL_PAGES,
    )
    with _stage(file.stages, "tables"):
        tables = parse.tables(file.source_path, taken, skip)
    _log_memory(f"tables:done tables={len(tables)}")
    table_documents = [
        document for table in tables for document in uncaptioned_table_documents(table, file.file_name, file.file_size)
    ]
    with _stage(file.stages, "screen"):
        held = ingestor._screen_tables(run.job, file.index, run.screening_rules, table_documents, screen.checked)
    return None if held else (tables, table_documents)


def _read_pdf_text(ingestor: Any, run: JobRun, file: FileRun) -> _PdfText | None:
    parsed = _parsed_text(ingestor, run, file)
    if parsed is None:
        return None
    parse, text_pages = parsed
    companions = _rendition_companions(file.file_path, file.file_name, file.file_size) if file.rendition else []
    with _stage(file.stages, "screen"):
        screen = ingestor._screen_pdf(
            run.job,
            file.index,
            run.screening_rules,
            file.source_path,
            text_pages,
            companions,
            captions_rasters=bool(run.vlm_api_key) and (run.extract_images or run.extract_charts),
        )
    if screen is None:
        return None
    tables: tuple[list[dict[str, Any]], list[Any]] | None = ([], [])
    if run.extract_tables:
        tables = _screened_tables(ingestor, run, file, parse, text_pages, screen)
    if tables is None:
        return None
    parse.save()
    page_routes = _routed_pages(ingestor, run, file, text_pages, screen)
    if page_routes is None:
        return None
    text_documents = _chunk(text_pages, file.file_name, file.file_size, _released(run.config, run.collection_name))
    return _PdfText(text_pages, page_routes, text_documents, companions, *tables)


def _routed_pages(ingestor: Any, run: JobRun, file: FileRun, text_pages: Any, screen: Any) -> Any:
    from knowledge_layer.ingest import page_reads
    from knowledge_layer.ingest import transcription as _transcription

    reads = file.scope.enter_context(page_reads.file_page_reads())
    if limits.RENDER_VISUAL_PAGES and run.vlm_api_key:
        reads.read_drawings_ahead(
            screen.triage,
            file.source_path,
            cap=limits.MAX_RENDERED_PAGES,
            max_dim=limits.PAGE_RENDER_MAX_DIM,
            vision={**run.vision, "extract_charts": run.extract_charts},
        )
    with _stage(file.stages, "ocr"):
        page_routes = _transcription.route_pdf_pages(
            file.source_path,
            text_pages,
            page_texts_for_visual_heuristic(text_pages),
            vlm_api_key=run.vlm_api_key,
            model=run.ocr_model,
            base_url=run.vlm_base_url,
            min_text_chars=limits.VISUAL_PAGE_MIN_TEXT_CHARS,
            min_paths=limits.VISUAL_PAGE_MIN_PATHS,
            max_ocr_pages=limits.MAX_OCR_PAGES,
            max_dim=limits.PAGE_RENDER_MAX_DIM,
            **screen.routing(),
        )
    return _after_transcription(ingestor, run, file, text_pages, page_routes)


def _after_transcription(ingestor: Any, run: JobRun, file: FileRun, text_pages: Any, page_routes: Any) -> Any:
    from knowledge_layer.ingest import transcription as _transcription

    ingestor._record_file_counts(run.job, file.index, **page_routes.counts())
    changed = bool(page_routes.outcome.texts or page_routes.garbled_kept)
    if changed and ingestor._screen_transcribed(
        run.job, file.index, run.screening_rules, text_pages, transcribed=bool(page_routes.outcome.texts)
    ):
        return None
    ingestor._thumbnail_after_screen(run.config.get("thumbnail_upload_url"), file.source_path)
    if page_routes.not_transcribed and not text_pages:
        ingestor._update_file_status(run.job, file.index, FileStatus.FAILED, error=_transcription.SCAN_NEEDS_VLM)
        logger.warning("Scanned PDF not ingested (VLM not configured): %s", file.file_name)
        return None
    return page_routes


def _rendered_drawings(ingestor: Any, run: JobRun, file: FileRun, read: _PdfText) -> list[dict[str, Any]]:
    from knowledge_layer.ingest import processing as _processing

    if not (limits.RENDER_VISUAL_PAGES and run.vlm_api_key):
        return []
    with _stage(file.stages, "renders"):
        drawing_pages_raw = _processing.render_visual_pages_no_vlm(
            file.source_path,
            min_text_chars=limits.VISUAL_PAGE_MIN_TEXT_CHARS,
            min_paths=limits.VISUAL_PAGE_MIN_PATHS,
            max_pages=limits.MAX_RENDERED_PAGES,
            max_dim=limits.PAGE_RENDER_MAX_DIM,
            page_texts=page_texts_for_visual_heuristic(read.text_pages),
            only_pages=read.page_routes.drawing_pages,
        )
    drawing_over_cap = len(read.page_routes.drawing_pages or ()) - limits.MAX_RENDERED_PAGES
    if drawing_over_cap > 0:
        ingestor._record_file_counts(run.job, file.index, drawing_pages_over_cap=drawing_over_cap)
    return drawing_pages_raw


def _embedded_rasters(
    ingestor: Any, run: JobRun, file: FileRun, read: _PdfText, drawing_pages_raw: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    with _stage(file.stages, "rasters"):
        images, images_over_cap, images_over_pixel_budget = pdf_rasters._embedded_images_for_analysis(
            file.source_path,
            rendered_pages={page["page_number"] for page in drawing_pages_raw} | read.page_routes.scan_pages,
            enabled=run.extract_images or run.extract_charts,
        )
    if images_over_cap:
        ingestor._record_file_counts(run.job, file.index, images_over_cap=images_over_cap)
    if images_over_pixel_budget:
        ingestor._record_file_counts(run.job, file.index, images_over_pixel_budget=images_over_pixel_budget)
    if images and run.vlm_api_key:
        ingestor._record_unscreened_rasters(run.job, file.index)
    return images


def _read_visuals(ingestor: Any, run: JobRun, file: FileRun, read: _PdfText) -> tuple[list[Any], list[dict]]:
    from knowledge_layer.ingest import processing as _processing

    drawing_pages_raw = _rendered_drawings(ingestor, run, file, read)
    images = _embedded_rasters(ingestor, run, file, read, drawing_pages_raw)

    with _stage(file.stages, "vision"):
        image_results, drawing_pages = _processing.enrich_vlm_batch(
            image_records=images,
            drawing_pages=drawing_pages_raw,
            vlm_model=run.vlm_model,
            vlm_base_url=run.vlm_base_url,
            vlm_api_key=run.vlm_api_key,
            extract_charts=run.extract_charts,
        )

    file.coverage = _pdf_coverage(run, read, len(drawing_pages_raw), len(drawing_pages))
    _store_page_text(ingestor, run, file, read, drawing_pages)
    _store_images(run, image_results)
    return _visual_documents(run, file, image_results, drawing_pages), drawing_pages


def _pdf_coverage(run: JobRun, read: _PdfText, rendered: int, drawings_read: int) -> Any:
    from knowledge_layer.ingest.coverage import reading_coverage

    text_pages, outcome = read.text_pages, read.page_routes.outcome
    return reading_coverage(
        page_count=getattr(text_pages, "page_count", 0) or len(text_pages),
        text_pages=text_pages,
        drawing_pages=read.page_routes.drawing_pages,
        rendered=rendered,
        read=drawings_read,
        transcribed=len(outcome.texts),
        transcription_failed=len(outcome.failed),
        transcription_over_cap=len(outcome.over_cap),
        not_transcribed=len(read.page_routes.not_transcribed),
        vision_configured=bool(run.vlm_api_key) and limits.RENDER_VISUAL_PAGES,
    )


def _store_page_text(
    ingestor: Any, run: JobRun, file: FileRun, read: _PdfText, drawing_pages: list[dict[str, Any]]
) -> None:
    if not run.config.get("document_id"):
        return
    from knowledge_layer.ingest import page_text_store

    text_pages = read.text_pages
    ingestor._bounded(
        "Page text",
        file.file_name,
        limits.PAGE_TEXT_TIMEOUT_SECONDS,
        page_text_store.store_page_text,
        page_text_store.pdf_pages(
            text_pages,
            transcribed=read.page_routes.outcome.texts,
            ocr_model=run.ocr_model,
            drawings=drawing_pages,
            vision_model=run.vlm_model,
            tables=read.tables,
        ),
        page_count=getattr(text_pages, "page_count", 0) or len(text_pages),
        failed_pages=getattr(text_pages, "failed_pages", ()),
        document_id=str(run.config["document_id"]),
        collection=run.collection_name,
        organization_id=run.organization_id,
    )


def _store_images(run: JobRun, image_results: list[Any]) -> None:
    document_id = run.config.get("document_id")
    if not (document_id and image_results):
        return
    from knowledge_layer.ingest import image_store as _image_store

    _image_store.store_extracted_images(
        image_results,
        document_id=str(document_id),
        collection=run.collection_name,
        organization_id=run.organization_id,
    )


def _visual_documents(
    run: JobRun, file: FileRun, image_results: list[Any], drawing_pages: list[dict[str, Any]]
) -> list[Any]:
    from knowledge_layer.ingest.pdf_visuals import visual_documents_for_pdf

    visuals = visual_documents_for_pdf(
        image_results,
        drawing_pages,
        file_name=file.file_name,
        file_size=file.file_size,
        extract_images=run.extract_images,
        extract_charts=run.extract_charts,
    )
    run.total_charts += visuals.charts
    run.total_images += visuals.images
    return visuals.documents
