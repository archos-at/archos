"""The fetcher service and the transport that routes a source's requests through it."""

from __future__ import annotations

import httpx
import pytest
from public_sources import routing
from public_sources.egress import EgressRefused
from public_sources.fetcher import make_app
from public_sources_testing import SOURCES_DIR


@pytest.fixture(autouse=True)
def _sources(monkeypatch):
    monkeypatch.setenv("PUBLIC_SOURCES_DIR", str(SOURCES_DIR))


def _upstream(calls: list[httpx.Request]):
    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(
            200, headers={"content-type": "text/html", "etag": '"v1"', "set-cookie": "s=1"}, text="<p>law</p>"
        )

    return httpx.MockTransport(handler)


async def _client_through_fetcher(monkeypatch, calls):
    """A client for at-ris whose requests go through the fetcher app, which answers from a mock upstream."""
    app = make_app(transport=_upstream(calls))
    monkeypatch.setenv(routing.ENV_FETCHER_URL, "http://public-source-fetcher:8095")
    transport = routing.source_transport("at-ris", inner=httpx.ASGITransport(app=app))
    return httpx.AsyncClient(transport=transport)


async def test_a_request_goes_through_the_fetcher_and_comes_back_unchanged(monkeypatch):
    calls: list[httpx.Request] = []
    async with await _client_through_fetcher(monkeypatch, calls) as client:
        response = await client.get(
            "https://www.ris.bka.gv.at/Dokumente/Landesnormen/LWI40000066/LWI40000066.html",
            headers={"Accept": "text/html", "X-Grid-Organization-Id": "org_1"},
        )
    assert response.status_code == 200
    assert response.text == "<p>law</p>"
    assert response.headers["etag"] == '"v1"'
    assert "set-cookie" not in response.headers
    [upstream] = calls
    assert str(upstream.url) == "https://www.ris.bka.gv.at/Dokumente/Landesnormen/LWI40000066/LWI40000066.html"
    assert "x-grid-organization-id" not in upstream.headers


async def test_a_host_off_the_source_is_refused_before_the_fetcher_is_asked(monkeypatch):
    calls: list[httpx.Request] = []
    async with await _client_through_fetcher(monkeypatch, calls) as client:
        with pytest.raises(EgressRefused):
            await client.get("https://qdrant.grid.svc.cluster.local:6333/collections")
    assert calls == []


async def test_the_fetcher_refuses_on_its_own_too():
    calls: list[httpx.Request] = []
    app = make_app(transport=_upstream(calls))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fetcher") as client:
        for payload in (
            {"source": "at-ris", "url": "http://169.254.169.254/latest/meta-data"},
            {"source": "at-ris", "url": "https://fedlex.data.admin.ch/sparqlendpoint"},
            {"source": "at-ris", "method": "DELETE", "url": "https://www.ris.bka.gv.at/x"},
            {"source": "zz-unknown", "url": "https://www.ris.bka.gv.at/x"},
        ):
            answer = await client.post("/v1/fetch", json=payload)
            assert answer.status_code == 403, payload
            assert "x-public-source-refused" in answer.headers
    assert calls == []


async def test_an_upstream_failure_is_a_502_not_a_crash():
    def broken(request):
        raise httpx.ConnectError("down")

    app = make_app(transport=httpx.MockTransport(broken))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fetcher") as client:
        answer = await client.post("/v1/fetch", json={"source": "at-ris", "url": "https://www.ris.bka.gv.at/x"})
    assert answer.status_code == 502


async def test_without_a_fetcher_the_guard_runs_in_process(monkeypatch):
    monkeypatch.delenv(routing.ENV_FETCHER_URL, raising=False)
    calls: list[httpx.Request] = []
    transport = routing.source_transport("at-ris", inner=_upstream(calls))
    async with httpx.AsyncClient(transport=transport) as client:
        with pytest.raises(EgressRefused):
            await client.get("https://example.org/")
        assert (await client.get("https://data.bka.gv.at/ris/api/v2.6/Bundesrecht")).status_code == 200
    assert len(calls) == 1
