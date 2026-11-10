"""``pdf_document``: a document published as a PDF, into one passage per page.

For what a country publishes only as PDF: a guideline (the OIB-Richtlinien), a
Land's gazette, a municipal ordinance, an authority's guide. A PDF has no
provision markup a record could point at, so the passage is the page, and its
anchor is ``page_<n>``: a citation resolves to the document's URI and the page
a person turns to, and a monitor compares pages by it. The document's bytes are
what a ``sha256`` monitor watches, as for every other format.

The text is ingestion's text pass, read by :func:`public_sources.pdf.read_pdf`
in a child process with a deadline: the same text the corpus indexes once the
document is published. A PDF that needs a password, cannot be parsed or has
more pages than the record allows is an :class:`EngineError` naming the
problem's code; a page with no text layer (a scan) is no passage, so a
fixture's ``min_passages`` or ``contains`` fails on a scan.
"""

from __future__ import annotations

from public_sources.engines.base import Engine
from public_sources.engines.base import EngineConfig
from public_sources.engines.base import EngineError
from public_sources.engines.base import ParsedDocument
from public_sources.engines.base import Passage
from public_sources.pdf import MAX_PDF_PAGES
from public_sources.pdf import PdfError
from public_sources.pdf import PdfText
from public_sources.pdf import read_pdf
from pydantic import Field


class PdfDocumentConfig(EngineConfig):
    #: The document's title; the PDF's own metadata title when empty.
    title: str = ""
    #: The most pages a document may have; a longer one is refused.
    max_pages: int = Field(default=MAX_PDF_PAGES, ge=1, le=MAX_PDF_PAGES)


class PdfDocument(Engine):
    name = "pdf_document"
    config_model = PdfDocumentConfig

    def document(self, body: bytes, *, url: str = "") -> ParsedDocument:
        """Blocking: the PDF is read in a child process; an async caller runs this with ``asyncio.to_thread``."""
        try:
            read = read_pdf(body, max_pages=self.config.max_pages)
        except PdfError as exc:
            raise EngineError(f"{exc.code}: {exc}") from exc
        return self.document_from(read, url=url)

    def document_from(self, read: PdfText, *, url: str = "") -> ParsedDocument:
        """The passages of a PDF already read, so a caller that also needs its text reads it once."""
        passages = tuple(
            Passage(anchor=f"page_{number}", number=str(number), heading="", text=text)
            for number, text in enumerate(read.pages, start=1)
            if text.strip()
        )
        return ParsedDocument(title=self.config.title or read.title, uri=url, passages=passages)
