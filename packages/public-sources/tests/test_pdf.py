"""A public PDF as a source and as a capture: its pages' text, a guarded parse, a ``pdf_document`` source.

The statute fixture is § 7 UrhG (``public_sources_testing.pdf_fixture``); its
extracted text is committed beside it because the workspace's door spec serves
the same text as the api tier would, so a drift between the two fails here.
"""

from __future__ import annotations

import base64
import hashlib

import httpx
import pytest
from public_sources import routing
from public_sources.capture import CaptureError
from public_sources.capture import capture_page
from public_sources.fixtures import run_source
from public_sources.monitor import Seen
from public_sources.monitor import probe
from public_sources.pdf import PAGE_BREAK
from public_sources.pdf import PdfError
from public_sources.pdf import read_pdf
from public_sources.source import SourceError
from public_sources.source import parse_inline_source
from public_sources_testing import SOURCES_DIR
from public_sources_testing import SYNTHETIC_TERMS
from public_sources_testing import synthetic_source
from public_sources_testing.pdf_fixture import STATUTE_PDF
from public_sources_testing.pdf_fixture import TITLE
from public_sources_testing.pdf_fixture import broken_pdf
from public_sources_testing.pdf_fixture import password_pdf
from public_sources_testing.pdf_fixture import scanned_pdf
from public_sources_testing.pdf_fixture import statute_pdf
from public_sources_testing.pdf_fixture import statute_text

PDF_URL = "https://gazette.xa.example/urhg-7.pdf"
PAGE_TWO = "bestimmten Landkarten sind keine freien Werke"


@pytest.fixture(autouse=True)
def _sources(monkeypatch):
    monkeypatch.setenv("PUBLIC_SOURCES_DIR", str(SOURCES_DIR))
    monkeypatch.delenv(routing.ENV_FETCHER_URL, raising=False)


def _pdf_source(body: bytes = b"", **expect) -> dict:
    """The synthetic gazette, publishing its code as a PDF, the PDF recorded inline as base64."""
    content = body or statute_pdf()
    return synthetic_source(
        format="pdf_document",
        access={"documents": [{"id": "code", "url": PDF_URL}]},
        engine={"title": TITLE},
        fixtures=[
            {
                "name": "code",
                "operation": "document",
                "args": {"id": "code"},
                "responses": {
                    PDF_URL: {
                        "content_type": "application/pdf",
                        "encoding": "base64",
                        "text": base64.b64encode(content).decode(),
                    }
                },
                "expect": expect or {"title": TITLE, "anchors": ["page_1", "page_2"], "contains": [PAGE_TWO]},
            }
        ],
    )


