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
