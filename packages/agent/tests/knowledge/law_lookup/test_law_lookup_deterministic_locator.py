from __future__ import annotations

import pytest
from agent_testing import law_lookup_portal as xa

pytestmark = pytest.mark.asyncio

_QUESTION = "What does § 63 Building Code require?"


async def _ask(portal=None, catalog=True, **kwargs):
    portal = portal or xa.Portal.with_codes()
    planner, picker = xa.planner(), xa.picker("§ 75")
    entries = [xa.catalog_entry()] if catalog else None
    async with xa.session(portal, catalog=entries, planner_call=planner, picker_call=picker) as lookup:
        output = await lookup.call(**kwargs)
    return output, portal, planner, picker


async def test_a_named_provision_makes_no_picker_call():
    output, _portal, _planner, picker = await _ask(question=_QUESTION, instrument="Building Code")

    assert picker.calls == [], "the provision was named; nothing should have asked a model which to read"
    assert "Punkt: § 63" in output
    assert "A permit application carries" in output


async def test_a_named_provision_makes_no_planner_call_either():
    _output, portal, planner, _picker = await _ask(question=_QUESTION, instrument="Building Code")

    assert planner.calls == []
    assert portal.searches == []


async def test_the_provision_comes_back_with_its_parts():
    output, *_ = await _ask(question=_QUESTION, instrument="Building Code")

    body = xa.body_of(output)
    assert "(1) A permit application" in body
    assert "(2) The drawings are signed" in body
    assert "(3) The authority may ask" in body
    assert "A hearing is held" not in body


async def test_only_the_named_provision_comes_back():
    output, *_ = await _ask(question="How high may the building be? § 75", instrument="Building Code")

    assert output.count("--- Result ") == 1
    assert "Punkt: § 75" in output
    assert "building class" in output


async def test_a_pasted_source_url_is_an_address_and_needs_no_search():
    output, portal, planner, _picker = await _ask(catalog=False, question="What does § 63 say?", instrument=xa.CODE_URL)

    assert planner.calls == []
    assert portal.searches == []
    assert portal.documents_requested == [xa.CODE_URL]
    assert "Punkt: § 63" in output


async def test_a_list_of_provisions_comes_back_whole_in_one_call():
    output, _portal, _planner, picker = await _ask(
        question="What do §§ 63 and 64 require?", instrument="§§ 63 and 64 Building Code"
    )

    assert picker.calls == []
    assert "Punkt: § 63" in output and "Punkt: § 64" in output
    assert "A hearing is held" in output


async def test_a_part_the_provision_lacks_comes_back_once():
    output, *_ = await _ask(question="What does § 63 para 9 require?", instrument="§ 63 para 9 Building Code")

    assert output.count("--- Result ") == 1
    assert "Punkt: § 63" in output


async def test_a_list_past_the_budget_says_what_it_did_not_read():
    output, *_ = await _ask(question="What do §§ 63 to 75 regulate?", instrument="§§ 63 to 75 Building Code")

    assert "not read: § 69 to § 75" in output
    assert "Punkt: § 63" in output
