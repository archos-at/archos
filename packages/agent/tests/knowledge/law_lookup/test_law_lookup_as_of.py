"""A lookup on a past day (``as_of``, ADR-0171): the version of that day or a miss, never today's text.

Each case runs the real tool through the agent runtime against XA's portal,
whose search states each version document's in-force window: the search, the
version window, the fetch and the miss are the lookup's own. Ported from the
RIS tool's suite (``test_ris_lookup_as_of``).
"""

from __future__ import annotations

from datetime import date

import pytest
from agent_testing import law_lookup_portal as xa

from agent.knowledge.law_lookup.as_of import in_force_on
from agent.knowledge.law_lookup.as_of import parse_day

OLD_URL = f"https://{xa.DOCS}/documents/national/XAN40000001.html"
NEW_URL = f"https://{xa.DOCS}/documents/national/XAN40000002.html"
_ARGS = {"question": "What does § 3 say?", "instrument": "§ 3", "application": "National"}


def _versions() -> xa.Portal:
    """Two versions of one provision, 2015-01-01 through 2020-12-31 and from 2021-01-01, beside today's law."""
    portal = xa.Portal.with_codes()
    portal.search = xa.search_answer(
        xa.hit("XAN40000002", "Act (fixture) § 3", url=NEW_URL, whole_law=xa.CODE_URL, since="2021-01-01"),
        xa.hit(
            "XAN40000001",
            "Act (fixture) § 3",
            url=OLD_URL,
            whole_law=xa.CODE_URL,
            since="2015-01-01",
            until="2020-12-31",
        ),
    )
    portal.set_text(OLD_URL, "Act (fixture)", "§ 3. (1) The old version applies.")
    portal.set_text(NEW_URL, "Act (fixture)", "§ 3. (1) The new version applies.")
    return portal


async def _ask(portal: xa.Portal, catalog=None, **args) -> str:
    async with xa.session(portal, catalog=catalog) as lookup:
        return await lookup.call(**args)


@pytest.mark.asyncio
async def test_reads_only_the_version_in_force_on_the_day():
    portal = _versions()
    output = await _ask(portal, catalog=[xa.catalog_entry()], **_ARGS, as_of="2019-06-01")

    assert portal.documents_requested == [OLD_URL]
    assert "old version" in output and "new version" not in output
    # The search asked the source for that day, by the record's date parameter for the collection.
    assert portal.searches[0].get("Version.On") == "2019-06-01"


@pytest.mark.asyncio
async def test_positive_control_today_reads_the_current_version():
    portal = _versions()
    output = await _ask(portal, **_ARGS, as_of="2026-11-10")

    assert portal.documents_requested == [NEW_URL]
    assert "new version" in output


@pytest.mark.asyncio
async def test_no_version_of_the_day_is_a_miss_that_does_not_substitute_today():
    portal = _versions()
    output = await _ask(portal, **_ARGS, as_of="2010-01-01")

    assert portal.documents_requested == []
    assert "no Statutes version document of that day was found" in output
    assert "Today's text is not given in its place" in output


@pytest.mark.asyncio
async def test_a_past_day_never_reads_the_catalog_or_the_whole_law():
    portal = _versions()
    await _ask(
        portal, catalog=[xa.catalog_entry()], question="Permit application § 63 Building Code", as_of="2019-06-01"
    )

    assert all("/consolidated/" not in url for url in portal.documents_requested)
    assert len(portal.searches) == 1


@pytest.mark.asyncio
async def test_a_malformed_day_is_an_error():
    output = await _ask(xa.Portal(), question="What does § 3 say?", as_of="01.06.2019")

    assert output.startswith("Error: as_of must be a calendar day")


def test_the_version_window_holds_its_last_day_and_excludes_unknown_dates():
    engine = xa.xa_law().engine
    since, until = engine.in_force_from, engine.in_force_until
    # The window's last day is in force: 31.12.2020 is, 01.01.2021 is not.
    window = {since: "01.01.2015", until: "2020-12-31"}
    days = ((2014, 12, 31), (2015, 1, 1), (2020, 12, 31), (2021, 1, 1))
    assert [in_force_on(window, date(*day), engine) for day in days] == [False, True, True, False]
    assert in_force_on({}, date(2020, 1, 1), engine) is False
    assert in_force_on({since: "2015-01-01", until: "soon"}, date(2020, 1, 1), engine) is False
    assert parse_day("2023-02-30") is None


def test_the_lookup_span_records_the_day_asked_for_and_the_versions_left_unread():
    from agent.knowledge.law_lookup.address import parse_address
    from agent.knowledge.law_lookup.telemetry import _span_context
    from agent.knowledge.law_lookup.trace import LookupTrace

    law = xa.xa_law()
    address = parse_address("What does § 3 say?", "", "", law)
    context = _span_context("What does § 3 say?", address, LookupTrace(as_of="2019-06-01", versions_dropped=2), [], "t")

    assert context["as_of"] == "2019-06-01" and context["versions_dropped"] == 2
    assert "as_of" not in _span_context("What does § 3 say?", address, LookupTrace(), [], "t")


def test_a_date_with_trailing_text_is_no_date_but_a_timestamp_is_its_day():
    engine = xa.xa_law().engine
    assert parse_day("2015-01-01 (provisional)") is None
    assert parse_day("2015-01-01garbage") is None
    assert parse_day("2015-01-01T00:00:00") == date(2015, 1, 1)
    assert parse_day("2015-01-01T00:00:00+01:00") == date(2015, 1, 1)
    assert in_force_on({engine.in_force_from: "2015-01-01 (provisional)"}, date(2020, 1, 1), engine) is False


def _offered(tool) -> tuple[str, set[str]]:
    from langchain_core.utils.function_calling import convert_to_openai_tool

    function = convert_to_openai_tool(tool)["function"]
    return function["description"], set(function["parameters"]["properties"])


@pytest.mark.asyncio
async def test_every_turn_is_offered_as_of_and_it_reaches_the_tool():
    """ADR-0175: no switch decides it; the tool the chat model is handed shows ``as_of`` and answers it."""
    from agent_testing.law_lookup_parity import _probe_config

    from agent.knowledge.law_lookup.description import describe
    from agent.knowledge.law_lookup.source import law_source
    from nat.builder.function import LambdaFunction  # noqa: TID251
    from nat.plugins.langchain.tool_wrapper import langchain_tool_wrapper

    async with xa.session(_versions()) as lookup:
        fn = LambdaFunction.from_info(config=_probe_config(), info=lookup.info)
        tool = langchain_tool_wrapper("law_lookup", fn, None)
        description, arguments = _offered(tool)
        output = await tool.ainvoke(
            {"question": "What does § 3 say?", "application": "National", "as_of": "2019-06-01"}
        )

    assert arguments == {"question", "conclusion", "jurisdiction", "instrument", "application", "as_of"}
    assert description == describe(law_source(xa.FALLBACK_SOURCE)) and "as_of (str)" in description
    assert "old version" in output and "new version" not in output


def test_no_switch_decides_the_offer_any_more():
    """The process override and the flag read went with the switch (ADR-0175)."""
    from agent.knowledge.law_lookup import as_of

    for retired in ("ENV_OVERRIDE", "as_of_offered", "as_of_allowed", "AS_OF_REFUSED"):
        assert not hasattr(as_of, retired), retired
