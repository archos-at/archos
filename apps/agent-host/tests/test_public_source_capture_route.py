"""The internal capture route (ADR-0170): the BFF's way to a public page, since only backend roles reach the fetcher.

It is a thin door onto ``public_sources.capture``: the internal token is required, an unknown source is a 404, a
host off the source a 403, and a page comes back with its digest and text.
"""

from __future__ import annotations

import pytest
from fastapi import APIRouter
from fastapi import FastAPI
from httpx import ASGITransport
from httpx import AsyncClient

from agent_host.routes.internal_auth import _TOKEN_HEADERS
from agent_host.routes.public_source_capture import add_public_source_capture_routes

TOKEN = "test-internal-token"
HEADERS = {_TOKEN_HEADERS[0]: TOKEN}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", TOKEN)
    app = FastAPI()
    router = APIRouter()
    add_public_source_capture_routes(router)
    app.include_router(router)
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_refuses_a_call_without_the_internal_token(client):
    answer = await client.post(
        "/v1/public-sources/capture", json={"source": "at-ris", "url": "https://www.ris.bka.gv.at/x"}
    )
    assert answer.status_code in (401, 403)


async def test_answers_the_capture_of_a_page(client, monkeypatch):
    from public_sources.capture import CapturedPage

    async def captured(source_id, url: str, **_: object) -> CapturedPage:
        return CapturedPage(url, url, "text/html", "a" * 64, 12, "Bauordnung", "2026-11-10T00:00:00+00:00")

    monkeypatch.setattr("public_sources.capture.capture_page", captured)
    answer = await client.post(
        "/v1/public-sources/capture", headers=HEADERS, json={"source": "at-ris", "url": "https://www.ris.bka.gv.at/x"}
    )
    assert answer.status_code == 200
    assert answer.json() == {
        "url": "https://www.ris.bka.gv.at/x",
        "finalUrl": "https://www.ris.bka.gv.at/x",
        "contentType": "text/html",
        "sha256": "a" * 64,
        "bytes": 12,
        "text": "Bauordnung",
        "pages": None,
        "note": None,
        "retrievedAt": "2026-11-10T00:00:00+00:00",
    }


async def test_a_pdf_that_needs_a_password_is_refused_with_its_problem_code(client, monkeypatch):
    from public_sources.capture import CaptureError

    async def refused(source_id, url: str, **_: object):
        raise CaptureError("the PDF needs a password to open", 422, "pdf_encrypted")

    monkeypatch.setattr("public_sources.capture.capture_page", refused)
    answer = await client.post(
        "/v1/public-sources/capture",
        headers=HEADERS,
        json={"source": "at-ris", "url": "https://www.ris.bka.gv.at/x.pdf"},
    )
    assert answer.status_code == 422
    assert answer.json() == {"detail": "the PDF needs a password to open", "code": "pdf_encrypted"}


async def test_an_unknown_source_is_not_found_and_a_foreign_host_refused(client):
    unknown = await client.post(
        "/v1/public-sources/capture", headers=HEADERS, json={"source": "zz-nowhere", "url": "https://example.org/x"}
    )
    assert unknown.status_code == 404
    foreign = await client.post(
        "/v1/public-sources/capture", headers=HEADERS, json={"source": "at-ris", "url": "https://example.org/x"}
    )
    assert foreign.status_code == 403
    assert foreign.json()["code"] == "egress_refused"


async def test_checks_a_configured_source_by_its_inline_fixtures(client, monkeypatch):
    from public_sources_testing import SOURCES_DIR
    from public_sources_testing import synthetic_source

    monkeypatch.setenv("PUBLIC_SOURCES_DIR", str(SOURCES_DIR))
    good = await client.post("/v1/public-sources/check", headers=HEADERS, json={"config": synthetic_source()})
    assert good.status_code == 200 and good.json()["valid"] is True

    broken = synthetic_source()
    broken["hosts"] = ["elsewhere.example"]
    bad = await client.post("/v1/public-sources/check", headers=HEADERS, json={"config": broken})
    assert bad.json()["valid"] is False and bad.json()["problems"]

    shadow = await client.post(
        "/v1/public-sources/check", headers=HEADERS, json={"config": synthetic_source(id="at-ris", territory="AT")}
    )
    assert shadow.json()["valid"] is False


