import dataclasses
import logging
from typing import Any
from typing import NamedTuple

from agent.knowledge.schema import FileStatus
from agent.knowledge.schema import IngestionJobStatus
from agent.knowledge.schema import QuarantineVerdict

from . import limits
from .text_chunks import page_texts_for_visual_heuristic

logger = logging.getLogger(__name__)


class _PdfScreen(NamedTuple):
    triage: Any = None
    checked: str = "full"

    def routing(self) -> dict[str, Any]:
        return {} if self.triage is None else {"triage": self.triage}


class ContentScreening:
    def _record_screening(
        self,
        job: IngestionJobStatus,
        file_index: int,
        rules: Any,
        outcome: str,
        quarantine: QuarantineVerdict | None = None,
    ) -> None:
        if rules is None:
            return
        with self._lock:
            if file_index < len(job.file_details):
                job.file_details[file_index].screening = outcome
                job.file_details[file_index].quarantine = quarantine if outcome == "quarantined" else None

    def _record_unscreened_rasters(self, job: IngestionJobStatus, file_index: int) -> None:
        with self._lock:
            if file_index < len(job.file_details) and job.file_details[file_index].screening == "clean":
                job.file_details[file_index].screening = "partial"

    def _screen_or_quarantine(
        self,
        job: IngestionJobStatus,
        file_index: int,
        rules: Any,
        pages: list[tuple[int | None, str]],
        checked: str,
        stream: list[tuple[int, str]] | None = None,
        *,
        after_transcription: bool = False,
    ) -> bool:
        from knowledge_layer.ingest import screening

        if rules is None:
            return False
        if not any(text.strip() for _page, text in pages):
            self._record_screening(job, file_index, rules, "unchecked")
            return False
        verdict = screening.screen_pages(pages, rules, checked=checked, stream=stream or ())
        if after_transcription:
            verdict = dataclasses.replace(verdict, after_transcription=True)
        if not verdict.matched:
            self._record_screening(job, file_index, rules, "clean" if checked == "full" else "partial")
            return False
        self._record_screening(job, file_index, rules, "quarantined", verdict.to_model())
        self._update_file_status(job, file_index, FileStatus.FAILED, error=screening.quarantine_error(verdict))
        logger.info(
            "Quarantined file %d of job %s %s: %s (checked %s)",
            file_index + 1,
            job.job_id,
            "after transcription" if after_transcription else "before any model call",
            screening.log_summary(verdict),
            verdict.checked,
        )
        return True

    def _screen_transcribed(
        self,
        job: IngestionJobStatus,
        file_index: int,
        rules: Any,
        text_pages: list[dict[str, Any]],
        *,
        transcribed: bool,
    ) -> bool:
        body = [(page["page_number"], page.get("text") or "") for page in text_pages]
        return self._screen_or_quarantine(
            job, file_index, rules, list(body), "partial", stream=body, after_transcription=transcribed
        )

    def _screen_pdf(
        self,
        job: IngestionJobStatus,
        file_index: int,
        rules: Any,
        source_path: str,
        text_pages: list[dict[str, Any]],
        companions: list[Any],
        *,
        captions_rasters: bool,
    ) -> _PdfScreen | None:
        if rules is None:
            return _PdfScreen()
        from knowledge_layer.ingest import parsed_store
        from knowledge_layer.ingest.screening import document_pages

        page_texts = page_texts_for_visual_heuristic(text_pages)
        triage = parsed_store.current().triage(
            source_path,
            page_texts,
            min_text_chars=limits.VISUAL_PAGE_MIN_TEXT_CHARS,
            min_paths=limits.VISUAL_PAGE_MIN_PATHS,
        )
        has_rasters = any(page.get("image_count") for page in text_pages)
        lost_pages = bool(getattr(text_pages, "failed_pages", ()))
        unscreened = (
            triage is None
            or bool(triage.transcribed or triage.drawings)
            or (captions_rasters and has_rasters)
            or lost_pages
        )
        body = sorted(page_texts.items())
        checked = "partial" if unscreened else "full"
        pages = [*body, *document_pages(companions)]
        if self._screen_or_quarantine(job, file_index, rules, pages, checked, stream=body):
            return None
        return _PdfScreen(triage, checked)

    def _screen_tables(
        self,
        job: IngestionJobStatus,
        file_index: int,
        rules: Any,
        table_documents: list[Any],
        checked: str,
    ) -> bool:
        if rules is None:
            return False
        from knowledge_layer.ingest.screening import document_pages

        pages = document_pages(table_documents)
        if not any(text.strip() for _page, text in pages):
            return False
        return self._screen_or_quarantine(job, file_index, rules, pages, checked)
