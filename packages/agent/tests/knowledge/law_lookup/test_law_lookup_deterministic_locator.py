"""A named provision costs no model call at all.

"What does § 63 Building Code require?" is an ADDRESS, resolved by reading,
not by inference: the catalog knows where the code is (no search planner), the
grammar knows which provision § 63 is (no picker). If a test here ever needs a
picker answer to pass, the lookup started paying a model to find a number it
was handed. Ported from the RIS tool's suite
(``test_ris_lookup_deterministic_locator``) onto XA's statute portal.
"""

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
    """The catalog answers, so no live search is planned and none is run."""
    _output, portal, planner, _picker = await _ask(question=_QUESTION, instrument="Building Code")

    assert planner.calls == []
    assert portal.searches == []


async def test_the_provision_comes_back_with_its_parts():
    output, *_ = await _ask(question=_QUESTION, instrument="Building Code")

    body = xa.body_of(output)
    assert "(1) A permit application" in body
    assert "(2) The drawings are signed" in body
    assert "(3) The authority may ask" in body
    # ...and nothing from the next provision.
    assert "A hearing is held" not in body


async def test_only_the_named_provision_comes_back():
    """One provision asked for, one returned: not the law."""
    output, *_ = await _ask(question="How high may the building be? § 75", instrument="Building Code")

    assert output.count("--- Result ") == 1
    assert "Punkt: § 75" in output
    assert "building class" in output


async def test_a_pasted_source_url_is_an_address_and_needs_no_search():
    """No catalog, no live search: the caller already said which document."""
    output, portal, planner, _picker = await _ask(catalog=False, question="What does § 63 say?", instrument=xa.CODE_URL)

    assert planner.calls == []
    assert portal.searches == []
    assert portal.documents_requested == [xa.CODE_URL]
    assert "Punkt: § 63" in output


async def test_a_list_of_provisions_comes_back_whole_in_one_call():
    """ "§§ 63 and 64": both out of the one document already fetched, no model asked."""
    output, _portal, _planner, picker = await _ask(
        question="What do §§ 63 and 64 require?", instrument="§§ 63 and 64 Building Code"
    )

    assert picker.calls == []
    assert "Punkt: § 63" in output and "Punkt: § 64" in output
    assert "A hearing is held" in output


async def test_a_part_the_provision_lacks_comes_back_once():
    """ "§ 63 para 9" of a provision with three parts is § 63, once, never twice under one key."""
    output, *_ = await _ask(question="What does § 63 para 9 require?", instrument="§ 63 para 9 Building Code")

    assert output.count("--- Result ") == 1
    assert "Punkt: § 63" in output


async def test_a_list_past_the_budget_says_what_it_did_not_read():
    output, *_ = await _ask(question="What do §§ 63 to 75 regulate?", instrument="§§ 63 to 75 Building Code")

    assert "not read: § 69 to § 75" in output
    assert "Punkt: § 63" in output
