"""RIS is read through the public-source fetcher, and from nowhere else (ADR-0162 amendment).

The request RIS sees is the one ``RisClient`` builds (URL, query, order), made
from the fetcher's pod; without a fetcher configured a RIS request is refused,
because there is no in-process path any more. What the fetcher guards (hosts at
every hop, public addresses only, a DNS answer that changes) is tested in
``packages/public-sources/tests/test_egress.py``, where the guard runs.
"""

from __future__ import annotations

import httpx
import pytest
from public_sources import routing
from public_sources.fetcher import make_app
from ris_adapter.client import RisClient
from ris_adapter.client import RisError

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


def _upstream(seen: list[httpx.Request]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=_SEARCH_BODY)

    return httpx.MockTransport(handler)


async def test_a_search_reaches_ris_through_the_fetcher_as_the_client_built_it(monkeypatch):
    monkeypatch.setenv(routing.ENV_FETCHER_URL, "http://public-source-fetcher:8095")
    upstream: list[httpx.Request] = []
    fetcher = httpx.ASGITransport(app=make_app(transport=_upstream(upstream)))
    client = RisClient(transport=fetcher, max_retries=1)

    result = await client.search("LrKons", params={"Suchworte": "Bauordnung", "Bundesland.SucheInWien": "true"})
    await client.aclose()

    assert result.hits[0].document_number == "NOR1"
    assert [str(request.url) for request in upstream] == [
        "https://data.bka.gv.at/ris/api/v2.6/Landesrecht?Applikation=LrKons&DokumenteProSeite=Twenty"
        "&Seitennummer=1&Suchworte=Bauordnung&Bundesland.SucheInWien=true"
    ]


async def test_without_a_fetcher_a_ris_request_is_refused_and_nothing_is_sent(monkeypatch):
    monkeypatch.delenv(routing.ENV_FETCHER_URL, raising=False)
    client = RisClient(max_retries=3)

    with pytest.raises(RisError, match="no public-source fetcher"):
        await client.search("LrKons", params={"Suchworte": "Bauordnung"})
    await client.aclose()
