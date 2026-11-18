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
    from agent.knowledge.law_lookup import as_of

    for retired in ("ENV_OVERRIDE", "as_of_offered", "as_of_allowed", "AS_OF_REFUSED"):
        assert not hasattr(as_of, retired), retired


@pytest.mark.asyncio
async def test_today_reads_the_consolidated_law_and_dates_it_with_no_hits_version():
    portal = _versions()
    portal.set_text(xa.CODE_URL, "Act (fixture)", "§ 3. (1) Today's version applies.")
    output = await _ask(portal, **_ARGS)

    assert "Today's version applies" in output

    assert set(portal.documents_requested) == {xa.CODE_URL}
    assert "Fassung 2015-01-01" not in output and "Fassung 2021-01-01" not in output


@pytest.mark.asyncio
async def test_a_hit_read_from_its_own_version_document_keeps_its_date():
    portal = xa.Portal.with_codes()
    portal.search = xa.search_answer(xa.hit("XAN40000001", "Act (fixture) § 3", url=OLD_URL, since="2015-01-01"))
    portal.set_text(OLD_URL, "Act (fixture)", "§ 3. (1) The old version applies.")
    output = await _ask(portal, **_ARGS)

    assert portal.documents_requested == [OLD_URL]
    assert "Fassung 2015-01-01" in output


TODAY = date(2026, 11, 12)
REGIONAL = "Southmark Building Code"
_REGIONAL_ARGS = {
    "question": "How many parking spaces does a new building need?",
    "instrument": f"§ 60 {REGIONAL}",
    "jurisdiction": "Southmark",
}
OLD_60 = f"https://{xa.DOCS}/documents/regional/XAR60-2015.html"
NEW_60 = f"https://{xa.DOCS}/documents/regional/XAR60-2021.html"
OLD_61 = f"https://{xa.DOCS}/documents/regional/XAR61-2015.html"


def _regional_versions(*hits) -> xa.Portal:
    portal = xa.Portal.with_codes()

    def answer(params: dict[str, str]) -> dict[str, str]:
        by_title = params.get("title") == REGIONAL and "q" not in params
        return xa.search_answer(*hits) if by_title else xa.search_answer()

    portal.answer = answer
    portal.set_text(OLD_60, REGIONAL, "§ 60. (1) One parking space per flat (2015).")
    portal.set_text(NEW_60, REGIONAL, "§ 60. (1) One parking space per two flats (2021).")
    portal.set_text(OLD_61, REGIONAL, "§ 61. (1) Bicycle stands (2015).")
    return portal


def _regional_hit(url: str, provision: str, since: str, until: str = "") -> dict:
    number = url.rsplit("/", 1)[1].removesuffix(".html")
    return xa.hit(
        number,
        REGIONAL,
        collection="Regional",
        url=url,
        region="Southmark",
        provision=provision,
        since=since,
        until=until,
    )


_ALL_VERSIONS = (
    _regional_hit(NEW_60, "§ 60", "2021-01-01"),
    _regional_hit(OLD_61, "§ 61", "2015-01-01", "2020-12-31"),
    _regional_hit(OLD_60, "§ 60", "2015-01-01", "2020-12-31"),
)


def _regional_code() -> object:
    return xa.catalog_entry(
        id="xa-southmark-building-code",
        title=REGIONAL,
        short="SBC",
        application="Regional",
        document_number="XAR00001",
        full_law_url=xa.REGIONAL_CODE_URL,
        federal_state="Southmark",
        topics=["southmark building code", "parking"],
    )


async def _ask_on(portal: xa.Portal, now: date = TODAY, catalog=None, **args) -> str:
    from unittest.mock import patch

    with patch("agent.knowledge.law_lookup.tool.today", lambda: now):
        return await _ask(portal, catalog=catalog, **args)


@pytest.mark.asyncio
async def test_today_as_the_day_reads_the_named_act_as_a_call_without_a_day_does():
    portal = _regional_versions(*_ALL_VERSIONS)
    output = await _ask_on(portal, catalog=[_regional_code()], **_REGIONAL_ARGS, as_of="2026-11-12")

    assert portal.documents_requested == [xa.REGIONAL_CODE_URL]
    assert "Every new building provides parking spaces" in output
    assert output.startswith("as_of 2026-11-12 is today")
    assert "version document of that day" not in output


@pytest.mark.asyncio
async def test_a_later_day_reads_today_and_says_it_is_todays_text():
    portal = _regional_versions(*_ALL_VERSIONS)
    output = await _ask_on(portal, catalog=[_regional_code()], **_REGIONAL_ARGS, as_of="2027-03-01")

    assert portal.documents_requested == [xa.REGIONAL_CODE_URL]
    assert output.startswith("as_of 2027-03-01 is after today (2026-11-12): the text in force today.")


