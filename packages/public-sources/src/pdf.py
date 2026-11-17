from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import threading
from dataclasses import dataclass

MAX_PDF_PAGES = 300
PARSE_TIMEOUT_SECONDS = 45.0
MEMORY_LIMIT_BYTES = 1024**3
EXTRACT_TIMEOUT_SECONDS = PARSE_TIMEOUT_SECONDS + 5
MAX_TEXT_CHARS = 2_000_000
MAX_PDF_READERS = 2
CHILD_ENV_KEYS = ("PATH", "LANG", "LC_ALL", "PDF_PAGE_MAX_OBJECTS")
ENV_FETCHER_URL = "PUBLIC_SOURCE_FETCHER_URL"
PAGE_BREAK = "\f"

PDF_CONTENT_TYPE = "application/pdf"

_READERS = threading.BoundedSemaphore(MAX_PDF_READERS)

_parse_here = False


def allow_parsing_here() -> None:
    global _parse_here
    _parse_here = True


class PdfError(ValueError):

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class PdfText:
    pages: tuple[str, ...]
    page_count: int = 0
    title: str = ""

    @property
    def text(self) -> str | None:
        if not any(page.strip() for page in self.pages):
            return None
        return PAGE_BREAK.join(self.pages)

    @property
    def note(self) -> str:
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
    kind = (content_type or "").split(";", 1)[0].strip().lower()
    return kind == PDF_CONTENT_TYPE or content[:1024].lstrip().startswith(b"%PDF-")


def _child_env() -> dict[str, str]:
    return {key: os.environ[key] for key in CHILD_ENV_KEYS if key in os.environ}


def _stopped(done: subprocess.CompletedProcess) -> PdfError:
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
    fetcher_url = os.environ.get(ENV_FETCHER_URL, "").strip()
    if fetcher_url:
        return _extracted_by(fetcher_url, content, max_pages)
    if _parse_here:
        return parse_pdf(content, max_pages=max_pages)
    raise PdfError(
        "pdf_reader_failed",
        f"no public-source fetcher is configured ({ENV_FETCHER_URL}): a public PDF is parsed only there",
    )


def _extracted_by(fetcher_url: str, content: bytes, max_pages: int) -> PdfText:
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
