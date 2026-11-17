from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio

_QUESTION = "Welche Stellplatzverpflichtung gilt für einen Neubau?"


def _two_states(catalog):
    from ris_adapter_testing.lookup import LookupHarness
    from ris_adapter_testing.lookup import norm_entry

    return catalog(
        norm_entry(),
        norm_entry(
            id="bo-tirol",
            title="Tiroler Bauordnung 2022",
            short="TBO 2022",
            document_number="NOR40200002",
            citation_url="https://www.ris.bka.gv.at/eli/lgbl/TI/2022/1",
            full_law_url=LookupHarness.TIROL_URL,
            federal_state="Tirol",
            topics=["bauordnung", "stellplatz"],
        ),
    )


async def test_a_tyrolean_question_never_reads_viennese_law(lookup, catalog):
    _two_states(catalog)

    output = await lookup.run(question=_QUESTION, instrument="§ 60 Bauordnung", jurisdiction="Tirol")

    assert lookup.client.fetch_calls == [lookup.TIROL_URL]
    assert "Tiroler Bauordnung 2022" in output
    assert "Bauordnung für Wien" not in output


async def test_the_assumed_land_and_its_provenance_are_in_the_output(lookup, catalog):
    _two_states(catalog)

    output = await lookup.run(question=_QUESTION, instrument="§ 60 Bauordnung", jurisdiction="Tirol")

    assert "Assumed Bundesland: Tirol (from jurisdiction argument)." in output


async def test_the_land_travels_into_the_collection_line(lookup, catalog):
    _two_states(catalog)

    output = await lookup.run(question=_QUESTION, instrument="§ 60 Bauordnung", jurisdiction="Tirol")

    assert "Collection: ris/LrKons/Tirol" in output


async def test_the_land_read_off_the_question_is_labelled_as_such(lookup, catalog):
    _two_states(catalog)

    output = await lookup.run(question="Welche Stellplätze verlangt Tirol? § 60", instrument="Bauordnung")

    assert "Assumed Bundesland: Tirol (from the question)." in output
    assert lookup.client.fetch_calls == [lookup.TIROL_URL]


async def test_the_caller_land_outranks_the_planner_in_a_live_search(lookup, monkeypatch):
    from ris_adapter_testing.lookup import FakePlanner

    planner = FakePlanner(application="LrKons", suchworte="Stellplatzverpflichtung", federal_state="")
    lookup.with_llms(monkeypatch, planner=planner)

    await lookup.run(question=_QUESTION, jurisdiction="Tirol")

    assert lookup.client.search_calls[0]["params"]["Bundesland.SucheInTirol"] == "true"