@pytest.mark.asyncio
async def test_a_past_day_finds_the_named_act_by_its_title_and_reads_the_addressed_provision_of_that_day():
    portal = _regional_versions(*_ALL_VERSIONS)
    output = await _ask_on(portal, catalog=[_regional_code()], **_REGIONAL_ARGS, as_of="2019-06-01")

    assert portal.documents_requested == [OLD_60]
    assert "(2015)" in output and "(2021)" not in output and "Bicycle" not in output
    search = portal.searches[0]
    assert search["title"] == REGIONAL and search["section"] == "60" and "q" not in search
    assert search["per_page"] == "100" and search["Region.InSouthmark"] == "true"
    assert len(portal.searches) == 1


@pytest.mark.asyncio
async def test_a_past_day_the_named_act_has_no_version_of_is_still_a_miss():
    portal = _regional_versions(_regional_hit(NEW_60, "§ 60", "2021-01-01"))
    output = await _ask_on(portal, **_REGIONAL_ARGS, as_of="2019-06-01")

    assert portal.documents_requested == []
    assert "Today's text is not given in its place" in output
    assert [search.get("section") for search in portal.searches] == ["60", None, None]
    assert "q" in portal.searches[-1]


def test_only_a_day_before_today_is_a_past_day():
    from agent.knowledge.law_lookup.as_of import reads_today

    assert [reads_today(day, TODAY) for day in ("2026-11-11", "2026-11-12", "2026-11-13")] == [False, True, True]


@pytest.mark.asyncio
async def test_a_past_day_with_the_act_but_no_provision_is_the_planned_search():
    portal = _regional_versions(*_ALL_VERSIONS)
    args = {**_REGIONAL_ARGS, "instrument": REGIONAL}
    output = await _ask_on(portal, **args, as_of="2019-06-01")

    assert len(portal.searches) == 1 and "q" in portal.searches[0]
    assert portal.documents_requested == []
    assert "Today's text is not given in its place" in output


@pytest.mark.asyncio
async def test_a_version_of_the_day_read_without_an_answer_is_not_called_missing():
    portal = _regional_versions(*_ALL_VERSIONS)
    portal.set_text(OLD_60, REGIONAL, "§ 61. (1) Bicycle stands (2015).")
    output = await _ask_on(portal, **_REGIONAL_ARGS, as_of="2019-06-01")

    assert portal.documents_requested == [OLD_60]
    assert "1 Statutes version document(s) of that day were read and none answered" in output
    assert "no Statutes version document of that day was found" not in output


@pytest.mark.asyncio
async def test_the_note_of_a_day_read_as_today_keeps_the_answers_records():
    from agent.common.grounding_block import begin_grounding_capture
    from agent.common.grounding_block import end_grounding_capture
    from agent.common.grounding_block import get_grounding_block

    token = begin_grounding_capture()
    try:
        output = await _ask_on(
            _regional_versions(*_ALL_VERSIONS), catalog=[_regional_code()], **_REGIONAL_ARGS, as_of="2026-11-12"
        )
        block = get_grounding_block(output)
    finally:
        end_grounding_capture(token)

    assert block is not None and block.hits
    assert block.preamble.startswith("as_of 2026-11-12 is today")


@pytest.mark.asyncio
async def test_a_past_days_version_found_and_not_read_is_named():
    portal = _regional_versions(*_ALL_VERSIONS)
    old_62 = f"https://{xa.DOCS}/documents/regional/XAR62-2015.html"
    old_63 = f"https://{xa.DOCS}/documents/regional/XAR63-2015.html"
    portal.answer = lambda params: (
        xa.search_answer(
            *_ALL_VERSIONS,
            _regional_hit(old_62, "§ 62", "2015-01-01", "2020-12-31"),
            _regional_hit(old_63, "§ 63", "2015-01-01", "2020-12-31"),
        )
        if "q" not in params
        else xa.search_answer()
    )
    for url, number in ((old_62, 62), (old_63, 63)):
        portal.set_text(url, REGIONAL, f"§ {number}. (1) Provision {number} (2015).")
    args = {**_REGIONAL_ARGS, "instrument": f"§§ 61, 62 and 63 {REGIONAL}"}
    output = await _ask_on(portal, **args, as_of="2019-06-01")

    assert len(portal.documents_requested) == 2
    assert "Versions of 2019-06-01 found and not read in this call: § 63." in output
