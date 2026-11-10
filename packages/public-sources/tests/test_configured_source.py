"""A source configured in the database (ADR-0174): parsed, tested, fetched and watched with no file of its own."""

from __future__ import annotations

import hashlib

import httpx
import pytest
from public_sources import routing
from public_sources.capture import capture_page
from public_sources.egress import EgressRefused
from public_sources.fetcher import make_app
from public_sources.fixtures import run_source
from public_sources.monitor import MonitorError
from public_sources.monitor import Seen
from public_sources.monitor import probe
from public_sources.source import SourceError
from public_sources.source import parse_inline_source
from public_sources_testing import SOURCES_DIR
from public_sources_testing import SYNTHETIC_PAGE
from public_sources_testing import SYNTHETIC_TERMS
from public_sources_testing import SYNTHETIC_URL
from public_sources_testing import synthetic_source


@pytest.fixture(autouse=True)
def _sources(monkeypatch):
    monkeypatch.setenv("PUBLIC_SOURCES_DIR", str(SOURCES_DIR))
    monkeypatch.delenv(routing.ENV_FETCHER_URL, raising=False)


def _site(pages: dict[str, bytes], seen: list[httpx.Request] | None = None) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        body = pages.get(str(request.url))
        if body is None:
            return httpx.Response(404)
        return httpx.Response(200, headers={"content-type": "text/html; charset=utf-8", "etag": '"v1"'}, content=body)

    return httpx.MockTransport(handler)


async def test_a_configured_source_passes_its_inline_fixtures():
    source = parse_inline_source(synthetic_source())

    [result] = await run_source(source)

    assert result.ok, result.failures
    assert result.requested == [SYNTHETIC_URL]


async def test_a_broken_inline_fixture_fails_the_run():
    record = synthetic_source()
    record["fixtures"][0]["expect"] = {"contains": ["not on the page"]}

    [result] = await run_source(parse_inline_source(record))

    assert not result.ok


def test_a_configured_source_may_not_take_a_repository_id_or_file_fixtures():
    with pytest.raises(SourceError, match="repository record"):
        parse_inline_source(synthetic_source(id="at-ris", territory="AT"))
    record = synthetic_source()
    record["fixtures"][0]["responses"] = {SYNTHETIC_URL: "page.html"}
    with pytest.raises(SourceError, match="inline"):
        parse_inline_source(record)


async def test_a_capture_reaches_only_the_configured_hosts():
    source = parse_inline_source(synthetic_source())
    page = await capture_page(source, SYNTHETIC_URL, inner=_site({SYNTHETIC_URL: SYNTHETIC_PAGE.encode()}))
    assert page.sha256 == hashlib.sha256(SYNTHETIC_PAGE.encode()).hexdigest()
    assert "every building" in (page.text or "")


async def test_the_monitor_takes_a_baseline_then_reports_a_change_and_the_terms():
    source = parse_inline_source(synthetic_source())
    first = await probe(source, Seen(), inner=_site({SYNTHETIC_URL: b"<h1>v1</h1>", SYNTHETIC_TERMS: b"terms v1"}))
    assert not first.changed and not first.terms_changed
    assert first.current.sha256 == hashlib.sha256(b"<h1>v1</h1>").hexdigest()

    same = await probe(
        source, first.current, inner=_site({SYNTHETIC_URL: b"<h1>v1</h1>", SYNTHETIC_TERMS: b"terms v1"})
    )
    assert not same.changed

    moved = await probe(
        source, first.current, inner=_site({SYNTHETIC_URL: SYNTHETIC_PAGE.encode(), SYNTHETIC_TERMS: b"terms v2"})
    )
    assert moved.changed and moved.terms_changed
    assert "every building" in (moved.text or "")
    assert moved.anchors == ("para_1",)


async def test_a_terms_page_off_the_hosts_is_not_fetched():
    record = synthetic_source()
    record["terms"]["url"] = "https://elsewhere.example/terms"
    seen: list[httpx.Request] = []
    result = await probe(parse_inline_source(record), Seen(), inner=_site({SYNTHETIC_URL: b"x"}, seen))
    assert result.terms_unwatched
    assert [str(request.url) for request in seen] == [SYNTHETIC_URL]


async def test_an_unwatched_source_is_refused():
    record = synthetic_source(monitor={"kind": "none"})
    with pytest.raises(MonitorError):
        await probe(parse_inline_source(record), Seen())


async def test_a_credential_goes_only_under_its_header_and_never_without_one():
    record = synthetic_source(credential={"header": "X-Api-Key", "prefix": ""})
    seen: list[httpx.Request] = []
    await capture_page(
        parse_inline_source(record), SYNTHETIC_URL, inner=_site({SYNTHETIC_URL: b"x"}, seen), credential="s3cret"
    )
    assert seen[0].headers["x-api-key"] == "s3cret"
    assert "authorization" not in seen[0].headers

    with pytest.raises(EgressRefused, match="no credential header"):
        routing.source_transport(parse_inline_source(synthetic_source()), credential="s3cret")


async def test_the_fetcher_serves_a_configured_source_by_its_hosts_and_attaches_the_key():
    seen: list[httpx.Request] = []
    app = make_app(transport=_site({SYNTHETIC_URL: b"ok"}, seen))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fetcher") as client:
        payload = {
            "source": "xa-gazette",
            "method": "GET",
            "url": SYNTHETIC_URL,
            "headers": {},
            "hosts": ["gazette.xa.example"],
        }
        answer = await client.post("/v1/fetch", json={**payload, "credential": {"header": "X-Api-Key", "value": "k"}})
        assert answer.status_code == 200 and answer.content == b"ok"
        assert seen[-1].headers["x-api-key"] == "k"

        off = await client.post("/v1/fetch", json={**payload, "url": "https://evil.example/"})
        assert off.status_code == 403

        # A repository record keeps its own hosts: a caller cannot widen them.
        widened = {**payload, "source": "at-ris", "url": "https://gazette.xa.example/"}
        assert (await client.post("/v1/fetch", json=widened)).status_code == 403
