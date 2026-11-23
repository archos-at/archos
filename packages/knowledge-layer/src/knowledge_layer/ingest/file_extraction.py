import logging
from typing import Any

from .file_ingest import Extracted
from .file_ingest import FileRun
from .file_ingest import text_extracted
from .ingest_run import JobRun
from .measures import _stage

logger = logging.getLogger(__name__)


def read_image(ingestor: Any, run: JobRun, file: FileRun) -> Extracted | None:
    from knowledge_layer.ingest.image_ingest import read_standalone_image

    image = read_standalone_image(
        ingestor,
        run.job,
        file.index,
        file_path=file.source_path,
        file_name=file.file_name,
        file_size=file.file_size,
        image_format=file.image_format,
        rules=run.screening_rules,
        thumbnail_upload_url=run.config.get("thumbnail_upload_url"),
        vision={**run.vision, "extract_charts": run.extract_charts},
        stages=file.stages,
    )
    file.photo, file.coverage, image_docs = image.photo, image.coverage, image.documents
    if image_docs is None:
        return None
    if image_docs[0].metadata.get("content_type") == "chart":
        run.total_charts += 1
    else:
        run.total_images += 1
    return Extracted(image_docs, text_extracted(image_docs))


def _office_or_text_documents(file: FileRun) -> list[Any] | None:
    from knowledge_layer.ingest import office_extractors
    from knowledge_layer.ingest.text_formats import extract_text_format_documents

    with _stage(file.stages, "text"):
        documents = office_extractors.extract_office_documents(file.file_path, file.file_name, file.file_size)
        if documents is None:
            documents = extract_text_format_documents(file.file_path, file.file_name, file.file_size)
    return documents


def _generic_documents(file: FileRun) -> list[Any]:
    from llama_index.core import SimpleDirectoryReader

    documents = SimpleDirectoryReader(input_files=[file.file_path]).load_data()
    for doc in documents:
        doc.metadata["file_name"] = file.file_name
        doc.metadata["file_size"] = file.file_size
    return documents


def read_text_file(ingestor: Any, run: JobRun, file: FileRun) -> Extracted | None:
    from knowledge_layer.ingest import office_extractors
    from knowledge_layer.ingest.renditions import resolve_preview
    from knowledge_layer.ingest.screening import document_pages

    office_documents = _office_or_text_documents(file)
    over_cap = 0
    if office_documents is not None:
        text_documents = office_documents
        over_cap = office_extractors.rows_over_cap(office_documents)
        if over_cap:
            ingestor._record_file_counts(run.job, file.index, rows_over_cap=over_cap)
    else:
        text_documents = _generic_documents(file)
    cut = office_extractors.content_cut(text_documents)
    checked = "partial" if over_cap or cut else "full"
    with _stage(file.stages, "screen"):
        held = ingestor._screen_or_quarantine(
            run.job, file.index, run.screening_rules, document_pages(text_documents), checked
        )
    if held:
        return None
    thumbnail_upload_url = run.config.get("thumbnail_upload_url")
    if thumbnail_upload_url:
        ingestor._thumbnail_after_screen(thumbnail_upload_url, resolve_preview(run.config, file.index, run.downloaded))
    return Extracted(text_documents, text_extracted(text_documents))
