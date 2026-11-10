"""``ogc``: OGC API - Features and WFS 2.0 reads, and the ``geojson`` engine (ADR-0174)."""

from __future__ import annotations

import json

import httpx
import pytest
from public_sources import routing
from public_sources.access import access_for
from public_sources.access.base import AccessError
from public_sources.engines.geojson import GeoJson
from public_sources.fixtures import run_source
from public_sources.source import parse_inline_source
from public_sources_testing import SOURCES_DIR

BASE = "https://geo.xa.example/ogc"
ITEMS = f"{BASE}/collections/zoning-plans/items?limit=100&f=json"
COLLECTION = {
    "type": "FeatureCollection",
    "timeStamp": "2026-11-01T00:00:00Z",
    "features": [
        {"type": "Feature", "id": "z-1", "properties": {"name": "Zone A", "use": "residential"}, "geometry": None},
        {"type": "Feature", "properties": {"code": "z-2", "name": "Zone B", "use": ""}, "geometry": None},
    ],
}


@pytest.fixture(autouse=True)
def _sources(monkeypatch):
    monkeypatch.setenv("PUBLIC_SOURCES_DIR", str(SOURCES_DIR))
    monkeypatch.delenv(routing.ENV_FETCHER_URL, raising=False)


def _record(service: str = "features", data_flow: str = "public_only") -> dict:
    return {
        "id": "xa-zoning",
        "title": "Zoning of Xanadu",
        "territory": "XA",
        "protocol": "ogc",
        "format": "geojson",
        "hosts": ["geo.xa.example"],
        "data_flow": data_flow,
        "terms": {"url": f"{BASE}/terms", "licence": "public_open", "checked": "2026-11-01"},
        "access": {"service": service, "base_url": BASE, "collections": {"zoning": "zoning-plans"}},
        "engine": {"id_property": "code", "title_property": "name", "properties": ["use"]},
        "fixtures": [
            {
                "name": "items",
                "operation": "features",
                "args": {"collection": "zoning"},
                "responses": {ITEMS: {"content_type": "application/geo+json", "text": json.dumps(COLLECTION)}},
                "expect": {
                    "anchors": ["feature_z-1", "feature_z-2"],
                    "contains": ["use: residential"],
                    "min_passages": 2,
                },
            }
        ],
    }


async def test_an_ogc_api_features_source_passes_its_fixture():
    [result] = await run_source(parse_inline_source(_record()))
    assert result.ok, result.failures
    assert result.requested == [ITEMS]


def test_the_engine_reads_features_by_anchor_and_drops_geometry():
    document = GeoJson({"id_property": "code", "title_property": "name", "properties": ["use"]}).document(
        json.dumps(COLLECTION).encode()
    )
    assert [p.anchor for p in document.passages] == ["feature_z-1", "feature_z-2"]
    assert document.passages[0].heading == "Zone A"
    assert document.version == "2026-11-01T00:00:00Z"


async def _requested(record: dict, operation: str, args: dict) -> list[str]:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, json=COLLECTION)

    source = parse_inline_source(record)
    async with httpx.AsyncClient(
        transport=routing.source_transport(source, inner=httpx.MockTransport(handler))
    ) as client:
        await access_for(source).fetch(client, operation, args)
    return seen


async def test_a_wfs_source_asks_get_feature():
    [url] = await _requested(_record("wfs"), "features", {"collection": "zoning", "limit": "5"})
    assert url.startswith(f"{BASE}?service=WFS&version=2.0.0&request=GetFeature&typeNames=zoning-plans&count=5")


async def test_a_site_point_goes_only_to_a_site_keyed_source():
    with pytest.raises(AccessError, match="public_only"):
        await _requested(_record(), "features", {"collection": "zoning", "bbox": "16.3,48.2,16.4,48.3"})
    [url] = await _requested(
        _record(data_flow="site_keyed"), "features", {"collection": "zoning", "bbox": "16.3,48.2,16.4,48.3"}
    )
    assert "bbox=16.3%2C48.2%2C16.4%2C48.3" in url


async def test_an_unknown_collection_never_becomes_a_path():
    with pytest.raises(AccessError, match="no collection"):
        await _requested(_record(), "features", {"collection": "../admin"})
