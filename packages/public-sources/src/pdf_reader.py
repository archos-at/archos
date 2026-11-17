"""The child process that reads a PDF: ``python -I -m public_sources.pdf_reader <max_pages> <memory> <max_chars>``.

:func:`public_sources.pdf.read_pdf` starts it, hands it the PDF on stdin and
reads ``{pages, page_count, title}`` or ``{error, message}`` from stdout. It
runs ingestion's own text pass (:func:`knowledge_layer.ingest.pdf_page_texts`)
under the limits a stranger's bytes need: an address-space ceiling, no core
file, and a cap on the text it answers, so a small PDF that expands to a
hundred million characters costs this process, never the server.

Its own module, which ``public_sources/__init__`` does not import: run with
``-m``, a module the package already imported would be imported twice, and
runpy's warning about it would stand in stderr for whatever really went wrong.
"""

from __future__ import annotations

import json
import sys

from public_sources.pdf import MAX_PDF_PAGES
from public_sources.pdf import MAX_TEXT_CHARS
from public_sources.pdf import MEMORY_LIMIT_BYTES
from public_sources.pdf import PdfError


def _limit(memory_bytes: int) -> None:
    """The address space this process may map, and no core file of the bytes it read."""
    import resource

    resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def _gate(content: bytes, max_pages: int) -> tuple[int, str]:
    """Open the PDF once, to refuse what the text pass would read as empty: ``(pages, title)``."""
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
        return len(document), str((document.get_metadata_dict() or {}).get("Title") or "").strip()
    finally:
        document.close()


def _within(pages: list[str], limit: int) -> list[str]:
    """The pages, whole, while their text fits ``limit`` characters; the first page cut to it when it alone does not."""
    kept: list[str] = []
    total = 0
    for page in pages:
        if total + len(page) > limit:
            return kept or [page[:limit]]
        kept.append(page)
        total += len(page) + 1  # the form feed that joins it to the next
    return kept


def extract(content: bytes, max_pages: int = MAX_PDF_PAGES, max_chars: int = MAX_TEXT_CHARS) -> dict:
    """``{pages, page_count, title}``: the text pass's pages, as many as fit the text cap."""
    from knowledge_layer.ingest import pdf_page_texts
    from knowledge_layer.ingest import unreadable_pdf_verdict

    page_count, title = _gate(content, max_pages)
    read = pdf_page_texts(content)
    verdict = unreadable_pdf_verdict(read)
    if verdict:
        raise PdfError("pdf_malformed", verdict)
    by_number = {entry["page_number"]: str(entry.get("text") or "") for entry in read}
    pages = [by_number.get(number, "") for number in range(1, page_count + 1)]
    return {"pages": _within(pages, max_chars), "page_count": page_count, "title": title}


def main() -> int:
    max_pages = int(sys.argv[1]) if len(sys.argv) > 1 else MAX_PDF_PAGES
    _limit(int(sys.argv[2]) if len(sys.argv) > 2 else MEMORY_LIMIT_BYTES)
    max_chars = int(sys.argv[3]) if len(sys.argv) > 3 else MAX_TEXT_CHARS
    try:
        answer = extract(sys.stdin.buffer.read(), max_pages, max_chars)
    except PdfError as exc:
        answer = {"error": exc.code, "message": str(exc)}
    except MemoryError:
        answer = {"error": "pdf_reader_failed", "message": "reading the PDF needs more memory than a read may take"}
    sys.stdout.write(json.dumps(answer))
    return 0


if __name__ == "__main__":
    sys.exit(main())
