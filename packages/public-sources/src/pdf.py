"""A public PDF's text, by ingestion's own text pass, behind the guard third-party bytes need.

A country publishes much of its law as PDF: the OIB guidelines, a Land's
gazette, a municipality's ordinance, an authority's guide. A capture of one
(ADR-0170) keeps its text so a quote can be checked (KC-6), and a source whose
documents are PDFs (``pdf_document``) reads its pages as passages.

There is one PDF pipeline. The text is :func:`knowledge_layer.ingest.pdf_page_texts`,
the text pass every PDF the corpus indexes goes through (watermarks dropped,
dense pages read by PDFium, each page on its own), so a quote that holds
against a capture holds against what the agent later retrieves from the same
document. This module adds only what the bytes being a stranger's asks for:

* **Bytes and pages are capped.** The body is capped by the egress ceiling
  (:data:`public_sources.egress.MAX_BODY_BYTES`); a PDF of more than
  :data:`MAX_PDF_PAGES` pages is refused (``pdf_too_many_pages``).
* **A deadline and a memory ceiling.** The parse runs in a child process
  (``python -I -m public_sources.pdf``) that is killed after
  :data:`PARSE_TIMEOUT_SECONDS` and may not map more than
  :data:`MEMORY_LIMIT_BYTES`: a parser loop or a decompression bomb costs the
  child, never the server.
* **A refusal names its reason.** :class:`PdfError` carries a ``code``:
  ``pdf_encrypted`` (it needs a password), ``pdf_malformed`` (no PDF the reader
  can open, or too many unreadable pages by ingestion's own verdict),
  ``pdf_too_many_pages``, ``pdf_parse_timeout``.

Pages are joined with a form feed (``\\f``), as ``pdftotext`` joins them: the
quote check reads it as whitespace, so a quote over a page break still holds,
and the page of a quote is the number of form feeds before it, plus one.

A page with no text layer (a scan) keeps an empty text and :attr:`PdfText.note`
names it. Ingestion transcribes such a page with the vision model; this read
does not, so a quote from a scanned page cannot be checked yet (a follow-up:
the same transcription, here).
"""

from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import dataclass

#: The most pages a PDF may have to be read here.
MAX_PDF_PAGES = 1000
#: How long one parse may take before its process is killed.
PARSE_TIMEOUT_SECONDS = 60.0
#: The address space the parsing process may map.
MEMORY_LIMIT_BYTES = 2 * 1024**3
#: What joins two pages' text, and what a page is counted by.
PAGE_BREAK = "\f"

PDF_CONTENT_TYPE = "application/pdf"


class PdfError(ValueError):
    """A PDF that cannot be read. ``code`` is the problem's code, stable for a caller to branch on."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class PdfText:
    #: Each page's text, in order; an empty string for a page with no text layer.
    pages: tuple[str, ...]
    title: str = ""

    @property
    def text(self) -> str | None:
        """The pages joined by a form feed; ``None`` when no page has a text layer (a scan)."""
        if not any(page.strip() for page in self.pages):
            return None
        return PAGE_BREAK.join(self.pages)

    @property
    def note(self) -> str:
        """Which pages have no text layer, so nothing on them can be quoted. Empty when every page has text."""
        blank = [str(number) for number, page in enumerate(self.pages, start=1) if not page.strip()]
        if not blank:
            return ""
        which = "all of its pages" if len(blank) == len(self.pages) else f"pages {', '.join(blank[:20])}"
        return f"no text layer on {which} (a scan?): nothing there can be quoted; OCR is not done for a capture"


def is_pdf(content: bytes, content_type: str | None = None) -> bool:
    """Whether the body is a PDF: by its declared type, or by its magic bytes when a server says octet-stream."""
    kind = (content_type or "").split(";", 1)[0].strip().lower()
    return kind == PDF_CONTENT_TYPE or content[:1024].lstrip().startswith(b"%PDF-")


def _limit_memory() -> None:
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (MEMORY_LIMIT_BYTES, MEMORY_LIMIT_BYTES))
    except ImportError, ValueError, OSError:  # pragma: no cover - a platform without the limit reads without it
        pass


def _gate(content: bytes, max_pages: int) -> str:
    """Open the PDF once to refuse what ingestion's text pass would read as empty; answers its title."""
    import pypdfium2 as pdfium
    from pypdfium2 import raw

    try:
        document = pdfium.PdfDocument(content)
    except pdfium.PdfiumError as exc:
        if exc.err_code in (raw.FPDF_ERR_PASSWORD, raw.FPDF_ERR_SECURITY):
            raise PdfError(
                "pdf_encrypted", "the PDF needs a password to open; a source's text must be readable without one"
            ) from exc
        raise PdfError("pdf_malformed", f"the bytes are no PDF the reader can open: {exc}") from exc
    try:
        if len(document) > max_pages:
            raise PdfError("pdf_too_many_pages", f"the PDF has {len(document)} pages; at most {max_pages} are read")
        return str((document.get_metadata_dict() or {}).get("Title") or "").strip()
    finally:
        document.close()


