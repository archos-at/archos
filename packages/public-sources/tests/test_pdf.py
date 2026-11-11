"""A public PDF as a source and as a capture: its pages' text, a guarded parse, a ``pdf_document`` source.

The statute fixture is § 7 UrhG (``public_sources_testing.pdf_fixture``); its
extracted text is committed beside it because the workspace's door spec serves
the same text as the api tier would, so a drift between the two fails here.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import subprocess
import threading
import time

import httpx
import pytest
from public_sources import capture as capture_module
from public_sources import pdf as pdf_module
from public_sources import routing
from public_sources.capture import CaptureError
from public_sources.capture import capture_page
from public_sources.fixtures import run_source
from public_sources.monitor import Seen
from public_sources.monitor import probe
from public_sources.pdf import CHILD_ENV_KEYS
from public_sources.pdf import MAX_PDF_READERS
from public_sources.pdf import PAGE_BREAK
from public_sources.pdf import PdfError
from public_sources.pdf import PdfText
from public_sources.pdf import parse_pdf
from public_sources.pdf import read_pdf
from public_sources.source import SourceError
from public_sources.source import parse_inline_source
from public_sources_testing import SOURCES_DIR
from public_sources_testing import SYNTHETIC_TERMS
from public_sources_testing import synthetic_source
from public_sources_testing.network import scripted_network
from public_sources_testing.pdf_fixture import REAL_PDF
from public_sources_testing.pdf_fixture import TITLE
from public_sources_testing.pdf_fixture import broken_pdf
from public_sources_testing.pdf_fixture import password_pdf
from public_sources_testing.pdf_fixture import real_text
from public_sources_testing.pdf_fixture import scanned_pdf
from public_sources_testing.pdf_fixture import statute_pdf

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


def test_the_committed_text_is_what_the_reader_reads_from_the_real_pdf():
    """The door spec serves this text as the api tier's; it must be what this package extracts."""
    read = read_pdf(REAL_PDF.read_bytes())

    assert read.text == real_text()
    assert len(read.pages) == 16 and read.note == ""


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
        parse_pdf(statute_pdf(), timeout=0.001)
    assert refused.value.code == "pdf_parse_timeout"


async def test_a_capture_of_a_real_pdf_keeps_its_pages_text():
    source = parse_inline_source(_pdf_source())
    content = REAL_PDF.read_bytes()

    page = await capture_page(source, PDF_URL, inner=_site({PDF_URL: ("application/pdf", content)}))

    assert page.sha256 == hashlib.sha256(content).hexdigest()
    assert page.pages == 16 and page.note == ""
    assert page.text == real_text()


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


CAPTURE_ID = "7d3c1f0a-4b7e-4c58-9a51-0c2f6a1b9e11"


def _captured_source(response: dict, **expect) -> dict:
    """The gazette's PDF source, its fixture's response a capture the platform took instead of pasted bytes."""
    record = _pdf_source(**expect)
    record["fixtures"][0]["responses"] = {PDF_URL: response}
    return record


def _recording() -> dict:
    """What the BFF hands over for a check: the capture's id, content type and the text the reader read."""
    return {"capture_id": CAPTURE_ID, "content_type": "application/pdf", "text": read_pdf(statute_pdf()).text}


async def test_a_pdf_document_fixture_is_read_from_the_capture_the_platform_took(monkeypatch):
    """No PDF bytes in the record: the request is proven, and the engine reads the capture's pages."""
    monkeypatch.setattr(pdf_module, "read_pdf", lambda *_a, **_k: pytest.fail("a capture is read, not parsed again"))

    [result] = await run_source(parse_inline_source(_captured_source(_recording())))

    assert result.ok, result.failures
    assert result.requested == [PDF_URL] and result.awaiting == []


