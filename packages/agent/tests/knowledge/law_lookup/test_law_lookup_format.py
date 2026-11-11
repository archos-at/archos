"""The return format IS the contract: a law lookup's output must parse as evidence.

The SAME reader the knowledge layer's hits go through reads the block, and what
comes out carries a citation key, a Punkt and ``doc_class="law"``, both off the
records the renderer filed and, on a replayed turn, off the text alone. Ported
from the RIS tool's suite (``test_ris_lookup_format``) onto XA's statute portal.
"""

from __future__ import annotations

import json

import pytest
from agent_testing import law_lookup_portal as xa

from agent.citations.extraction import extract_sources_from_tool_result
from agent.knowledge.law_lookup.sections import SECTION_MAX_CHARS

pytestmark = pytest.mark.asyncio

_QUESTION = "Which documents does a permit application carry?"
_NAMED = "What does § 63 Building Code require?"
_SECOND_PART = "The drawings are signed by a licensed architect"


async def _ask(text: str | None = None, instrument: str = "§ 63 para 1 Building Code", question: str = _QUESTION):
    portal = xa.Portal.with_codes()
    if text is not None:
        portal.set_text(xa.CODE_URL, "Building Code", text)
    async with xa.session(portal, catalog=[xa.catalog_entry()]) as lookup:
        return await lookup.call(question=question, instrument=instrument)


async def test_the_block_carries_every_field_the_grounding_grammar_needs():
    output = await _ask()

    assert "--- Result 1 ---" in output
    assert "Source: Building Code" in output
    # The whole law's URL is not a citation, and printed it was copied as one.
    assert "Source URL:" not in output and xa.CODE_URL not in output
    assert "Collection: xa/National" in output
    assert "Shelf: base" in output
    assert "Dokumentart: law — " in output
    assert "Punkt: § 63 para 1" in output
    # The record's note for a consolidated text, on its own header line.
    assert "Consolidated text, not the authentic promulgation." in output
    assert "Citation: Building Code, § 63 para 1" in output
    assert "Content Type: text" in output
    assert "Relevance Score: 1.00" in output
    assert "A permit application carries" in output
    assert "## Trace-Lanes" in output


async def test_the_knowledge_parser_reads_it_as_evidence():
    """The records the renderer filed, read back: the named part, then the whole provision under its own key."""
    output = await _ask()

    entries = extract_sources_from_tool_result("law_lookup", output)

    assert [e.citation_key for e in entries] == ["Building Code, § 63 para 1", "Building Code, § 63"]
    entry = entries[0]
    assert entry.clause == "§ 63 para 1"
    assert entry.doc_class == "law"
    assert entry.source_type == "knowledge_layer"
    assert entry.shelf == "base"
    assert "A permit application carries" in (entry.chunk_text or "")


async def test_a_replayed_turn_reads_the_same_sources_off_the_text():
    """A turn replayed from storage holds the text without the records: the text parser must read it too.

    Under its own name (``law_lookup``, the binding's default and the name step 4b renames the model tool
    to), not only under ``ris_lookup``, which the parser registry knew first.
    """
    from agent.citations.text_parsers import parser_for
    from agent.common.grounding_block import begin_grounding_capture
    from agent.common.grounding_block import end_grounding_capture

    token = begin_grounding_capture()
    try:  # the live turn: the records the renderer filed under these bytes
        output = await _ask()
        live = extract_sources_from_tool_result("law_lookup", output)
    finally:
        end_grounding_capture(token)
    assert [e.citation_key for e in live] == ["Building Code, § 63 para 1", "Building Code, § 63"]

    parser = parser_for("law_lookup")
    assert parser is not None, "a law_lookup result has no text parser: a replayed turn loses its citations"
    replayed = parser(output, "law_lookup")
    assert [(e.citation_key, e.clause, e.doc_class) for e in replayed] == [
        (e.citation_key, e.clause, e.doc_class) for e in live
    ]


async def test_only_the_named_part_is_returned():
    """``para 1`` means part 1: the parts after it stay out of the passage."""
    body = xa.body_of(await _ask())

    assert "A permit application carries" in body
    assert _SECOND_PART not in body


async def test_the_lane_is_the_legal_source_lane_not_unknown():
    """``doc_class`` is what the lane fan-out reads first, so the chip is law, not Web."""
    output = await _ask(instrument="§ 63 Building Code")

    lanes = json.loads(output.split("## Trace-Lanes\n", 1)[1].strip())

    assert len(lanes["lanes"]) == 1
    assert lanes["lanes"][0]["kind"] == "building_law"


async def test_a_named_provision_arrives_whole():
    """Cut at the chunk bound, a named provision cost three lookups in the answer suite."""
    parts = "\n".join(f"({index}) " + "Text " * 100 for index in range(1, 12))
    output = await _ask(f"Permit application\n§ 63. {parts}\n(12) Last part.", instrument="§ 63 Building Code")

    assert "(12) Last part." in xa.body_of(output)
    assert "... [truncated]" not in output


async def test_a_named_provision_is_still_bounded():
    """Longer than the provision bound, it is cut on a part and says so."""
    long_parts = "\n".join(f"({index}) " + "Text " * 200 for index in range(1, 12))
    output = await _ask(f"Permit application\n§ 63. {long_parts}", instrument="Building Code", question=_NAMED)

    assert len(xa.body_of(output)) <= SECTION_MAX_CHARS
    # The producer's own truncation marker, which the parser strips back off.
    assert "... [truncated]" in output


async def test_a_named_part_comes_with_its_whole_provision():
    """Asked for part 2 alone, the agent came back for parts 4, 5 and 3 one lookup at a time."""
    output = await _ask()

    assert _SECOND_PART not in xa.body_of(output, 1)
    assert _SECOND_PART in xa.body_of(output, 2)


async def test_a_provision_too_long_to_hand_over_stays_its_part():
    parts = "\n".join(f"({index}) " + "Text " * 300 for index in range(1, 12))
    assert len(parts) > SECTION_MAX_CHARS

    output = await _ask(f"Permit application\n§ 63. {parts}", instrument="§ 63 para 2 Building Code")

    assert output.count("--- Result ") == 1
