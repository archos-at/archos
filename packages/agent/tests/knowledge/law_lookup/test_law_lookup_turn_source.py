"""A lookup reads the source the turn carries; without one it reads its fallback and says what it could not read."""

from __future__ import annotations

import logging

import pytest
from agent_testing.law_lookup_parity import CASES
from agent_testing.law_lookup_parity import Upstream
from agent_testing.law_lookup_parity import released_record
from agent_testing.law_lookup_parity import run_law_lookup

from agent.common.knowledge_context import KnowledgeContext
from agent.common.knowledge_context import LawSource as TurnSource
from agent.common.knowledge_context import set_turn_knowledge_context
from agent.knowledge.law_lookup import turn_source as turn_source_module
from agent.knowledge.law_lookup.turn_source import turn_source

_MISS = next(case for case in CASES if case.id == "live-unplanned")


def _renamed(name: str) -> dict:
    record = released_record()
    record["lookup"]["wording"]["source"] = name
    return record


@pytest.mark.asyncio
async def test_the_lookup_reads_the_record_the_turn_carries_not_its_fallback():
    output = await run_law_lookup(_MISS, Upstream.load(), turn_record=_renamed("Gazette-as-released"))

    assert output.output.startswith("No Gazette-as-released passage answered")


@pytest.mark.asyncio
async def test_without_a_record_the_fallback_is_read_and_logged_once(caplog):
    turn_source_module._FELL_BACK.clear()
    with caplog.at_level(logging.WARNING):
        first = await run_law_lookup(_MISS, Upstream.load())
        await run_law_lookup(_MISS, Upstream.load())

    assert first.output.startswith("No RIS passage answered")
    assert [r.message for r in caplog.records].count(caplog.records[0].message) == 1
    assert "[law_source_from_repository=true]" in caplog.records[0].message


@pytest.mark.asyncio
async def test_a_source_the_turn_could_not_carry_is_said_in_the_answer():
    set_turn_knowledge_context(
        KnowledgeContext(
            gate="core", site_country="AT", sources_dropped=("at-ris-ogd",), retrieval_countries=frozenset({"AT"})
        )
    )
    try:
        output = await run_law_lookup(_MISS, Upstream.load())
    finally:
        set_turn_knowledge_context(None)

    first_line, rest = output.output.split("\n", 1)
    assert "at-ris-ogd could not be carried by this turn" in first_line
    assert rest.startswith("No RIS passage answered")


def test_the_site_country_s_source_is_read_before_another_country_s():
    def source(key: str, country: str) -> TurnSource:
        return TurnSource(key=key, revision_id=f"r-{key}", country=country, config={"lookup": {}})

    set_turn_knowledge_context(
        KnowledgeContext(
            gate="core", site_country="XB", sources=(source("xa-gazette", "XA"), source("xb-portal", "XB"))
        )
    )
    try:
        assert turn_source().key == "xb-portal"
        set_turn_knowledge_context(
            KnowledgeContext(gate="core", sources=(source("xa-gazette", "XA"), source("xb-portal", "XB")))
        )
        assert turn_source() is None
        # A site's law is its own country's: the one record carried, of another country, does not answer for it.
        set_turn_knowledge_context(
            KnowledgeContext(gate="core", site_country="XC", sources=(source("xa-gazette", "XA"),))
        )
        assert turn_source() is None
    finally:
        set_turn_knowledge_context(None)


@pytest.mark.asyncio
async def test_the_fallback_is_no_way_past_the_gate():
    """A turn whose own sources are not chosen falls back only where its gate reads the fallback's country."""
    other = TurnSource(key="xa-gazette", revision_id="r-xa", country="XA", config={"lookup": {}})
    more = TurnSource(key="xb-portal", revision_id="r-xb", country="XB", config={"lookup": {}})
    set_turn_knowledge_context(
        KnowledgeContext(gate="core", sources=(other, more), retrieval_countries=frozenset({"XA", "XB"}))
    )
    try:
        output = await run_law_lookup(_MISS, Upstream.load())
    finally:
        set_turn_knowledge_context(None)

    assert output.output.startswith("Not executed: RIS was not consulted")
    assert output.requested == ()


def test_the_chat_binding_is_gated_by_whether_the_turn_reads_law_and_deep_research_by_its_country():
    from agent.common.law_gate import law_sources_withheld

    xa = TurnSource(key="xa-gazette", revision_id="r-xa", country="XA", config={"lookup": {}})
    set_turn_knowledge_context(
        KnowledgeContext(gate="core", site_country="XA", sources=(xa,), retrieval_countries=frozenset({"XA"}))
    )
    try:
        assert law_sources_withheld(reads_turn_sources=True) == frozenset()
        assert law_sources_withheld() == frozenset({"ris"})
    finally:
        set_turn_knowledge_context(None)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "break_it",
    [
        lambda r: r["terms"].update(licence="licensed"),
        lambda r: r["lookup"].update(field_this_build_does_not_know=1),
        lambda r: r.update(hosts=["elsewhere.example"]),
    ],
    ids=["licensed", "unknown-field", "hosts-off-the-access"],
)
async def test_a_record_this_build_cannot_read_falls_back_and_answers(break_it, caplog):
    """One bad released record must not take its country's lookup down: the fallback answers, and it is logged."""
    record = released_record()
    break_it(record)
    with caplog.at_level(logging.ERROR):
        output = await run_law_lookup(_MISS, Upstream.load(), turn_record=record)

    assert output.output.startswith("No RIS passage answered")
    assert any("[law_source_record_unreadable=true]" in r.message for r in caplog.records)


def test_the_span_names_the_record_that_answered_and_how_it_was_reached():
    from agent.knowledge.law_lookup.address import Address
    from agent.knowledge.law_lookup.telemetry import _span_context
    from agent.knowledge.law_lookup.trace import LookupTrace

    trace = LookupTrace(source="at-ris-ogd", source_revision="r1", source_origin="turn")
    context = _span_context("q", Address(), trace, [], "ris_lookup")

    assert (context["source"], context["source_revision"], context["source_origin"]) == ("at-ris-ogd", "r1", "turn")