async def test_a_fixture_awaiting_its_capture_is_not_valid_and_is_no_problem(client, monkeypatch):
    """A draft is proposed before its capture can be taken: the check says which fixture waits, not that it failed."""
    from public_sources_testing import SOURCES_DIR
    from public_sources_testing import synthetic_source

    monkeypatch.setenv("PUBLIC_SOURCES_DIR", str(SOURCES_DIR))
    url = "https://gazette.xa.example/code.pdf"
    config = synthetic_source(format="pdf_document", engine={}, access={"documents": [{"id": "code", "url": url}]})
    config["fixtures"][0].update(responses={url: {"capture_id": None}}, expect={"contains": ["§ 1"]})

    waiting = (await client.post("/v1/public-sources/check", headers=HEADERS, json={"config": config})).json()
    assert waiting["valid"] is False and waiting["problems"] == []
    assert waiting["fixtures"] == [{"name": "code", "ok": False, "requested": [], "awaiting": [url]}]

    recording = {"capture_id": "7d3c1f0a-4b7e-4c58-9a51-0c2f6a1b9e11", "content_type": "application/pdf"}
    config["fixtures"][0]["responses"] = {url: {**recording, "text": "Building Code\n§ 1 Scope\fpage two"}}
    recorded = (await client.post("/v1/public-sources/check", headers=HEADERS, json={"config": config})).json()
    assert recorded["valid"] is True
    assert recorded["fixtures"] == [{"name": "code", "ok": True, "requested": [url], "awaiting": []}]


async def test_probes_a_configured_source(client, monkeypatch):
    from public_sources.monitor import ProbeResult
    from public_sources.monitor import Seen
    from public_sources_testing import SOURCES_DIR
    from public_sources_testing import synthetic_source

    monkeypatch.setenv("PUBLIC_SOURCES_DIR", str(SOURCES_DIR))
    asked: list[Seen] = []

    async def probed(source, previous: Seen, **_: object) -> ProbeResult:
        asked.append(previous)
        return ProbeResult(True, False, Seen(sha256="b" * 64), "https://gazette.xa.example/x", "text/html", "new", 3)

    monkeypatch.setattr("public_sources.monitor.probe", probed)
    answer = await client.post(
        "/v1/public-sources/probe",
        headers=HEADERS,
        json={"config": synthetic_source(), "previous": {"sha256": "a" * 64}},
    )
    assert answer.status_code == 200
    assert answer.json()["changed"] is True and answer.json()["current"]["sha256"] == "b" * 64
    assert asked[0].sha256 == "a" * 64
    refused = await client.post("/v1/public-sources/probe", json={"config": synthetic_source()})
    assert refused.status_code in (401, 403)


async def test_lists_the_built_in_sources_with_their_recorded_fixtures(client, monkeypatch):
    """The repository's own sources, read-only beside the platform's records in source-status (Decision C)."""
    from public_sources_testing import SOURCES_DIR

    from agent_host.routes import public_source_capture

    monkeypatch.setenv("PUBLIC_SOURCES_DIR", str(SOURCES_DIR))
    monkeypatch.setattr(public_source_capture, "_built_in", None)

    refused = await client.post("/v1/public-sources/built-in", json={})
    answer = await client.post("/v1/public-sources/built-in", headers=HEADERS, json={})

    assert refused.status_code in (401, 403)
    assert answer.status_code == 200
    sources = {source["sourceKey"]: source for source in answer.json()["sources"]}
    assert {"at-ris", "ch-fedlex"} <= set(sources)
    ris = sources["at-ris"]
    assert ris["territory"] == "AT" and ris["format"] == "ris_xml" and "data.bka.gv.at" in ris["hosts"]
    assert ris["fixtures"]["valid"] is True and all(fixture["ok"] for fixture in ris["fixtures"]["fixtures"])


# --- A text kept in the base corpus from a URL (ADR-0165, "Texts are attached in the request") -------------

PDF_BYTES = b"%PDF-1.7\nOIB-Richtlinie 1\n%%EOF"
PDF_URL = "https://www.ris.bka.gv.at/richtlinie_1.pdf"
FETCHER = "http://public-source-fetcher.test:8095"


@pytest.fixture
def kept(monkeypatch):
    """The corpus store's side of the import, recorded: nothing is stored or queued for real."""
    from agent import corpus_store
    from agent import oib_sync

    calls: dict = {"stored": [], "existing": {}}

    def get_file(name: str):
        sha = calls["existing"].get(name)
        return None if sha is None else corpus_store.FileRow(name, f"base-corpus/{name}", sha, 1)

    def store_and_request(name, data, doc_class=None, *, enqueue):
        calls["stored"].append((name, data))
        return True

    monkeypatch.setattr(corpus_store, "get_file", get_file)
    monkeypatch.setattr(oib_sync, "store_and_request", store_and_request)
    return calls


@pytest.fixture
def fetcher(monkeypatch):
    """Every request this tier sends, recorded; only the fetcher answers (its fetch and its PDF read)."""
    import httpx

    requests: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if str(request.url).startswith(f"{FETCHER}/v1/fetch"):
            return httpx.Response(200, headers={"content-type": "application/pdf"}, content=PDF_BYTES)
        if str(request.url).startswith(f"{FETCHER}/v1/extract"):
            return httpx.Response(200, json={"pages": ["OIB-Richtlinie 1"], "page_count": 1, "title": ""})
        raise AssertionError(f"this tier requested {request.url} itself")

    async def answer_async(self, request: httpx.Request) -> httpx.Response:
        await request.aread()
        return answer(request)

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", answer_async)
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", lambda self, request: answer(request))
    return requests


