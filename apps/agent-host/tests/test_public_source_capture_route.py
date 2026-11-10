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

    async def captured(source_id: str, url: str) -> CapturedPage:
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
        "retrievedAt": "2026-11-10T00:00:00+00:00",
    }


async def test_an_unknown_source_is_not_found_and_a_foreign_host_refused(client):
    unknown = await client.post(
        "/v1/public-sources/capture", headers=HEADERS, json={"source": "zz-nowhere", "url": "https://example.org/x"}
    )
    assert unknown.status_code == 404
    foreign = await client.post(
        "/v1/public-sources/capture", headers=HEADERS, json={"source": "at-ris", "url": "https://example.org/x"}
    )
    assert foreign.status_code == 403