async def test_a_capture_fixture_fails_when_the_capture_does_not_hold_what_the_record_expects():
    """The control of the test above: the capture's text decides, so other text fails the same fixture."""
    other = {**_recording(), "text": "Another document" + PAGE_BREAK + "with two pages"}

    [result] = await run_source(parse_inline_source(_captured_source(other)))

    assert not result.ok and result.awaiting == []
    assert any(PAGE_TWO in failure for failure in result.failures)


async def test_a_capture_fixture_on_another_url_than_the_one_requested_fails():
    record = _captured_source(_recording())
    record["fixtures"][0]["responses"] = {"https://gazette.xa.example/other.pdf": _recording()}

    [result] = await run_source(parse_inline_source(record))

    assert not result.ok
    assert any("HTTP 404" in failure for failure in result.failures), result.failures


@pytest.mark.parametrize("response", [{"capture_id": None}, {"capture_id": CAPTURE_ID}])
async def test_a_fixture_whose_capture_was_not_handed_over_awaits_it_and_is_not_run(response):
    """Not taken yet, or kept by id in the record: neither is a pass, and neither is a failure of the record."""
    [result] = await run_source(parse_inline_source(_captured_source(response)))

    assert not result.ok
    assert result.awaiting == [PDF_URL] and result.failures == [] and result.requested == []


@pytest.mark.parametrize("content_type", ["text/html; charset=utf-8", ""])
async def test_a_capture_that_is_not_a_pdf_is_no_pdf_fixture(content_type):
    """An HTML page has text too; only a capture of the PDF itself proves a pdf_document source."""
    recording = {**_recording(), "content_type": content_type}

    [result] = await run_source(parse_inline_source(_captured_source(recording)))

    assert not result.ok
    assert any("not a PDF" in failure for failure in result.failures), result.failures


def test_a_cut_capture_names_itself_in_the_note_the_bff_refuses_by():
    """The BFF refuses a capture whose note says it was read only in part (source-checks.ts, CUT_NOTE)."""
    assert "read only in part" in PdfText(pages=("a",), page_count=2).note


async def test_a_capture_over_the_records_page_cap_fails_by_its_code():
    record = _captured_source(_recording())
    record["engine"] = {"title": TITLE, "max_pages": 1}

    [result] = await run_source(parse_inline_source(record))

    assert any("pdf_too_many_pages" in failure for failure in result.failures)


async def test_a_format_that_reads_markup_cannot_take_a_capture_as_its_fixture():
    """A capture keeps a page's text, not its body: an HTML statute's fixture stays inline."""
    record = synthetic_source()
    url = next(iter(record["fixtures"][0]["responses"]))
    record["fixtures"][0]["responses"] = {url: {"capture_id": CAPTURE_ID, "content_type": "text/html", "text": "x"}}

    [result] = await run_source(parse_inline_source(record))

    assert any("record the response inline" in failure for failure in result.failures)


def test_a_response_that_is_neither_inline_nor_a_capture_is_refused():
    for response in ({}, {"capture_id": "not-a-capture-id"}, {"capture_id": CAPTURE_ID, "sha256": "ab"}):
        with pytest.raises(SourceError):
            parse_inline_source(_captured_source(response))


def test_a_repository_record_cannot_name_a_capture(tmp_path):
    from public_sources import load_sources
    from public_sources_testing import write_source

    record = _captured_source({"capture_id": CAPTURE_ID})
    write_source(tmp_path, record)

    with pytest.raises(SourceError, match="name files"):
        load_sources(tmp_path)


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
    assert PAGE_TWO in (first.text or "").split(PAGE_BREAK)[1]
    assert second.text is None


async def test_a_pdf_larger_than_the_egress_ceiling_is_refused_by_its_code(monkeypatch):
    monkeypatch.setattr(capture_module, "MAX_BODY_BYTES", 1000)
    source = parse_inline_source(_pdf_source())

    with pytest.raises(CaptureError) as refused:
        await capture_page(source, PDF_URL, inner=_site({PDF_URL: ("application/pdf", statute_pdf())}))
    assert (refused.value.status, refused.value.code) == (422, "body_too_large")


