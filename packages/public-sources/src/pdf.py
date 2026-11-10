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

* **Bytes, pages and text are capped.** The body is capped by the egress
  ceiling (:data:`public_sources.egress.MAX_BODY_BYTES`); a PDF of more than
  :data:`MAX_PDF_PAGES` pages is refused (``pdf_too_many_pages``), a number the
  deadline reaches (about 0.09 s a page, measured on gesetze-im-internet.de's
  PDFs); the text is cut at :data:`MAX_TEXT_CHARS`, at a page boundary, and the
  note says up to which page.
* **A child process, held.** The parse runs in
  :mod:`public_sources.pdf_reader` (``python -I -m``), killed after
  :data:`PARSE_TIMEOUT_SECONDS`, which stays well below the BFF's budget for a
  capture so the door answers ``pdf_parse_timeout`` rather than "try again".
  It may map at most :data:`MEMORY_LIMIT_BYTES`, writes no core file, and
  starts with an environment of :data:`CHILD_ENV_KEYS` only, never the
  server's secrets. At most :data:`MAX_PDF_READERS` run at once.
* **A refusal names its reason.** :class:`PdfError` carries a ``code``:
  ``pdf_encrypted`` (it needs a password), ``pdf_malformed`` (no PDF the reader
  can open, or too many unreadable pages by ingestion's own verdict),
  ``pdf_too_many_pages``, ``pdf_parse_timeout``, and ``pdf_reader_failed``
  (the reader stopped: its memory ceiling, or a crash, with its exit status).

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
import os
import signal
import subprocess
import sys
import threading
from dataclasses import dataclass

#: The most pages a PDF may have to be read here: 300 pages read in about 27 s, inside the deadline.
MAX_PDF_PAGES = 300
#: How long one parse may take before its process is killed; the BFF waits 120 s for a whole capture.
PARSE_TIMEOUT_SECONDS = 45.0
#: The address space the parsing process may map; the fetcher pod's limit holds two of them (2.5 GiB).
MEMORY_LIMIT_BYTES = 1024**3
#: How long a caller waits for the fetcher's ``/v1/extract``: the parse's deadline, and the hop.
EXTRACT_TIMEOUT_SECONDS = PARSE_TIMEOUT_SECONDS + 5
#: The most text a read answers; the BFF's capture column holds the same (0209).
MAX_TEXT_CHARS = 2_000_000
#: How many PDFs one process reads at once; a further read waits for one to finish.
MAX_PDF_READERS = 2
#: What the child's environment holds: what Python needs, and the one setting of the text pass.
CHILD_ENV_KEYS = ("PATH", "LANG", "LC_ALL", "PDF_PAGE_MAX_OBJECTS")
#: Where the fetcher is (``public_sources.routing.ENV_FETCHER_URL``), named here to keep this module import-light.
ENV_FETCHER_URL = "PUBLIC_SOURCE_FETCHER_URL"
#: What joins two pages' text, and what a page is counted by.
PAGE_BREAK = "\f"

PDF_CONTENT_TYPE = "application/pdf"

_READERS = threading.BoundedSemaphore(MAX_PDF_READERS)


class PdfError(ValueError):
    """A PDF that cannot be read. ``code`` is the problem's code, stable for a caller to branch on."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class PdfText:
    #: Each page's text, in order, for the pages read; an empty string for a page with no text layer.
    pages: tuple[str, ...]
    #: The pages the document has; more than ``len(pages)`` when the text cap stopped the read.
    page_count: int = 0
    title: str = ""

    @property
    def text(self) -> str | None:
        """The pages joined by a form feed; ``None`` when no page has a text layer (a scan)."""
        if not any(page.strip() for page in self.pages):
            return None
        return PAGE_BREAK.join(self.pages)

    @property
    def note(self) -> str:
        """What a reader of :attr:`text` must know: pages with no text layer, or pages past the text cap."""
        notes = []
        blank = [str(number) for number, page in enumerate(self.pages, start=1) if not page.strip()]
        if blank:
            which = "all of its pages" if len(blank) == len(self.pages) else f"pages {', '.join(blank[:20])}"
            notes.append(
                f"no text layer on {which} (a scan?): nothing there can be quoted; OCR is not done for a capture"
            )
        if self.page_count > len(self.pages):
            notes.append(
                f"read only in part, up to page {len(self.pages)} of {self.page_count}: a capture keeps at most "
                f"{MAX_TEXT_CHARS:,} characters, so a quote from a later page is not found: "
                "capture that part on its own"
            )
        return "; ".join(notes)


def is_pdf(content: bytes, content_type: str | None = None) -> bool:
    """Whether the body is a PDF: by its declared type, or by its magic bytes when a server says octet-stream."""
    kind = (content_type or "").split(";", 1)[0].strip().lower()
    return kind == PDF_CONTENT_TYPE or content[:1024].lstrip().startswith(b"%PDF-")


def _child_env() -> dict[str, str]:
    return {key: os.environ[key] for key in CHILD_ENV_KEYS if key in os.environ}


def _stopped(done: subprocess.CompletedProcess) -> PdfError:
    """Why a child gave no answer, by its exit status: a signal (the memory ceiling, a crash) or an exit code."""
    if done.returncode < 0:
        try:
            name = signal.Signals(-done.returncode).name
        except ValueError:
            name = f"signal {-done.returncode}"
        status = f"was stopped by {name}"
    else:
        status = f"exited with status {done.returncode}"
    return PdfError(
        "pdf_reader_failed",
        f"the PDF reader {status} before it answered; a read may map at most {MEMORY_LIMIT_BYTES // 1024**2} MiB",
    )


def read_pdf(content: bytes, *, max_pages: int = MAX_PDF_PAGES) -> PdfText:
    """The text of ``content``: read by the public-source fetcher, never in a pod that reaches the cluster.

    With ``PUBLIC_SOURCE_FETCHER_URL`` set (every backend role, Compose
    included) the bytes go to the fetcher's ``/v1/extract``, which runs
    :func:`parse_pdf` in its sandbox: no secrets, no service-account token,
    public egress only. Without it, this process is the fetcher (or a test) and
    parses here. Raises :class:`PdfError`. Blocking: an async caller runs it
    with ``asyncio.to_thread``.
    """
    fetcher_url = os.environ.get(ENV_FETCHER_URL, "").strip()
    if fetcher_url:
        return _extracted_by(fetcher_url, content, max_pages)
    return parse_pdf(content, max_pages=max_pages)


def _extracted_by(fetcher_url: str, content: bytes, max_pages: int) -> PdfText:
    """POST the bytes to the fetcher's ``/v1/extract``; its refusal keeps its code."""
    import httpx

    endpoint = fetcher_url.rstrip("/") + "/v1/extract"
    try:
        with httpx.Client(timeout=EXTRACT_TIMEOUT_SECONDS, trust_env=False) as client:
            answer = client.post(endpoint, content=content, params={"max_pages": max_pages})
    except httpx.TimeoutException as exc:
        raise PdfError(
            "pdf_parse_timeout", f"the PDF reader did not answer within {EXTRACT_TIMEOUT_SECONDS:g} seconds"
        ) from exc
    except httpx.HTTPError as exc:
        raise PdfError(
            "pdf_reader_failed", f"the PDF reader (the public-source fetcher) is not reachable: {exc}"
        ) from exc
    body = answer.json() if answer.headers.get("content-type", "").startswith("application/json") else {}
    if answer.status_code == 200 and isinstance(body, dict) and "pages" in body:
        return PdfText(pages=tuple(body["pages"]), page_count=int(body["page_count"]), title=str(body["title"]))
    if isinstance(body, dict) and body.get("code"):
        raise PdfError(str(body["code"]), str(body.get("message", "")))
    raise PdfError("pdf_reader_failed", f"the PDF reader answered HTTP {answer.status_code}")


def parse_pdf(
    content: bytes,
    *,
    max_pages: int = MAX_PDF_PAGES,
    timeout: float = PARSE_TIMEOUT_SECONDS,
    memory_limit: int = MEMORY_LIMIT_BYTES,
    max_chars: int = MAX_TEXT_CHARS,
) -> PdfText:
    """Parse ``content`` here, in a child process killed after ``timeout`` seconds. Raises :class:`PdfError`.

    Only the fetcher's ``/v1/extract`` (and a test) calls this; every other
    caller uses :func:`read_pdf`. Blocking.
    """
    if not _READERS.acquire(timeout=timeout):
        raise PdfError("pdf_parse_timeout", f"{MAX_PDF_READERS} PDFs were being read for {timeout:g} seconds")
    try:
        limits = [str(max_pages), str(memory_limit), str(max_chars)]
        command = [sys.executable, "-I", "-m", "public_sources.pdf_reader", *limits]
        try:
            done = subprocess.run(  # noqa: S603 - our own interpreter and module, no shell
                command, input=content, capture_output=True, timeout=timeout, check=False, env=_child_env()
            )
        except subprocess.TimeoutExpired as exc:
            raise PdfError("pdf_parse_timeout", f"reading the PDF took longer than {timeout:g} seconds") from exc
    finally:
        _READERS.release()
    try:
        answer = json.loads(done.stdout)
    except ValueError:
        answer = None
    if not isinstance(answer, dict):
        raise _stopped(done)
    if "error" in answer:
        raise PdfError(str(answer["error"]), str(answer.get("message", "")))
    return PdfText(pages=tuple(answer["pages"]), page_count=int(answer["page_count"]), title=str(answer["title"]))
