"""A source record's ``lookup`` block: what a law lookup reads instead of code (``public_sources.lookup``)."""

from __future__ import annotations

import copy

import pytest
from public_sources.lookup import Lookup
from public_sources.source import SourceError
from public_sources.source import get_source
from public_sources.source import parse_source


def _ris_raw() -> dict:
    """The shipped RIS record as a mapping, so a test can break one field of it."""
    source = get_source("at-ris")
    raw = source.model_dump(mode="json", exclude_none=True)
    raw["fixtures"] = [f.model_dump(mode="json") for f in source.fixtures]
    return copy.deepcopy(raw)


def test_the_ris_record_carries_its_lookup():
    lookup = get_source("at-ris").lookup

    assert lookup is not None
    assert lookup.statute(subdivision=True).id == "LrKons"
    assert lookup.statute(subdivision=False).id == "BrKons"
    assert lookup.consolidated() == {"BrKons", "LrKons"}
    assert lookup.case_law()[:3] == ("Vwgh", "Vfgh", "Justiz")
    assert lookup.territory is not None and lookup.territory.names["AT-9"] == "Wien"


def test_a_territory_table_the_access_lacks_is_refused():
    raw = _ris_raw()
    raw["lookup"]["territory"]["table"] = "no_such_table"

    with pytest.raises(SourceError, match="no_such_table"):
        parse_source(raw)


def test_a_reference_prefix_table_the_access_lacks_is_refused():
    raw = _ris_raw()
    raw["lookup"]["reference"]["prefix_table"] = "no_prefix_table"

    with pytest.raises(SourceError, match="no_prefix_table"):
        parse_source(raw)


def test_an_operation_the_access_lacks_is_refused():
    raw = _ris_raw()
    raw["lookup"]["document"] = "fetch_everything"

    with pytest.raises(SourceError, match="fetch_everything"):
        parse_source(raw)


def test_a_lookup_without_a_statute_collection_has_nothing_to_read():
    raw = _ris_raw()["lookup"]
    raw["collections"] = [{"id": "Vwgh", "kind": "case_law"}]

    with pytest.raises(ValueError, match="no statute collection"):
        Lookup.model_validate(raw)


def test_a_collection_id_used_twice_is_refused():
    raw = _ris_raw()["lookup"]
    raw["collections"] = [*raw["collections"], raw["collections"][0]]

    with pytest.raises(ValueError, match="repeat"):
        Lookup.model_validate(raw)


def test_a_released_record_is_read_without_the_fixtures_that_proved_it():
    from public_sources.source import parse_released_source

    raw = _ris_raw()
    raw.pop("fixtures")

    assert parse_released_source(raw).lookup == get_source("at-ris").lookup
    with pytest.raises(SourceError, match="fixture"):
        parse_source(raw)


def test_a_released_record_is_still_checked_and_a_licensed_one_refused():
    from public_sources.source import parse_released_source

    raw = _ris_raw()
    raw.pop("fixtures")
    with pytest.raises(SourceError, match="licensed"):
        parse_released_source({**raw, "terms": {**raw["terms"], "licence": "licensed"}})
    with pytest.raises(SourceError, match="no_such_table"):
        parse_released_source(
            {**raw, "lookup": {**raw["lookup"], "territory": {**raw["lookup"]["territory"], "table": "no_such_table"}}}
        )


def test_a_lookup_names_only_what_a_fixed_protocol_serves():
    from public_sources.access.web_document import WebDocument

    assert WebDocument.served_operations == ("document",)
    raw = _ris_raw()["lookup"]
    with pytest.raises(ValueError, match="at least 1"):
        Lookup.model_validate({**raw, "document": ""})


def _listed_portal(**lookup) -> dict:
    """A portal that lists its documents and offers no search (``web_document``), as released to a turn."""
    return {
        "id": "xa-gazette",
        "title": "Gazette of Xanadu",
        "territory": "XA",
        "protocol": "web_document",
        "format": "html_statute",
        "hosts": ["gazette.xa.example"],
        "terms": {"url": "https://gazette.xa.example/terms", "licence": "public_open", "checked": "2026-11-01"},
        "access": {"documents": [{"id": "code", "url": "https://gazette.xa.example/code", "title": "Code"}]},
        "engine": {"unit": "//section", "number": "./span"},
        "lookup": {
            "language": "en",
            "locus": {"units": [{"sign": "§", "forms": ["§"], "word": False}], "subsection": ["para"]},
            "collections": [{"id": "code", "kind": "statute"}],
            "wording": {"source": "Gazette", "subdivision": "province"},
            **lookup,
        },
    }


def test_a_listed_portal_is_read_and_one_naming_what_it_cannot_serve_is_refused():
    from public_sources.source import parse_released_source

    assert parse_released_source(_listed_portal()).lookup.search == ""
    with pytest.raises(SourceError, match="does not offer"):
        parse_released_source(_listed_portal(search="search"))
    with pytest.raises(SourceError, match="regions"):
        parse_released_source(_listed_portal(territory={"argument": "region", "table": "regions"}))
