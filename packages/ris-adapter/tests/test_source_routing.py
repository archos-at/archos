"""``sourceRouting``: the same RIS requests, made through the public-source fetcher (ADR-0162).

Off, ``RisClient`` makes its requests from its own process exactly as before.
On, they go through ``public_sources.routing``: the request a source sees is
identical (URL, query, order), and what leaves is only what the record allows.
"""

from __future__ import annotations

import httpx
import pytest
from public_sources import routing as source_routing
from public_sources.fetcher import make_app
from ris_adapter import routing
from ris_adapter.client import RisClient

_SEARCH_BODY = {
    "OgdSearchResult": {
        "OgdDocumentResults": {
            "Hits": {"#text": "1", "@pageNumber": "1", "@pageSize": "20"},
            "OgdDocumentReference": {
                "Data": {"Metadaten": {"Technisch": {"ID": "NOR1", "Applikation": "BrKons"}, "Kurztitel": "BauKG"}}
            },
        }
    }
}


def _upstream(seen: list[httpx.Request]):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=_SEARCH_BODY)

    return httpx.MockTransport(handler)


@pytest.fixture(autouse=True)
def _forget(monkeypatch):
    routing.forget()
    monkeypatch.delenv(routing.ENV_OVERRIDE, raising=False)
    monkeypatch.delenv(source_routing.ENV_FETCHER_URL, raising=False)
    yield
    routing.forget()


async def _search(client: RisClient) -> str:
    result = await client.search("LrKons", params={"Suchworte": "Bauordnung", "Bundesland.SucheInWien": "true"})
    assert result.hits[0].document_number == "NOR1"
    await client.aclose()
    return ""


async def test_off_and_on_send_the_same_request(monkeypatch):
    direct: list[httpx.Request] = []
    await _search(RisClient(transport=_upstream(direct), max_retries=1))

    monkeypatch.setenv(routing.ENV_OVERRIDE, "on")
    monkeypatch.setenv(source_routing.ENV_FETCHER_URL, "http://public-source-fetcher:8095")
    behind_fetcher: list[httpx.Request] = []
    fetcher = httpx.ASGITransport(app=make_app(transport=_upstream(behind_fetcher)))
    await _search(RisClient(transport=fetcher, max_retries=1))

    assert [str(r.url) for r in behind_fetcher] == [str(r.url) for r in direct]
    assert str(direct[0].url) == (
        "https://data.bka.gv.at/ris/api/v2.6/Landesrecht?Applikation=LrKons&DokumenteProSeite=Twenty"
        "&Seitennummer=1&Suchworte=Bauordnung&Bundesland.SucheInWien=true"
    )


async def test_off_is_the_default_without_an_organization_or_a_flag(monkeypatch):
    assert await routing.routing_enabled() is False


def test_the_flag_is_asked_per_organization_and_any_failure_reads_off(monkeypatch):
    answers = {"org_on": True, "org_off": False}

    def fake_fetch(organization_id: str) -> bool:
        if organization_id == "org_down":
            raise RuntimeError("BFF unavailable")
        return answers[organization_id]

    monkeypatch.setattr(routing, "_fetch", fake_fetch)
    assert routing.enabled_for("org_on") is True
    assert routing.enabled_for("org_off") is False
    assert routing.enabled_for("org_down") is False
    assert routing.enabled_for(None) is False


def test_the_turn_flags_read_source_routing_as_an_entitlement(monkeypatch):
    from agent.stages import flags

    monkeypatch.setattr(
        flags.bff_http, "get_json", lambda *a, **k: {"enabled": [], "features": {"sourceRouting": True}}
    )
    assert flags.fetch_turn_flags(organization_id="org_x").source_routing_allowed is True
    monkeypatch.setattr(flags.bff_http, "get_json", lambda *a, **k: {"enabled": [], "features": {}})
    assert flags.fetch_turn_flags(organization_id="org_x").source_routing_allowed is False


def test_a_failed_flag_read_is_kept_like_an_answer(monkeypatch):
    calls: list[str] = []

    def down(organization_id: str) -> bool:
        calls.append(organization_id)
        raise RuntimeError("BFF unavailable")

    monkeypatch.setattr(routing, "_fetch", down)
    assert [routing.enabled_for("org_down") for _ in range(5)] == [False] * 5
    assert calls == ["org_down"], "a BFF that is down was asked once per request"


async def test_the_flag_is_read_once_per_request_not_once_per_retry(monkeypatch):
    reads: list[int] = []

    async def counted() -> bool:
        reads.append(1)
        return False

    monkeypatch.setattr("ris_adapter.client.routing_enabled", counted)
    attempts: list[int] = []

    def flaky(request: httpx.Request) -> httpx.Response:
        attempts.append(1)
        return httpx.Response(503) if len(attempts) < 3 else httpx.Response(200, json=_SEARCH_BODY)

    monkeypatch.setattr("ris_adapter.client.asyncio.sleep", _no_sleep)
    client = RisClient(transport=httpx.MockTransport(flaky), max_retries=3)
    await client.search("LrKons", params={"Suchworte": "x"})
    await client.aclose()
    assert (len(attempts), len(reads)) == (3, 1)


async def _no_sleep(seconds: float) -> None:
    return None


async def test_the_answer_is_recorded_on_the_turns_trace(monkeypatch):
    recorded: dict[str, object] = {}
    from agent.observability import langfuse_trace_attributes

    monkeypatch.setattr(langfuse_trace_attributes, "record_trace_metadata", lambda **pairs: recorded.update(pairs))
    monkeypatch.setenv(routing.ENV_OVERRIDE, "on")
    assert await routing.routing_enabled() is True
    assert recorded == {"source_routing": True}
