"""What a source record must say before it is accepted."""

from __future__ import annotations

import pytest
from public_sources import SourceError
from public_sources import load_sources
from public_sources.fixtures import run_source
from public_sources.source import parse_source
from public_sources_testing import HTML_PAGE
from public_sources_testing import html_source
from public_sources_testing import write_source


def test_a_new_portal_is_a_file_and_no_code(tmp_path):
    write_source(tmp_path, html_source(), {"bo.html": HTML_PAGE})
    sources = load_sources(tmp_path)
    assert list(sources) == ["xx-portal"]


async def test_its_fixture_runs_through_web_document_and_html_statute(tmp_path):
    write_source(tmp_path, html_source(), {"bo.html": HTML_PAGE})
    [result] = await run_source(load_sources(tmp_path)["xx-portal"])
    assert result.ok, result.failures
    assert result.requested == ["https://law.example.org/bo.html"]


def test_a_record_without_fixtures_is_refused():
    with pytest.raises(SourceError, match="fixture"):
        parse_source(html_source(fixtures=[]))


def test_a_url_off_the_hosts_is_refused():
    record = html_source(access={"documents": [{"id": "bo", "url": "https://elsewhere.example.org/bo.html"}]})
    with pytest.raises(SourceError, match="not an https URL on a host"):
        parse_source(record)


def test_plain_http_is_refused():
    record = html_source(access={"documents": [{"id": "bo", "url": "http://law.example.org/bo.html"}]})
    with pytest.raises(SourceError, match="not an https URL"):
        parse_source(record)


@pytest.mark.parametrize(
    "host", ["*.example.org", "https://law.example.org", "Law.Example.org", "10.0.0.1", "kubernetes"]
)
def test_hosts_are_exact_dns_names(host):
    with pytest.raises(SourceError, match="hosts must be exact"):
        parse_source(html_source(hosts=[host]))


@pytest.mark.parametrize(("field", "value"), [("protocol", "ftp"), ("format", "pdf_layout")])
def test_an_unknown_protocol_or_format_is_code_to_write_not_a_record(field, value):
    with pytest.raises(SourceError, match=f"unknown {field}"):
        parse_source(html_source(**{field: value}))


def test_an_unknown_licence_is_refused():
    terms = {"url": "https://law.example.org/terms", "licence": "maybe", "checked": "2026-11-06"}
    with pytest.raises(SourceError):
        parse_source(html_source(terms=terms))


def test_an_unknown_field_is_refused_rather_than_ignored():
    with pytest.raises(SourceError, match="extra"):
        parse_source(html_source(credentials="secret"))


def test_a_fixture_that_moves_a_request_fails(tmp_path):
    record = html_source()
    record["fixtures"][0]["responses"] = {"https://law.example.org/other.html": "bo.html"}
    record["access"] = {
        "documents": [
            {"id": "bo", "url": "https://law.example.org/bo.html"},
            {"id": "x", "url": "https://law.example.org/other.html"},
        ]
    }
    write_source(tmp_path, record, {"bo.html": HTML_PAGE})
    import asyncio

    [result] = asyncio.run(run_source(load_sources(tmp_path)["xx-portal"]))
    assert not result.ok
    assert any("fetch failed" in f or "never requested" in f for f in result.failures)


def test_two_records_with_one_id_are_refused(tmp_path):
    write_source(tmp_path, html_source(), {"bo.html": HTML_PAGE})
    other = tmp_path / "yy" / "portal"
    other.mkdir(parents=True)
    (other / "source.yml").write_text((tmp_path / "xx" / "portal" / "source.yml").read_text())
    with pytest.raises(SourceError, match="used twice"):
        load_sources(tmp_path)
