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

pytestmark = pytest.mark.asyncio

_MISS = next(case for case in CASES if case.id == "live-unplanned")


def _renamed(name: str) -> dict:
    record = released_record()
    record["lookup"]["wording"]["source"] = name
    return record


async def test_the_lookup_reads_the_record_the_turn_carries_not_its_fallback():
    output = await run_law_lookup(_MISS, Upstream.load(), turn_record=_renamed("Gazette-as-released"))

    assert output.output.startswith("No Gazette-as-released passage answered")


async def test_without_a_record_the_fallback_is_read_and_logged_once(caplog):
    turn_source_module._FELL_BACK.clear()
    with caplog.at_level(logging.WARNING):
        first = await run_law_lookup(_MISS, Upstream.load())
        await run_law_lookup(_MISS, Upstream.load())

    assert first.output.startswith("No RIS passage answered")
    assert [r.message for r in caplog.records].count(caplog.records[0].message) == 1
    assert "[law_source_from_repository=true]" in caplog.records[0].message


async def test_a_source_the_turn_could_not_carry_is_said_in_the_answer():
    set_turn_knowledge_context(KnowledgeContext(gate="core", site_country="AT", sources_dropped=("at-ris-ogd",)))
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
    finally:
        set_turn_knowledge_context(None)
