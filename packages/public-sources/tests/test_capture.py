"""A page captured for a citation (ADR-0170): through the source's own transport, with its digest and its text."""

from __future__ import annotations

import hashlib

import httpx
import pytest
from public_sources import routing
from public_sources.capture import CaptureError
from public_sources.capture import capture_page
from public_sources.capture import page_text
from public_sources_testing import SOURCES_DIR

PAGE = (
    "<html><head><title>RIS</title><script>var x = 'Baupolizei';</script></head>"
    "<body><h1>Bauordnung für Wien</h1><p>§ 1.  Die   Baubehörde\n erster Instanz</p></body></html>"
).encode()


@pytest.fixture(autouse=True)
def _sources(monkeypatch):
    monkeypatch.setenv("PUBLIC_SOURCES_DIR", str(SOURCES_DIR))
    monkeypatch.delenv(routing.ENV_FETCHER_URL, raising=False)


def _network(handler):
    return httpx.MockTransport(handler)


async def test_captures_the_bytes_digest_and_the_text_a_person_reads():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, headers={"content-type": "text/html; charset=utf-8"}, content=PAGE)

    url = "https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrW&Gesetzesnummer=20000006"
    page = await capture_page("at-ris", url, inner=_network(handler))
    assert page.sha256 == hashlib.sha256(PAGE).hexdigest()
    assert page.size == len(PAGE)
    assert page.text is not None
    assert "Bauordnung für Wien" in page.text
    assert "§ 1. Die Baubehörde" in page.text
    assert "Baupolizei" not in page.text  # a script is no text a person reads
    assert [request.method for request in seen] == ["GET"]


async def test_refuses_a_url_off_the_source_hosts_before_anything_is_sent():
    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover - never reached
        raise AssertionError("sent")

    with pytest.raises(CaptureError) as refused:
        await capture_page("at-ris", "https://example.org/made-up-statute.html", inner=_network(handler))
    assert refused.value.status == 403


async def test_refuses_a_redirect_off_the_source_hosts():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "https://evil.example/page"})

    with pytest.raises(Exception) as refused:
        await capture_page("at-ris", "https://www.ris.bka.gv.at/x", inner=_network(handler))
    assert "not on a host of source" in str(refused.value)


async def test_an_upstream_error_is_no_capture():
    with pytest.raises(CaptureError) as failed:
        await capture_page("at-ris", "https://www.ris.bka.gv.at/x", inner=_network(lambda _: httpx.Response(503)))
    assert failed.value.status == 502


def test_a_pdf_has_no_text_and_plain_text_is_kept():
    assert page_text(b"%PDF-1.7", "application/pdf") is None
    assert page_text(b"Wien", "text/plain") == "Wien"
