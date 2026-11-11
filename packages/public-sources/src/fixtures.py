"""``source-test``: run a source's recorded fixtures through its own access type and engine.

Each fixture names an operation and its arguments, the URLs that operation is
expected to request (each mapped to a recorded response file), and what the
engine must make of the answer. The run serves the recorded files from a mock
transport behind the real guard, so it proves three things without a live
call: the access type builds exactly the recorded requests, every one of them
is on the source's hosts, and the engine reads the bytes as the record expects.

A request to a URL the fixture did not record fails the run: a change to a
record that moves a request is visible here before it reaches a publisher.

A response may be a capture the platform took (:class:`CapturedResponse`): the
access type's request is proven as for any other, and the engine reads the
capture's text (``Engine.recorded_document``) in place of a body nobody kept.
A fixture whose capture was not handed over awaits its recording: it is not
run, and its result says which URLs it waits for.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path

import httpx
from public_sources.access import access_for
from public_sources.egress import guarded_client
from public_sources.engines import engine_for
from public_sources.source import CapturedResponse
from public_sources.source import Fixture
from public_sources.source import InlineResponse
from public_sources.source import Source

_CONTENT_TYPES = {
    ".json": "application/json",
    ".xml": "application/xml",
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".pdf": "application/pdf",
}


@dataclass
class FixtureResult:
    source_id: str
    fixture: str
    failures: list[str] = field(default_factory=list)
    requested: list[str] = field(default_factory=list)
    #: The URLs whose capture is not recorded yet; the fixture was not run.
    awaiting: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.failures and not self.awaiting


def recorded_transport(
    directory: Path | None, responses: dict[str, str | InlineResponse | CapturedResponse], requested: list[str]
) -> httpx.MockTransport:
    """Serves each recorded URL from its file, inline response or capture; any other URL is a 404 the run reports.

    A capture kept no body: its URL answers its content type and nothing else, and the engine reads its text.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        requested.append(url)
        name = responses.get(url)
        if name is None:
            return httpx.Response(404, text=f"not recorded: {url}")
        if isinstance(name, CapturedResponse):
            return httpx.Response(200, headers={"content-type": name.content_type}, content=b"")
        if isinstance(name, InlineResponse):
            return httpx.Response(200, headers={"content-type": name.content_type}, content=name.content())
        if directory is None:
            return httpx.Response(404, text=f"{name} is a file, and this source has no directory")
        path = directory / "fixtures" / name
        content_type = _CONTENT_TYPES.get(path.suffix, "application/octet-stream")
        return httpx.Response(200, headers={"content-type": content_type}, content=path.read_bytes())

    return httpx.MockTransport(handler)


async def run_fixture(source: Source, fixture: Fixture) -> FixtureResult:
    result = FixtureResult(source_id=source.id, fixture=fixture.name)
    captured = {url: r for url, r in fixture.responses.items() if isinstance(r, CapturedResponse)}
    result.awaiting = [url for url, response in captured.items() if not response.recorded]
    if result.awaiting:
        return result
    transport = recorded_transport(source._directory, fixture.responses, result.requested)
    async with guarded_client(source, transport=transport) as client:
        try:
            fetched = await access_for(source).fetch(client, fixture.operation, fixture.args)
        except Exception as exc:  # noqa: BLE001 - a fixture reports, it does not raise
            result.failures.append(f"fetch failed: {exc} (requested: {result.requested})")
            return result
    unused = sorted(set(fixture.responses) - set(result.requested))
    if unused:
        result.failures.append(f"recorded but never requested: {unused} (requested: {result.requested})")
    engine = engine_for(source)
    expect = fixture.expect
    try:
        if expect.get("kind") == "search":
            _check_search(engine.search(json.loads(fetched.body)), expect, result)  # type: ignore[attr-defined]
        else:
            document = await _document(engine, fixture, fetched)
            _check_document(document, fetched.version, expect, result)
    except Exception as exc:  # noqa: BLE001
        result.failures.append(f"engine failed: {exc}")
    return result


async def _document(engine, fixture: Fixture, fetched):
    """The engine's document: from the body, or from the capture that stands for the document the fetch ended on."""
    recording = fixture.responses.get(fetched.url)
    if isinstance(recording, CapturedResponse):
        return engine.recorded_document(recording.text or "", url=fetched.url)
    captured = sorted(url for url, r in fixture.responses.items() if isinstance(r, CapturedResponse))
    if captured:
        raise ValueError(f"a capture stands for the document itself, and the fetch ended on {fetched.url}: {captured}")
    # Off the event loop: the api tier serves chat sockets too, and a PDF is read in a child process.
    return await asyncio.to_thread(engine.document, fetched.body, url=fetched.url)


def _check_search(search, expect: dict, result: FixtureResult) -> None:
    if len(search.hits) < int(expect.get("min_hits", 1)):
        result.failures.append(f"{len(search.hits)} hits, expected at least {expect.get('min_hits', 1)}")
    first = expect.get("first")
    if not (isinstance(first, dict) and search.hits):
        return
    hit = search.hits[0]
    result.failures.extend(
        f"first hit {name} is {getattr(hit, name, None)!r}, expected {value!r}"
        for name, value in first.items()
        if getattr(hit, name, None) != value
    )


def _check_document(document, version: str, expect: dict, result: FixtureResult) -> None:
    if "title" in expect and document.title != expect["title"]:
        result.failures.append(f"title is {document.title!r}, expected {expect['title']!r}")
    if "version" in expect and (version or document.version) != expect["version"]:
        result.failures.append(f"version is {version or document.version!r}, expected {expect['version']!r}")
    if len(document.passages) < int(expect.get("min_passages", 1)):
        result.failures.append(f"{len(document.passages)} passages, expected at least {expect.get('min_passages', 1)}")
    anchors = [p.anchor for p in document.passages]
    wanted = list(expect.get("anchors", []))
    positions = [anchors.index(a) for a in wanted if a in anchors]
    missing = [a for a in wanted if a not in anchors]
    if missing:
        result.failures.append(f"anchors missing: {missing}")
    elif positions != sorted(positions):
        result.failures.append(f"anchors out of order: {wanted}")
    text = "\n".join(f"{p.number} {p.heading}\n{p.text}" for p in document.passages)
    for needle in expect.get("contains", []):
        if needle not in text:
            result.failures.append(f"text does not contain {needle!r}")
    for needle in expect.get("excludes", []):
        if needle in text:
            result.failures.append(f"text contains {needle!r}, which the engine should have dropped")


async def run_source(source: Source) -> list[FixtureResult]:
    return [await run_fixture(source, fixture) for fixture in source.fixtures]
