from __future__ import annotations

from pydantic import Field

from public_sources.engines.base import Engine
from public_sources.engines.base import EngineConfig
from public_sources.engines.base import EngineError
from public_sources.engines.base import ParsedDocument
from public_sources.engines.base import Passage
from public_sources.pdf import MAX_PDF_PAGES
from public_sources.pdf import PAGE_BREAK
from public_sources.pdf import PDF_CONTENT_TYPE
from public_sources.pdf import PdfError
from public_sources.pdf import PdfText
from public_sources.pdf import read_pdf


class PdfDocumentConfig(EngineConfig):
    title: str = ""
    max_pages: int = Field(default=MAX_PDF_PAGES, ge=1, le=MAX_PDF_PAGES)


class PdfDocument(Engine):
    name = "pdf_document"
    config_model = PdfDocumentConfig

    def document(self, body: bytes, *, url: str = "") -> ParsedDocument:
        try:
            read = read_pdf(body, max_pages=self.config.max_pages)
        except PdfError as exc:
            raise EngineError(f"{exc.code}: {exc}") from exc
        return self.document_from(read, url=url)

    def recorded_document(self, text: str, *, url: str = "", content_type: str = "") -> ParsedDocument:
        if (content_type or "").split(";", 1)[0].strip().lower() != PDF_CONTENT_TYPE:
            raise EngineError(
                f"the capture is {content_type or 'of no known content type'}, not a PDF: "
                "a pdf_document fixture is proven by a capture of the PDF itself"
            )
        pages = tuple(text.split(PAGE_BREAK))
        if len(pages) > self.config.max_pages:
            raise EngineError(f"pdf_too_many_pages: the capture holds {len(pages)} pages, over {self.config.max_pages}")
        return self.document_from(PdfText(pages=pages, page_count=len(pages)), url=url)

    def document_from(self, read: PdfText, *, url: str = "") -> ParsedDocument:
        passages = tuple(
            Passage(anchor=f"page_{number}", number=str(number), heading="", text=text)
            for number, text in enumerate(read.pages, start=1)
            if text.strip()
        )
        return ParsedDocument(title=self.config.title or read.title, uri=url, passages=passages)
