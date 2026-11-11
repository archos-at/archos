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
from ris_adapter.lookup.as_of import in_force_on
from ris_adapter.lookup.as_of import parse_day

OLD_URL = "https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR40000001/NOR40000001.html"
NEW_URL = "https://www.ris.bka.gv.at/Dokumente/Bundesnormen/NOR40000002/NOR40000002.html"
WHOLE_LAW = "https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10000001"


def _version(url: str, since: str, until: str = "") -> RisHit:
    metadata = {"In Kraft seit": since, "Bundesland": ""}
    if until:
        metadata["In Kraft bis"] = until
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
    """Two versions of one §: 2015-01-01 through 2020-12-31, and from 2021-01-01."""
    lookup.client.search_result = RisSearchResult(
        hits=[_version(NEW_URL, "2021-01-01"), _version(OLD_URL, "2015-01-01", "2020-12-31")]
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
async def test_a_malformed_day_is_an_error(lookup, monkeypatch):

    output = await lookup.run(question="Was sagt § 3?", as_of="01.06.2019")

    assert output.startswith("Error: as_of must be a calendar day")


def test_the_version_window_holds_its_last_day_and_excludes_unknown_dates():
    # RIS's Ausserkrafttretensdatum is the last day in force: 31.12.2020 is in force, 01.01.2021 is not.
    window = {"In Kraft seit": "01.01.2015", "In Kraft bis": "2020-12-31"}
    assert [
        in_force_on(window, date(*day)) for day in ((2014, 12, 31), (2015, 1, 1), (2020, 12, 31), (2021, 1, 1))
    ] == [
        False,
        True,
        True,
        False,
    ]
    assert in_force_on({}, date(2020, 1, 1)) is False
    assert in_force_on({"In Kraft seit": "2015-01-01", "In Kraft bis": "bald"}, date(2020, 1, 1)) is False
    assert parse_day("2023-02-30") is None


def test_the_lookup_span_records_the_day_asked_for_and_the_versions_left_unread():
    from ris_adapter.lookup.address import parse_address
    from ris_adapter.lookup.telemetry import _span_context
    from ris_adapter.lookup.trace import LookupTrace

    trace = LookupTrace(as_of="2019-06-01", versions_dropped=2)
    context = _span_context("Was sagt § 3?", parse_address("Was sagt § 3?", "", ""), trace, [])

    assert context["as_of"] == "2019-06-01" and context["versions_dropped"] == 2
    assert "as_of" not in _span_context("Was sagt § 3?", parse_address("Was sagt § 3?", "", ""), LookupTrace(), [])


def test_a_date_with_trailing_text_is_no_date_but_a_timestamp_is_its_day():
    assert parse_day("2015-01-01 (provisional)") is None
    assert parse_day("2015-01-01garbage") is None
    assert parse_day("2015-01-01T00:00:00") == date(2015, 1, 1)
    assert parse_day("2015-01-01T00:00:00+01:00") == date(2015, 1, 1)
    assert in_force_on({"In Kraft seit": "2015-01-01 (provisional)"}, date(2020, 1, 1)) is False


async def _tool():
    """The registered tool as the chat model is handed it: the agent runtime's LangChain wrapper."""
    from unittest.mock import MagicMock

    from ris_adapter.lookup import RisLookupToolConfig
    from ris_adapter.lookup import ris_lookup
    from ris_adapter_testing.lookup import _LookupProbeConfig

    from nat.builder.function import LambdaFunction  # noqa: TID251
    from nat.plugins.langchain.tool_wrapper import langchain_tool_wrapper

    async with ris_lookup(RisLookupToolConfig(), MagicMock()) as info:
        fn = LambdaFunction.from_info(config=_LookupProbeConfig(), info=info)
        yield langchain_tool_wrapper("ris_lookup_tool", fn, MagicMock())


def _offered(tool) -> tuple[str, set[str]]:
    from langchain_core.utils.function_calling import convert_to_openai_tool

    function = convert_to_openai_tool(tool)["function"]
    return function["description"], set(function["parameters"]["properties"])


@pytest.mark.asyncio
async def test_every_turn_is_offered_as_of_and_it_reaches_the_tool(versions):
    """ADR-0175: the ``time-editions`` switch is gone; the registered tool shows ``as_of`` and answers it."""
    from ris_adapter.lookup.tool import RIS_LOOKUP_DESCRIPTION

    async for tool in _tool():
        description, arguments = _offered(tool)
        output = await tool.ainvoke({"question": "Was sagt § 3?", "as_of": "2019-06-01"})

    assert arguments == {"question", "conclusion", "jurisdiction", "instrument", "application", "as_of"}
    assert description == RIS_LOOKUP_DESCRIPTION and "as_of (str)" in description
    assert "alte Fassung" in output and "neue Fassung" not in output


def test_no_switch_decides_the_offer_any_more():
    """The process override and the flag read went with the switch (ADR-0175)."""
    from ris_adapter.lookup import as_of

    for retired in ("ENV_OVERRIDE", "as_of_offered", "as_of_allowed", "AS_OF_REFUSED"):
        assert not hasattr(as_of, retired), retired