async def test_a_pdf_url_off_the_source_hosts_is_refused_before_anything_is_sent():
    source = parse_inline_source(_pdf_source())

    with pytest.raises(CaptureError) as refused:
        await capture_page(source, "https://elsewhere.example/urhg-7.pdf", inner=_site({}))
    assert (refused.value.status, refused.value.code) == (403, "egress_refused")


async def test_a_pdf_url_redirecting_off_the_hosts_is_refused_at_the_hop():
    source = parse_inline_source(_pdf_source())

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "https://10.0.0.1/urhg-7.pdf"})

    with pytest.raises(CaptureError) as refused:
        await capture_page(source, PDF_URL, inner=httpx.MockTransport(handler))
    assert (refused.value.status, refused.value.code) == (403, "egress_refused")


async def test_a_pdf_url_redirecting_to_a_listed_host_with_a_private_address_is_refused_before_dialling():
    # The host list cannot catch this: the second host is the source's own, and its DNS answers the metadata address.
    record = _pdf_source()
    record["hosts"] = ["gazette.xa.example", "files.xa.example"]
    source = parse_inline_source(record)
    addresses = {"gazette.xa.example": ["93.184.216.34"], "files.xa.example": ["169.254.169.254"]}
    redirect = b"HTTP/1.1 302 Found\r\nLocation: https://files.xa.example/urhg-7.pdf\r\nContent-Length: 0\r\n\r\n"
    dialled: list[str] = []

    with pytest.raises(CaptureError) as refused:
        await capture_page(source, PDF_URL, inner=scripted_network(addresses, redirect, dialled))
    assert (refused.value.status, refused.value.code) == (403, "egress_refused")
    assert "169.254.169.254" in str(refused.value)
    assert dialled == ["93.184.216.34"]


def test_a_text_past_the_cap_is_kept_to_whole_pages_and_says_up_to_which():
    read = parse_pdf(REAL_PDF.read_bytes(), max_chars=10_000)

    assert read.page_count == 16 and 0 < len(read.pages) < 16
    assert len(read.text or "") <= 10_000
    assert read.text == "\f".join(real_text().split("\f")[: len(read.pages)])
    assert f"up to page {len(read.pages)} of 16" in read.note


def test_a_read_past_its_memory_ceiling_is_refused_by_its_code():
    # 8 MiB is far below what the interpreter maps to import the reader on any machine (64 MiB fitted on CI's
    # runner): the ceiling, not the PDF, decides. Without the ceiling the read succeeds and this test fails.
    with pytest.raises(PdfError) as refused:
        parse_pdf(statute_pdf(), memory_limit=8 * 1024**2)
    assert refused.value.code == "pdf_reader_failed"


def test_a_child_that_dies_is_reported_by_its_exit_status_not_by_what_it_printed(monkeypatch):
    def killed(*args, **kwargs):
        return subprocess.CompletedProcess(args, -6, stdout=b"", stderr=b"RuntimeWarning: something unrelated")

    monkeypatch.setattr(pdf_module.subprocess, "run", killed)
    with pytest.raises(PdfError) as refused:
        read_pdf(statute_pdf())
    assert refused.value.code == "pdf_reader_failed"
    assert "SIGABRT" in str(refused.value) and "RuntimeWarning" not in str(refused.value)


def test_the_child_runs_a_module_the_package_does_not_import_so_it_warns_of_nothing(monkeypatch):
    seen: list[subprocess.CompletedProcess] = []
    real = subprocess.run

    def recorded(*args, **kwargs):
        seen.append(real(*args, **kwargs))
        return seen[-1]

    monkeypatch.setattr(pdf_module.subprocess, "run", recorded)
    read_pdf(statute_pdf())
    assert b"RuntimeWarning" not in seen[0].stderr