def _site(pages: dict[str, tuple[str, bytes]]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        found = pages.get(str(request.url))
        if found is None:
            return httpx.Response(404)
        return httpx.Response(200, headers={"content-type": found[0]}, content=found[1])

    return httpx.MockTransport(handler)


def test_the_committed_fixture_is_what_the_builder_writes_and_the_reader_reads():
    assert STATUTE_PDF.read_bytes() == statute_pdf()
    assert read_pdf(statute_pdf()).text == statute_text()


def test_reads_each_page_and_joins_them_with_a_form_feed():
    read = read_pdf(statute_pdf())

    assert len(read.pages) == 2
    first, second = (read.text or "").split(PAGE_BREAK)
    assert "genießen keinen urheberrechtlichen Schutz" in first
    assert PAGE_TWO in second
    assert read.note == ""


def test_a_scan_has_pages_and_no_text_and_says_so():
    read = read_pdf(scanned_pdf())

    assert read.text is None
    assert len(read.pages) == 2
    assert "no text layer on all of its pages" in read.note and "OCR" in read.note


def test_a_pdf_over_the_page_cap_is_refused():
    with pytest.raises(PdfError) as refused:
        read_pdf(statute_pdf(), max_pages=1)
    assert refused.value.code == "pdf_too_many_pages"


def test_the_text_is_ingestions_text_pass():
    """One PDF pipeline: what a capture keeps is what ingestion indexes, page for page."""
    from knowledge_layer.ingest import pdf_page_texts

    indexed = [entry["text"] for entry in pdf_page_texts(statute_pdf())]

    assert list(read_pdf(statute_pdf()).pages) == indexed


@pytest.mark.parametrize(("body", "code"), [(password_pdf(), "pdf_encrypted"), (broken_pdf(), "pdf_malformed")])
def test_a_pdf_that_needs_a_password_or_is_broken_is_refused_with_its_code(body, code):
    with pytest.raises(PdfError) as refused:
        read_pdf(body)
    assert refused.value.code == code


def test_a_parse_past_its_deadline_is_stopped():
    with pytest.raises(PdfError) as refused:
        read_pdf(statute_pdf(), timeout=0.001)
    assert refused.value.code == "pdf_parse_timeout"


async def test_a_capture_of_a_pdf_keeps_its_pages_text():
    source = parse_inline_source(_pdf_source())
    content = statute_pdf()

    page = await capture_page(source, PDF_URL, inner=_site({PDF_URL: ("application/pdf", content)}))

    assert page.sha256 == hashlib.sha256(content).hexdigest()
    assert page.pages == 2 and page.note == ""
    assert page.text == statute_text()


async def test_a_pdf_served_as_octet_stream_is_still_read_by_its_magic_bytes():
    source = parse_inline_source(_pdf_source())

    page = await capture_page(source, PDF_URL, inner=_site({PDF_URL: ("application/octet-stream", statute_pdf())}))

    assert PAGE_TWO in (page.text or "")


async def test_a_capture_of_a_scan_keeps_no_text_and_says_why():
    source = parse_inline_source(_pdf_source())

    page = await capture_page(source, PDF_URL, inner=_site({PDF_URL: ("application/pdf", scanned_pdf())}))

    assert page.text is None and page.pages == 2
    assert "no text layer" in page.note


async def test_a_capture_of_a_pdf_behind_a_password_is_refused_with_its_code():
    source = parse_inline_source(_pdf_source())

    with pytest.raises(CaptureError) as refused:
        await capture_page(source, PDF_URL, inner=_site({PDF_URL: ("application/pdf", password_pdf())}))
    assert (refused.value.status, refused.value.code) == (422, "pdf_encrypted")


async def test_a_pdf_document_source_passes_its_base64_fixture():
    [result] = await run_source(parse_inline_source(_pdf_source()))

    assert result.ok, result.failures
    assert result.requested == [PDF_URL]


async def test_a_pdf_document_fixture_fails_on_a_scan():
    [result] = await run_source(parse_inline_source(_pdf_source(scanned_pdf())))

    assert not result.ok


def test_a_base64_body_that_does_not_decode_is_refused():
    record = _pdf_source()
    record["fixtures"][0]["responses"][PDF_URL]["text"] = "not base64!"
    with pytest.raises(SourceError, match="base64"):
        parse_inline_source(record)


def test_a_licensed_pdf_source_is_refused():
    record = _pdf_source()
    record["terms"] = {**record["terms"], "licence": "licensed"}
    with pytest.raises(SourceError, match="licensed"):
        parse_inline_source(record)


async def test_the_monitor_watches_a_pdf_by_its_bytes_and_hands_over_its_text():
    source = parse_inline_source(_pdf_source())
    terms = (SYNTHETIC_TERMS, ("text/html", b"terms"))
    first = await probe(source, Seen(), inner=_site(dict([terms, (PDF_URL, ("application/pdf", statute_pdf()))])))
    assert not first.changed

    second = await probe(
        source, first.current, inner=_site(dict([terms, (PDF_URL, ("application/pdf", scanned_pdf()))]))
    )

    assert second.changed
    assert first.anchors == ("page_1", "page_2")
    assert first.text == statute_text()
    assert second.text is None