def _never_here(*_: object, **__: object):
    raise AssertionError("the api tier parsed a public PDF itself")


async def test_a_text_from_a_url_is_fetched_and_read_by_the_fetcher_and_never_parsed_here(
    client, kept, fetcher, monkeypatch
):
    import hashlib

    monkeypatch.setenv("PUBLIC_SOURCE_FETCHER_URL", FETCHER)
    monkeypatch.setattr("public_sources.pdf.parse_pdf", _never_here)
    monkeypatch.setattr("subprocess.run", _never_here)

    answer = await client.post(
        "/v1/public-sources/corpus-text",
        headers=HEADERS,
        json={"source": "at-ris", "url": PDF_URL, "fileStem": "richtlinie-1"},
    )

    assert answer.status_code == 200, answer.text
    assert answer.json()["fileName"] == f"richtlinie-1-{hashlib.sha256(PDF_BYTES).hexdigest()[:12]}.pdf"
    assert answer.json()["stored"] is True
    assert answer.json()["sha256"] == hashlib.sha256(PDF_BYTES).hexdigest()
    assert answer.json()["pages"] == 1
    assert "text" not in answer.json()
    # Both the bytes and their read came from the fetcher, and nothing else was requested.
    paths = [str(request.url).removeprefix(FETCHER).split("?")[0] for request in fetcher]
    assert paths == ["/v1/fetch", "/v1/extract"]
    assert kept["stored"] == [(answer.json()["fileName"], PDF_BYTES)]


async def test_without_a_fetcher_nothing_is_fetched_parsed_or_kept(client, kept, monkeypatch):
    monkeypatch.delenv("PUBLIC_SOURCE_FETCHER_URL", raising=False)
    monkeypatch.setattr("public_sources.pdf.parse_pdf", _never_here)

    answer = await client.post(
        "/v1/public-sources/corpus-text",
        headers=HEADERS,
        json={"source": "at-ris", "url": PDF_URL, "fileStem": "richtlinie-1"},
    )

    assert answer.status_code == 403
    assert answer.json()["code"] == "egress_refused"
    assert kept["stored"] == []


async def test_a_page_that_is_no_pdf_is_refused_and_not_kept(client, kept, monkeypatch):
    from public_sources.capture import CapturedPage

    async def captured(source_id, url: str, **_: object) -> CapturedPage:
        return CapturedPage(url, url, "text/html", "a" * 64, 12, "Bauordnung", "2026-11-10T00:00:00+00:00")

    monkeypatch.setattr("public_sources.capture.capture_page", captured)
    answer = await client.post(
        "/v1/public-sources/corpus-text",
        headers=HEADERS,
        json={"source": "at-ris", "url": "https://www.ris.bka.gv.at/x", "fileStem": "x"},
    )

    assert answer.status_code == 422
    assert answer.json()["code"] == "not_a_pdf"
    assert kept["stored"] == []


async def test_a_text_is_kept_under_a_name_that_carries_its_hash_and_nothing_is_ever_replaced(
    client, kept, fetcher, monkeypatch
):
    """Content-addressed names: the bytes under a name never change, whatever the caller sends."""
    import hashlib

    monkeypatch.setenv("PUBLIC_SOURCE_FETCHER_URL", FETCHER)
    sha = hashlib.sha256(PDF_BYTES).hexdigest()
    name = f"richtlinie-1-{sha[:12]}.pdf"
    body = {"source": "at-ris", "url": PDF_URL, "fileStem": "richtlinie-1"}

    first = await client.post("/v1/public-sources/corpus-text", headers=HEADERS, json=body)
    assert first.status_code == 200
    assert first.json()["fileName"] == name
    assert kept["stored"] == [(name, PDF_BYTES)]

    # The same bytes again are kept already: nothing is stored or queued twice.
    kept["existing"][name] = sha
    again = await client.post("/v1/public-sources/corpus-text", headers=HEADERS, json=body)
    assert again.status_code == 200
    assert again.json()["stored"] is False
    assert len(kept["stored"]) == 1

    # Other bytes under that name are never replaced, also when the caller asks for it as it once could.
    kept["existing"][name] = "b" * 64
    taken = await client.post("/v1/public-sources/corpus-text", headers=HEADERS, json={**body, "replace": True})
    assert taken.status_code == 409
    assert taken.json()["code"] == "name_taken"
    assert len(kept["stored"]) == 1
