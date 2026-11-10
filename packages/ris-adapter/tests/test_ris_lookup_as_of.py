"""``ris_lookup`` on a past day (``as_of``, ADR-0171): the version of that day or a miss, never today's text.

Each case runs the real tool through the agent-runtime path against a fake RIS:
the search, the version window, the fetch and the miss are the tool's own.
"""

from __future__ import annotations

from datetime import date

import pytest
from ris_adapter.client import RisDocument
from ris_adapter.client import RisHit
from ris_adapter.client import RisSearchResult
from ris_adapter.lookup.as_of import AS_OF_REFUSED
from ris_adapter.lookup.as_of import ENV_OVERRIDE
from ris_adapter.lookup.as_of import in_force_on
from ris_adapter.lookup.as_of import parse_day

OLD_URL = "https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR40000001/NOR40000001.html"
NEW_URL = "https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR40000002/NOR40000002.html"
WHOLE_LAW = "https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10000001"


def _version(url: str, since: str, until: str = "") -> RisHit:
    metadata = {"In Kraft seit": since, "Bundesland": ""}
    if until:
        metadata["Außer Kraft seit"] = until
    return RisHit(
        application="BrKons",
        document_number=url.rsplit("/", 1)[-1].removesuffix(".html"),
        title="Bundesgesetz (fixture) § 3",
        citation_url=url,
        content_urls={"Html": url},
        full_law_url=WHOLE_LAW,
        metadata=metadata,
    )


@pytest.fixture
def versions(lookup, monkeypatch):
    """Two versions of one §: 2015-01-01 to 2021-01-01, and from 2021-01-01."""
    monkeypatch.setenv(ENV_OVERRIDE, "on")
    lookup.client.search_result = RisSearchResult(
        hits=[_version(NEW_URL, "2021-01-01"), _version(OLD_URL, "2015-01-01", "2021-01-01")]
    )
    lookup.client.documents[OLD_URL] = RisDocument(
        url=OLD_URL, title="Bundesgesetz (fixture)", text="§ 3. (1) Die alte Fassung gilt."
    )
    lookup.client.documents[NEW_URL] = RisDocument(
        url=NEW_URL, title="Bundesgesetz (fixture)", text="§ 3. (1) Die neue Fassung gilt."
    )
    return lookup


@pytest.mark.asyncio
async def test_reads_only_the_version_in_force_on_the_day(versions, catalog):
    output = await versions.run(question="Was sagt § 3?", instrument="§ 3", application="BrKons", as_of="2019-06-01")

    assert versions.client.fetch_calls == [OLD_URL]
    assert "alte Fassung" in output and "neue Fassung" not in output
    # The federal search asked RIS for that day, by the record's date parameter.
    assert versions.client.search_calls[0]["params"].get("Fassung.FassungVom") == "2019-06-01"


@pytest.mark.asyncio
async def test_positive_control_today_reads_the_current_version(versions):
    output = await versions.run(question="Was sagt § 3?", instrument="§ 3", application="BrKons", as_of="2026-11-10")

    assert versions.client.fetch_calls == [NEW_URL]
    assert "neue Fassung" in output


@pytest.mark.asyncio
async def test_no_version_of_the_day_is_a_miss_that_does_not_substitute_today(versions):
    output = await versions.run(question="Was sagt § 3?", instrument="§ 3", application="BrKons", as_of="2010-01-01")

    assert versions.client.fetch_calls == []
    assert "no RIS version document of that day was found" in output
    assert "Today's text is not given in its place" in output


@pytest.mark.asyncio
async def test_a_past_day_never_reads_the_catalog_or_the_whole_law(versions, catalog):
    await versions.run(question="Bauansuchen § 63", jurisdiction="Wien", as_of="2019-06-01")

    assert all("GeltendeFassung" not in url for url in versions.client.fetch_calls)
    assert len(versions.client.search_calls) == 1


@pytest.mark.asyncio
async def test_with_the_flag_off_as_of_is_refused_and_nothing_is_searched(lookup, monkeypatch):
    monkeypatch.setenv(ENV_OVERRIDE, "off")

    output = await lookup.run(question="Was sagt § 3?", as_of="2019-06-01")

    assert output == AS_OF_REFUSED
    assert lookup.client.search_calls == [] and lookup.client.fetch_calls == []


@pytest.mark.asyncio
async def test_a_malformed_day_is_an_error(lookup, monkeypatch):
    monkeypatch.setenv(ENV_OVERRIDE, "on")

    output = await lookup.run(question="Was sagt § 3?", as_of="01.06.2019")

    assert output.startswith("Error: as_of must be a calendar day")


def test_the_version_window_excludes_the_day_it_went_out_of_force_and_unknown_dates():
    window = {"In Kraft seit": "01.01.2015", "Außer Kraft seit": "2021-01-01"}
    assert [
        in_force_on(window, date(*day)) for day in ((2014, 12, 31), (2015, 1, 1), (2020, 12, 31), (2021, 1, 1))
    ] == [
        False,
        True,
        True,
        False,
    ]
    assert in_force_on({}, date(2020, 1, 1)) is False
    assert in_force_on({"In Kraft seit": "2015-01-01", "Außer Kraft seit": "bald"}, date(2020, 1, 1)) is False
    assert parse_day("2023-02-30") is None
