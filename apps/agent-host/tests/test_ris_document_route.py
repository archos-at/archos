from __future__ import annotations

from unittest.mock import AsyncMock
from unittest.mock import patch

import pytest
from fastapi import APIRouter
from fastapi import FastAPI
from httpx import ASGITransport
from httpx import AsyncClient

from agent_host.routes import ris as ris_module
from agent_host.routes.ris import MAX_DOCUMENT_TEXT_CHARS
from agent_host.routes.ris import add_ris_routes

TOKEN = "test-internal-token"
URL = "https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrW&Gesetzesnummer=20000006"


@pytest.fixture(autouse=True)
def _no_cached_documents(monkeypatch):
    ris_module._RIS_CLIENT = None
    monkeypatch.setattr("ris_adapter.cache.cache_get_json", AsyncMock(return_value=None))
    monkeypatch.setattr("ris_adapter.cache.cache_set_json", AsyncMock(return_value=None))
    yield
    ris_module._RIS_CLIENT = None


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", TOKEN)
    app = FastAPI()
    router = APIRouter()
    add_ris_routes(router)
    app.include_router(router)
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _document(text: str = "§ 108. Schutz vor Brandgefahr", title: str = "Bauordnung für Wien"):
    from ris_adapter.client import RisDocument

    return RisDocument(url=URL, title=title, text=text)


@pytest.mark.asyncio
async def test_requires_the_internal_token(client):
    async with client as http:
        response = await http.get("/v1/ris/document", params={"reference": URL})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_returns_the_document_text(client):
    with patch(
        "ris_adapter.client.RisClient.fetch_document_text",
        new=AsyncMock(return_value=_document()),
    ):
        async with client as http:
            response = await http.get(
                "/v1/ris/document",
                params={"reference": URL},
                headers={"x-grid-internal-token": TOKEN},
            )

    assert response.status_code == 200
    body = response.json()
    assert body["url"] == URL
    assert body["title"] == "Bauordnung für Wien"
    assert "Brandgefahr" in body["text"]
    assert body["truncated"] is False


@pytest.mark.asyncio
async def test_accepts_a_bare_document_number(client):
    fetch = AsyncMock(return_value=_document())
    with patch("ris_adapter.client.RisClient.fetch_document_text", new=fetch):
        async with client as http:
            response = await http.get(
                "/v1/ris/document",
                params={"reference": "NOR40217157"},
                headers={"x-grid-internal-token": TOKEN},
            )

    assert response.status_code == 200
    assert fetch.await_args.args[0].startswith("https://www.ris.bka.gv.at/")


@pytest.mark.asyncio
async def test_says_truncated_rather_than_ending_mid_sentence(client):
    long_text = "a " * MAX_DOCUMENT_TEXT_CHARS
    with patch(
        "ris_adapter.client.RisClient.fetch_document_text",
        new=AsyncMock(return_value=_document(text=long_text)),
    ):
        async with client as http:
            response = await http.get(
                "/v1/ris/document",
                params={"reference": URL},
                headers={"x-grid-internal-token": TOKEN},
            )

    body = response.json()
    assert body["truncated"] is True
    assert len(body["text"]) == MAX_DOCUMENT_TEXT_CHARS


@pytest.mark.asyncio
async def test_an_over_long_document_is_windowed_around_the_cited_passage(client):
    passage = "Bauwerke oder Bauwerksteile in denen gefaehrliche Stoffe gelagert werden"
    text = ("x " * 1_500_000) + passage + (" y" * 1_000_000)

    with patch(
        "ris_adapter.client.RisClient.fetch_document_text",
        new=AsyncMock(return_value=_document(text=text)),
    ):
        async with client as http:
            response = await http.get(
                "/v1/ris/document",
                params={"reference": URL, "passage": passage},
                headers={"x-grid-internal-token": TOKEN},
            )

    body = response.json()
    assert body["truncated"] is True
    assert len(body["text"]) == MAX_DOCUMENT_TEXT_CHARS
    assert passage in body["text"]


@pytest.mark.asyncio
async def test_a_passage_that_cannot_be_located_falls_back_to_the_head(client):
    text = ("x " * 1_500_000) + "eine ganz andere Stelle" + (" y" * 1_000_000)

    with patch(
        "ris_adapter.client.RisClient.fetch_document_text",
        new=AsyncMock(return_value=_document(text=text)),
    ):
        async with client as http:
            response = await http.get(
                "/v1/ris/document",
                params={"reference": URL, "passage": "worte die nirgendwo im dokument stehen"},
                headers={"x-grid-internal-token": TOKEN},
            )

    body = response.json()
    assert body["truncated"] is True
    assert body["text"].startswith("x ")


@pytest.mark.asyncio
async def test_a_document_that_fits_is_never_clipped_or_moved(client):
    with patch(
        "ris_adapter.client.RisClient.fetch_document_text",
        new=AsyncMock(return_value=_document(text="§ 108. Lagerung gefaehrlicher Stoffe")),
    ):
        async with client as http:
            response = await http.get(
                "/v1/ris/document",
                params={"reference": URL, "passage": "Lagerung gefaehrlicher Stoffe"},
                headers={"x-grid-internal-token": TOKEN},
            )

    body = response.json()
    assert body["truncated"] is False
    assert body["text"] == "§ 108. Lagerung gefaehrlicher Stoffe"


@pytest.mark.asyncio
async def test_a_non_ris_url_is_the_callers_error_not_an_outage(client):
    async with client as http:
        response = await http.get(
            "/v1/ris/document",
            params={"reference": "https://example.org/gesetz"},
            headers={"x-grid-internal-token": TOKEN},
        )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_an_unreachable_ris_is_a_bad_gateway(client):
    with patch(
        "ris_adapter.client.RisClient.fetch_document_text",
        new=AsyncMock(side_effect=RuntimeError("connection reset")),
    ):
        async with client as http:
            response = await http.get(
                "/v1/ris/document",
                params={"reference": URL},
                headers={"x-grid-internal-token": TOKEN},
            )

    assert response.status_code == 502


@pytest.mark.asyncio
async def test_reads_through_the_shared_cache_rather_than_refetching(client, monkeypatch):
    monkeypatch.setattr(
        "ris_adapter.cache.cache_get_json",
        AsyncMock(return_value={"url": URL, "title": "Aus dem Cache", "text": "§ 108. Gecacht"}),
    )
    fetch = AsyncMock(return_value=_document())
    with patch("ris_adapter.client.RisClient.fetch_document_text", new=fetch):
        async with client as http:
            response = await http.get(
                "/v1/ris/document",
                params={"reference": URL},
                headers={"x-grid-internal-token": TOKEN},
            )

    assert response.json()["text"] == "§ 108. Gecacht"
    fetch.assert_not_awaited()


@pytest.mark.asyncio
async def test_an_ambiguous_passage_gets_the_head_rather_than_a_guess(client):
    clause = "Die Anforderungen dieser Verordnung sind sinngemaess anzuwenden auf"
    text = f"{clause} Neubauten. " + ("x " * 1_500_000) + f"{clause} Zubauten. " + ("y " * 1_000_000)

    with patch(
        "ris_adapter.client.RisClient.fetch_document_text",
        new=AsyncMock(return_value=_document(text=text)),
    ):
        async with client as http:
            response = await http.get(
                "/v1/ris/document",
                params={"reference": URL, "passage": clause},
                headers={"x-grid-internal-token": TOKEN},
            )

    body = response.json()
    assert body["truncated"] is True
    assert body["text"].startswith(clause)
