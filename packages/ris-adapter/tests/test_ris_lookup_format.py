from __future__ import annotations

import json

import pytest

from agent.citations.extraction import extract_sources_from_tool_result

pytestmark = pytest.mark.asyncio

_QUESTION = "Welche Unterlagen sind dem Bauansuchen anzuschließen?"


async def test_the_block_carries_every_field_the_grounding_grammar_needs(lookup, catalog):
    output = await lookup.run(question=_QUESTION, instrument="§ 63 Abs 1 BO Wien")

    assert "--- Result 1 ---" in output
    assert "Source: Bauordnung für Wien" in output
    assert "Source URL:" not in output and lookup.WIEN_URL not in output
    assert "Shelf: base" in output
    assert "Dokumentart: law — Gesetz / Bauordnung" in output
    assert "Punkt: § 63 Abs 1" in output
    assert "Citation: Bauordnung für Wien, § 63 Abs 1" in output
    assert "Content Type: text" in output
    assert "Relevance Score: 1.00" in output
    assert "Dem Ansuchen um Baubewilligung sind anzuschließen" in output
    assert "## Trace-Lanes" in output


async def test_the_knowledge_parser_reads_it_as_evidence(lookup, catalog):
    output = await lookup.run(question=_QUESTION, instrument="§ 63 Abs 1 BO Wien")

    entries = extract_sources_from_tool_result("ris_lookup", output)

    assert [e.citation_key for e in entries] == ["Bauordnung für Wien, § 63 Abs 1", "Bauordnung für Wien, § 63"]
    entry = entries[0]
    assert entry.citation_key == "Bauordnung für Wien, § 63 Abs 1"
    assert entry.clause == "§ 63 Abs 1"
    assert entry.doc_class == "law"
    assert entry.source_type == "knowledge_layer"
    assert entry.shelf == "base"
    assert "Dem Ansuchen um Baubewilligung" in (entry.chunk_text or "")


async def test_only_the_named_subsection_is_returned(lookup, catalog):
    output = await lookup.run(question=_QUESTION, instrument="§ 63 Abs 1 BO Wien")

    body = lookup.body_of(output)
    assert "Dem Ansuchen um Baubewilligung" in body
    assert "Die Baupläne müssen von einem hierzu Befugten" not in body


async def test_the_lane_is_the_legal_source_lane_not_unknown(lookup, catalog):
    output = await lookup.run(question=_QUESTION, instrument="§ 63 BO Wien")

    lanes = json.loads(output.split("## Trace-Lanes\n", 1)[1].strip())

    assert [lane["key"] for lane in lanes["lanes"]] == ["building_law_ris"]
    assert lanes["lanes"][0]["kind"] == "building_law"


async def test_a_named_section_arrives_whole(lookup, catalog):
    absaetze = "\n".join(f"({index}) " + "Text " * 100 for index in range(1, 12))
    lookup.set_text(lookup.WIEN_URL, f"Bauansuchen\n§ 63. {absaetze}\n(12) Letzter Absatz.")

    output = await lookup.run(question="Was verlangt § 63 BO Wien?", instrument="§ 63 BO Wien")

    assert "(12) Letzter Absatz." in lookup.body_of(output)
    assert "... [truncated]" not in output


async def test_a_named_section_is_still_bounded(lookup, catalog):
    from ris_adapter.lookup.grammar import SECTION_MAX_CHARS

    long_subsection = "\n".join(f"({index}) " + "Text " * 200 for index in range(1, 12))
    lookup.set_text(lookup.WIEN_URL, f"Bauansuchen\n§ 63. {long_subsection}")

    output = await lookup.run(question="Was verlangt § 63 BO Wien?", instrument="BO Wien")

    body = lookup.body_of(output)
    assert len(body) <= SECTION_MAX_CHARS
    assert "... [truncated]" in output


async def test_a_named_subsection_comes_with_its_whole_section(lookup, catalog):
    output = await lookup.run(question=_QUESTION, instrument="§ 63 Abs 1 BO Wien")

    assert "Die Baupläne müssen von einem hierzu Befugten" not in lookup.body_of(output, 1)
    assert "Die Baupläne müssen von einem hierzu Befugten" in lookup.body_of(output, 2)


async def test_a_section_too_long_to_hand_over_stays_its_subsection(lookup, catalog):
    from ris_adapter.lookup.grammar import SECTION_MAX_CHARS

    absaetze = "\n".join(f"({index}) " + "Text " * 300 for index in range(1, 12))
    assert len(absaetze) > SECTION_MAX_CHARS
    lookup.set_text(lookup.WIEN_URL, f"Bauansuchen\n§ 63. {absaetze}")

    output = await lookup.run(question=_QUESTION, instrument="§ 63 Abs 2 BO Wien")

    assert output.count("--- Result ") == 1
