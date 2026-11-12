"""The lookup's own bounds, asserted where they are enforced: through the tool, not off a constant.

Each is what one charged call may cost: three candidates, two fetches, six
passages across two documents. A bound that is only a constant drifts, so each
is measured on what the network was asked and what the model got back. Ported
from the RIS tool's suite (``test_ris_lookup_bounds``) onto XA's statute portal.
"""

from __future__ import annotations

import pytest
from agent_testing import law_lookup_portal as xa

from agent.knowledge.law_lookup.candidates import MAX_CANDIDATES
from agent.knowledge.law_lookup.extract import MAX_DOCUMENTS
from agent.knowledge.law_lookup.extract import MAX_PASSAGES
from agent.knowledge.law_lookup.fetch import MAX_FETCHES

pytestmark = pytest.mark.asyncio


def _part_url(index: int) -> str:
    return f"https://{xa.DOCS}/consolidated/part-{index}"


def _parts(portal: xa.Portal, count: int, *, fetchable: bool = True) -> list:
    """``count`` catalog entries on one topic, each its own document holding the building code."""
    entries = []
    for index in range(count):
        portal.set_text(_part_url(index), f"Building Code Part {index}", xa.BUILDING_CODE)
        entries.append(
            xa.catalog_entry(
                id=f"part-{index}",
                title=f"Building Code Part {index}",
                short=f"BC {index}",
                document_number=f"XAN{index:05d}" if fetchable else "",
                application="National" if fetchable else "",
                full_law_url=_part_url(index) if fetchable else "",
            )
        )
    return entries


async def test_a_twelve_entry_catalog_match_reads_two_documents():
    portal = xa.Portal()
    async with xa.session(portal, catalog=_parts(portal, 12)) as lookup:
        await lookup.call(question="What does the building code require? § 63")

    assert MAX_FETCHES == 2
    assert len(portal.documents_requested) == MAX_FETCHES


async def test_at_most_three_candidates_are_considered():
    """The miss names what it did not read, and it names three of the twelve the catalog matched."""
    portal = xa.Portal()
    entries = _parts(portal, 12, fetchable=False)
    async with xa.session(portal, catalog=entries, picker_call=xa.picker()) as lookup:
        output = await lookup.call(question="What does the building code say about stamp duty?")

    named = [line for line in output.splitlines() if line.startswith("  - ")]
    assert MAX_CANDIDATES == 3
    assert len(named) == MAX_CANDIDATES


async def test_a_live_search_of_twenty_hits_fetches_two():
    portal = xa.Portal()
    portal.search = xa.search_answer(*(xa.hit(f"XAN{index:05d}", f"Act {index}") for index in range(20)))
    async with xa.session(portal, planner_call=xa.planner()) as lookup:
        await lookup.call(question="What does § 63 require?")

    # Three candidates, two fetch attempts: never twenty of either.
    assert len(portal.documents_requested) == 2 == MAX_FETCHES


async def test_at_most_six_passages_come_back():
    portal = xa.Portal()
    portal.set_text(
        xa.CODE_URL,
        "Building Code",
        "\n".join(f"Title {n}\n§ {n}. (1) The content of section {n}." for n in range(1, 30)),
    )
    picker = xa.picker(*(f"§ {n}" for n in range(1, 30)))
    async with xa.session(portal, catalog=[xa.catalog_entry()], picker_call=picker) as lookup:
        output = await lookup.call(question="What does the building code regulate?")

    assert MAX_PASSAGES == 6
    assert output.count("--- Result ") == MAX_PASSAGES


async def test_passages_come_from_at_most_two_documents():
    portal = xa.Portal()
    picker = xa.picker("§ 63", "§ 64", "§ 75")
    async with xa.session(portal, catalog=_parts(portal, 6), picker_call=picker) as lookup:
        output = await lookup.call(question="What does the building code regulate?")

    laws = {line for line in output.splitlines() if line.startswith("Source: ")}
    assert MAX_DOCUMENTS == 2
    assert len(laws) == MAX_DOCUMENTS


async def test_a_nine_hundred_kilobyte_law_does_not_reach_the_transcript():
    """The bound that protects the turn: the whole law is read, and the model sees one provision."""
    huge = "\n".join(f"Title {n}\n§ {n}. (1) " + "Word " * 400 for n in range(1, 460))
    assert len(huge) > 900_000
    portal = xa.Portal()
    portal.set_text(xa.CODE_URL, "Building Code", huge)
    async with xa.session(portal, catalog=[xa.catalog_entry()]) as lookup:
        output = await lookup.call(question="What does § 63 Building Code require?", instrument="Building Code")

    assert len(output) < 10_000
    assert "Punkt: § 63" in output
