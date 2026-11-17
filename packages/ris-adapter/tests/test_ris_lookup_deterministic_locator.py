from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


async def test_a_named_paragraph_makes_no_picker_call(lookup, catalog, monkeypatch):
    from ris_adapter_testing.lookup import FakePicker  # noqa: PLC0415 — the doubles live beside the fixtures

    picker = FakePicker("§ 75")
    lookup.with_llms(monkeypatch, picker=picker)

    output = await lookup.run(question="Was verlangt § 63 BO Wien?", instrument="BO Wien")

    assert picker.calls == [], "the § was named; nothing should have asked a model which § to read"
    assert "Punkt: § 63" in output
    assert "Dem Ansuchen um Baubewilligung" in output


async def test_a_named_paragraph_makes_no_planner_call_either(lookup, catalog, monkeypatch):
    from ris_adapter_testing.lookup import FakePlanner

    planner = FakePlanner()
    lookup.with_llms(monkeypatch, planner=planner)

    await lookup.run(question="Was verlangt § 63 BO Wien?", instrument="BO Wien")

    assert planner.calls == []
    assert lookup.client.search_calls == []


async def test_the_paragraph_comes_back_with_its_absaetze(lookup, catalog):
    output = await lookup.run(question="Was verlangt § 63 BO Wien?", instrument="BO Wien")

    body = lookup.body_of(output)
    assert "(1) Dem Ansuchen" in body
    assert "(2) Die Baupläne" in body
    assert "(3) Die Behörde" in body
    assert "Bauverhandlung anzuberaumen" not in body


async def test_only_the_named_paragraph_comes_back(lookup, catalog):
    output = await lookup.run(question="Wie hoch darf das Gebäude sein? § 75", instrument="BO Wien")

    assert output.count("--- Result ") == 1
    assert "Punkt: § 75" in output
    assert "Bauklasse" in output


async def test_a_pasted_ris_url_is_an_address_and_needs_no_search(lookup, monkeypatch):
    from ris_adapter_testing.lookup import FakePlanner

    planner = FakePlanner()
    lookup.with_llms(monkeypatch, planner=planner)

    output = await lookup.run(question="Was verlangt § 63?", instrument=lookup.WIEN_URL)

    assert planner.calls == []
    assert lookup.client.search_calls == []
    assert lookup.client.fetch_calls == [lookup.WIEN_URL]
    assert "Punkt: § 63" in output


async def test_a_list_of_paragraphs_comes_back_whole_in_one_call(lookup, catalog, monkeypatch):
    from ris_adapter_testing.lookup import FakePicker

    picker = FakePicker("§ 75")
    lookup.with_llms(monkeypatch, picker=picker)

    output = await lookup.run(question="Was verlangen die §§ 63 und 64?", instrument="§§ 63 und 64 BO Wien")

    assert picker.calls == []
    assert "Punkt: § 63" in output and "Punkt: § 64" in output
    assert "Bauverhandlung anzuberaumen" in output


async def test_a_subsection_the_paragraph_lacks_comes_back_once(lookup, catalog):
    output = await lookup.run(question="Was verlangt § 63 Abs 9 BO Wien?", instrument="§ 63 Abs 9 BO Wien")

    assert output.count("--- Result ") == 1
    assert "Punkt: § 63" in output


async def test_a_list_past_the_budget_says_what_it_did_not_read(lookup, catalog):
    output = await lookup.run(question="Was regeln die §§ 63 bis 75?", instrument="§§ 63 bis 75 BO Wien")

    assert "not read: § 69 bis § 75" in output
    assert "Punkt: § 63" in output
