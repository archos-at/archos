"""``source-test``: run a source's recorded fixtures through its own access type and engine.

Each fixture names an operation and its arguments, the URLs that operation is
expected to request (each mapped to a recorded response file), and what the
engine must make of the answer. The run serves the recorded files from a mock
transport behind the real guard, so it proves three things without a live
call: the access type builds exactly the recorded requests, every one of them
is on the source's hosts, and the engine reads the bytes as the record expects.

A request to a URL the fixture did not record fails the run: a change to a
record that moves a request is visible here before it reaches a publisher.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path

import httpx
from public_sources.access import access_for
from public_sources.egress import guarded_client
from public_sources.engines import engine_for
from public_sources.source import Fixture
from public_sources.source import Source

_CONTENT_TYPES = {
    ".json": "application/json",
    ".xml": "application/xml",
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
}


@dataclass
class FixtureResult:
    source_id: str
    fixture: str
    failures: list[str] = field(default_factory=list)
    requested: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.failures


def recorded_transport(directory: Path, responses: dict[str, str], requested: list[str]) -> httpx.MockTransport:
    """Serves each recorded URL from its file; any other URL is a 404 the run reports."""

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        requested.append(url)
        name = responses.get(url)
        if name is None:
            return httpx.Response(404, text=f"not recorded: {url}")
        path = directory / "fixtures" / name
        content_type = _CONTENT_TYPES.get(path.suffix, "application/octet-stream")
        return httpx.Response(200, headers={"content-type": content_type}, content=path.read_bytes())

    return httpx.MockTransport(handler)


async def run_fixture(source: Source, fixture: Fixture) -> FixtureResult:
    result = FixtureResult(source_id=source.id, fixture=fixture.name)
    transport = recorded_transport(source.directory, fixture.responses, result.requested)
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
            _check_document(engine.document(fetched.body, url=fetched.url), fetched.version, expect, result)
    except Exception as exc:  # noqa: BLE001
        result.failures.append(f"engine failed: {exc}")
    return result


def _check_search(search, expect: dict, result: FixtureResult) -> None:
    if len(search.hits) < int(expect.get("min_hits", 1)):
        result.failures.append(f"{len(search.hits)} hits, expected at least {expect.get('min_hits', 1)}")
    first = expect.get("first")
    if isinstance(first, dict) and search.hits:
        hit = search.hits[0]
        for name, value in first.items():
            actual = getattr(hit, name, None)
            if actual != value:
                result.failures.append(f"first hit {name} is {actual!r}, expected {value!r}")


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