def extract(content: bytes, max_pages: int = MAX_PDF_PAGES) -> PdfText:
    """Read ``content`` in this process. Callers use :func:`read_pdf`, which runs this in a child with a deadline."""
    from knowledge_layer.ingest import pdf_page_texts
    from knowledge_layer.ingest import unreadable_pdf_verdict

    title = _gate(content, max_pages)
    read = pdf_page_texts(content)
    verdict = unreadable_pdf_verdict(read)
    if verdict:
        raise PdfError("pdf_malformed", verdict)
    by_number = {entry["page_number"]: str(entry.get("text") or "") for entry in read}
    return PdfText(pages=tuple(by_number.get(n, "") for n in range(1, read.page_count + 1)), title=title)


def read_pdf(content: bytes, *, max_pages: int = MAX_PDF_PAGES, timeout: float = PARSE_TIMEOUT_SECONDS) -> PdfText:
    """The text of ``content``, read in a child process killed after ``timeout`` seconds. Raises :class:`PdfError`."""
    command = [sys.executable, "-I", "-m", "public_sources.pdf", str(max_pages)]
    try:
        done = subprocess.run(command, input=content, capture_output=True, timeout=timeout, check=False)  # noqa: S603
    except subprocess.TimeoutExpired as exc:
        raise PdfError("pdf_parse_timeout", f"reading the PDF took longer than {timeout:g} seconds") from exc
    try:
        answer = json.loads(done.stdout)
    except ValueError:
        answer = None
    if not isinstance(answer, dict):
        reason = done.stderr.decode("utf-8", errors="replace").strip().splitlines()[-1:] or [f"exit {done.returncode}"]
        raise PdfError("pdf_malformed", f"the PDF reader stopped: {reason[0][:300]}")
    if "error" in answer:
        raise PdfError(str(answer["error"]), str(answer.get("message", "")))
    return PdfText(pages=tuple(answer["pages"]), title=str(answer["title"]))


def main() -> int:
    """The child: PDF bytes on stdin, ``{pages, title}`` or ``{error, message}`` on stdout."""
    _limit_memory()
    max_pages = int(sys.argv[1]) if len(sys.argv) > 1 else MAX_PDF_PAGES
    try:
        result = extract(sys.stdin.buffer.read(), max_pages)
    except PdfError as exc:
        answer: dict = {"error": exc.code, "message": str(exc)}
    except MemoryError:
        answer = {"error": "pdf_malformed", "message": "the PDF needs more memory than a read may take"}
    else:
        answer = {"pages": list(result.pages), "title": result.title}
    sys.stdout.write(json.dumps(answer))
    return 0


if __name__ == "__main__":
    sys.exit(main())
