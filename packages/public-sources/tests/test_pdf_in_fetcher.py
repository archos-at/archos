"""A third party's PDF is parsed in the fetcher, never in a pod that reaches the cluster (ADR-0162 amendment).

With ``PUBLIC_SOURCE_FETCHER_URL`` set, as on every backend role, ``read_pdf``
sends the bytes to the fetcher's ``/v1/extract`` and parses nothing itself; an
unreachable fetcher is a refusal, not a parse here. Without a fetcher, a
source is not read and a PDF is not parsed: only the fixture runner and the
tests say in code that they parse here.
"""

from __future__ import annotations

import httpx
import pytest
from public_sources import pdf as pdf_module
from public_sources import routing
from public_sources.egress import EgressRefused
from public_sources.fetcher import make_app
from public_sources.pdf import PdfError
from public_sources.pdf import read_pdf
from public_sources.routing import source_transport
from public_sources_testing import SOURCES_DIR
from public_sources_testing.pdf_fixture import REAL_PDF
from public_sources_testing.pdf_fixture import password_pdf
from public_sources_testing.pdf_fixture import real_text
from starlette.testclient import TestClient

FETCHER = "http://public-source-fetcher:8095"


@pytest.fixture(autouse=True)
def _sources(monkeypatch):
    monkeypatch.setenv("PUBLIC_SOURCES_DIR", str(SOURCES_DIR))


@pytest.fixture
def fetcher(monkeypatch):
    """The fetcher app behind ``PUBLIC_SOURCE_FETCHER_URL``; ``paths`` records what was asked of it."""
    monkeypatch.setenv(routing.ENV_FETCHER_URL, FETCHER)
    paths: list[str] = []
    app = make_app()

    def client(*args, **kwargs):
        test_client = TestClient(app, base_url=FETCHER)
        test_client.event_hooks["request"].append(lambda request: paths.append(request.url.path))
        return test_client

    monkeypatch.setattr(httpx, "Client", client)
    return paths


def test_with_a_fetcher_the_text_comes_from_its_extract(fetcher):
    read = read_pdf(REAL_PDF.read_bytes())

    assert fetcher == ["/v1/extract"]
    assert read.text == real_text() and read.page_count == 16


def test_a_refusal_in_the_fetcher_keeps_its_code(fetcher):
    with pytest.raises(PdfError) as refused:
        read_pdf(password_pdf())
    assert refused.value.code == "pdf_encrypted"


def test_an_unreachable_fetcher_is_a_refusal_and_nothing_is_parsed_here(monkeypatch):
    monkeypatch.setenv(routing.ENV_FETCHER_URL, "http://127.0.0.1:9")  # nothing listens on discard
    parsed: list[bytes] = []
    monkeypatch.setattr(pdf_module, "parse_pdf", lambda content, **_: parsed.append(content))

    with pytest.raises(PdfError) as refused:
        read_pdf(REAL_PDF.read_bytes())
    assert refused.value.code == "pdf_reader_failed"
    assert parsed == []


def test_without_a_fetcher_a_pdf_is_refused_and_nothing_is_parsed_here(monkeypatch):
    """A backend role missing its variable (a KC-7 check of a fixture PDF in the api pod) parses nothing itself."""
    monkeypatch.delenv(routing.ENV_FETCHER_URL, raising=False)
    monkeypatch.setattr(pdf_module, "_parse_here", False)
    parsed: list[bytes] = []
    monkeypatch.setattr(pdf_module, "parse_pdf", lambda content, **_: parsed.append(content))

    with pytest.raises(PdfError) as refused:
        read_pdf(REAL_PDF.read_bytes())
    assert refused.value.code == "pdf_reader_failed"
    assert "no public-source fetcher" in str(refused.value)
    assert parsed == []


def test_the_pdf_module_and_the_router_name_the_same_fetcher_variable():
    assert pdf_module.ENV_FETCHER_URL == routing.ENV_FETCHER_URL


def test_without_a_fetcher_a_source_is_not_read_in_process(monkeypatch):
    monkeypatch.delenv(routing.ENV_FETCHER_URL, raising=False)

    with pytest.raises(EgressRefused, match="no public-source fetcher"):
        source_transport("at-ris")


def test_a_rollout_lets_the_fetcher_finish_the_longest_extract_a_caller_waits_for():
    """Else a deploy kills a parse mid-read, and the capture it belongs to answers pdf_reader_failed."""
    import re
    from pathlib import Path

    root = Path(__file__).resolve().parents[3]
    source = (root / "deploy/pulumi/src/app/public-source-fetcher.ts").read_text(encoding="utf-8")
    profile = re.search(r"export const FETCHER_ROLLOUT: RolloutProfile = \{(.*?)\n\};", source, re.S).group(1)
    grace = int(re.search(r"terminationGracePeriodSeconds: (\d+)", profile).group(1))
    drain = int(re.search(r"endpointDrainSeconds: (\d+)", profile).group(1))
    assert grace > drain + pdf_module.EXTRACT_TIMEOUT_SECONDS


async def test_busy_readers_answer_at_once_and_leave_host_lookups_free(monkeypatch):
    """Parses held on the readers' own threads; a third is a 503, and the pool that resolves hosts stays free."""
    import asyncio
    import threading
    from concurrent.futures import ThreadPoolExecutor

    from public_sources.pdf import MAX_PDF_READERS
    from public_sources.pdf import PdfText

    started = threading.Semaphore(0)
    release = threading.Event()

    def held_parse(content, **_):
        started.release()
        release.wait(10)
        return PdfText(pages=("text",), page_count=1)

    monkeypatch.setattr(pdf_module, "parse_pdf", held_parse)
    loop = asyncio.get_running_loop()
    # As few default threads as readers: a reader waiting on that pool would take every one.
    loop.set_default_executor(ThreadPoolExecutor(max_workers=MAX_PDF_READERS))
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=make_app()), base_url=FETCHER) as client:
            running = [
                asyncio.create_task(client.post("/v1/extract", content=b"%PDF-")) for _ in range(MAX_PDF_READERS)
            ]
            for _ in range(MAX_PDF_READERS):
                assert await asyncio.to_thread(started.acquire, True, 5)

            busy = await asyncio.wait_for(client.post("/v1/extract", content=b"%PDF-"), 2)
            assert busy.status_code == 503 and busy.json()["code"] == "pdf_parse_timeout"
            # What /v1/fetch's guard does for every host (public_sources.egress._resolve).
            assert await asyncio.wait_for(loop.getaddrinfo("localhost", 443), 2)

            release.set()
            assert [answer.status_code for answer in await asyncio.gather(*running)] == [200] * MAX_PDF_READERS
    finally:
        release.set()
        loop.set_default_executor(ThreadPoolExecutor())


def test_a_body_past_the_ceiling_is_a_413(monkeypatch):
    from public_sources import fetcher as fetcher_module

    monkeypatch.setattr(fetcher_module, "MAX_BODY_BYTES", 10)
    answer = TestClient(make_app(), base_url=FETCHER).post("/v1/extract", content=b"%PDF-" + b"x" * 20)
    assert answer.status_code == 413 and answer.json()["code"] == "body_too_large"