def test_the_child_gets_none_of_the_servers_environment(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "a-secret")
    envs: list[dict] = []

    def answered(*args, **kwargs):
        envs.append(kwargs["env"])
        return subprocess.CompletedProcess(
            args, 0, stdout=json.dumps({"pages": ["x"], "page_count": 1, "title": ""}).encode()
        )

    monkeypatch.setattr(pdf_module.subprocess, "run", answered)
    read_pdf(statute_pdf())
    assert set(envs[0]) <= set(CHILD_ENV_KEYS)
    assert "a-secret" not in envs[0].values()


def test_no_more_than_the_allowed_readers_run_at_once(monkeypatch):
    running = 0
    most = 0
    lock = threading.Lock()

    def slow(*args, **kwargs):
        nonlocal running, most
        with lock:
            running += 1
            most = max(most, running)
        time.sleep(0.2)
        with lock:
            running -= 1
        return subprocess.CompletedProcess(
            args, 0, stdout=json.dumps({"pages": ["x"], "page_count": 1, "title": ""}).encode()
        )

    monkeypatch.setattr(pdf_module.subprocess, "run", slow)
    threads = [threading.Thread(target=read_pdf, args=(b"%PDF-",)) for _ in range(MAX_PDF_READERS + 3)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert most == MAX_PDF_READERS


async def test_a_fixture_run_reads_its_pdf_off_the_event_loop(monkeypatch):
    def slow_read(body, **kwargs):
        time.sleep(0.5)
        return PdfText(pages=("Allgemeine Vorschriften für Bauflächen und Baugebiete",), page_count=1)

    monkeypatch.setattr("public_sources.engines.pdf_document.read_pdf", slow_read)
    record = _pdf_source(expect={"contains": ["Allgemeine Vorschriften"]})
    ticks = 0
    done = asyncio.Event()

    async def ticker():
        nonlocal ticks
        while not done.is_set():
            ticks += 1
            await asyncio.sleep(0.01)

    async def run():
        try:
            return await run_source(parse_inline_source(record))
        finally:
            done.set()

    [result], _ = await asyncio.gather(run(), ticker())
    assert result.ok, result.failures
    assert ticks >= 20  # the loop kept turning while the PDF was read


async def test_a_monitor_probe_reads_a_pdf_once(monkeypatch):
    reads: list[int] = []
    real = read_pdf

    def counted(body, **kwargs):
        reads.append(1)
        return real(body, **kwargs)

    monkeypatch.setattr("public_sources.monitor.read_pdf", counted)
    monkeypatch.setattr("public_sources.engines.pdf_document.read_pdf", counted)
    source = parse_inline_source(_pdf_source())
    terms = (SYNTHETIC_TERMS, ("text/html", b"terms"))

    seen = await probe(source, Seen(), inner=_site(dict([terms, (PDF_URL, ("application/pdf", statute_pdf()))])))

    assert len(reads) == 1
    assert seen.anchors == ("page_1", "page_2") and PAGE_TWO in (seen.text or "")


def test_the_bff_waits_longer_than_a_probe_s_fetches_and_parse_take_together():
    """Else a parse past its deadline reaches the door as "did not answer" instead of pdf_parse_timeout."""
    import re
    from pathlib import Path

    from public_sources.capture import FETCH_TIMEOUT_SECONDS
    from public_sources.pdf import PARSE_TIMEOUT_SECONDS

    root = Path(__file__).resolve().parents[3]
    source = (root / "apps/workspace/bff/base-knowledge/platform/capture-fetch.ts").read_text(encoding="utf-8")
    budget_ms = int(re.search(r"export const CAPTURE_TIMEOUT_MS = ([\d_]+)", source).group(1).replace("_", ""))
    # A probe fetches the page and its terms, then parses once.
    assert budget_ms >= (2 * FETCH_TIMEOUT_SECONDS + PARSE_TIMEOUT_SECONDS) * 1000 + 10_000
