from __future__ import annotations

import pytest
from agent_testing import law_lookup_portal as xa

pytestmark = pytest.mark.asyncio

_QUESTION = "Which parking obligation applies to a new building?"


def _two_provinces() -> list:
    return [
        xa.catalog_entry(id="northmark-code", application="Regional", federal_state="Northmark"),
        xa.catalog_entry(
            id="southmark-code",
            title="Southmark Building Code",
            short="SBC",
            application="Regional",
            document_number="XAN00002",
            citation_url=f"https://{xa.DOCS}/eli/southmark-building-code",
            full_law_url=xa.REGIONAL_CODE_URL,
            federal_state="Southmark",
            topics=["building code", "parking"],
        ),
    ]


async def _ask(**args):
    portal = xa.Portal.with_codes()
    async with xa.session(portal, catalog=_two_provinces()) as lookup:
        return await lookup.call(**args), portal


async def test_a_southmark_question_never_reads_northmark_law():
    output, portal = await _ask(question=_QUESTION, instrument="§ 60 Building Code", jurisdiction="Southmark")

    assert portal.documents_requested == [xa.REGIONAL_CODE_URL]
    assert "Source: Southmark Building Code" in output
    assert "Source: Building Code\n" not in output


async def test_the_assumed_province_and_its_provenance_are_in_the_output():
    output, _ = await _ask(question=_QUESTION, instrument="§ 60 Building Code", jurisdiction="Southmark")

    assert "Assumed province: Southmark (from jurisdiction argument)." in output


async def test_the_province_travels_into_the_collection_line():
    output, _ = await _ask(question=_QUESTION, instrument="§ 60 Building Code", jurisdiction="Southmark")

    assert "Collection: xa/Regional/Southmark" in output


async def test_the_province_read_off_the_question_is_labelled_as_such():
    output, portal = await _ask(question="Which parking does Southmark require? § 60", instrument="Building Code")

    assert "Assumed province: Southmark (from the question)." in output
    assert portal.documents_requested == [xa.REGIONAL_CODE_URL]


async def test_the_caller_province_outranks_the_planner_in_a_live_search():
    portal = xa.Portal.with_codes()
    planner = xa.planner(collection="Regional", terms="parking obligation", territory="")
    async with xa.session(portal, planner_call=planner) as lookup:
        await lookup.call(question=_QUESTION, jurisdiction="Southmark")

    assert portal.searches[0]["Region.InSouthmark"] == "true"
