"""The turn's knowledge context (ADR-0173): parsed fail-closed, bound per turn, the gate decides the corpus."""

from __future__ import annotations

import pytest

from agent.common.applicability import render_project_block
from agent.common.country_profile import austrian_corpus_applies
from agent.common.country_profile import austrian_only_sources
from agent.common.country_profile import jurisdiction_block
from agent.common.knowledge_context import KnowledgeContext
from agent.common.knowledge_context import parse_knowledge_context
from agent.common.knowledge_context import set_turn_knowledge_context
from agent.common.knowledge_context import trace_metadata
from agent.turn.context_client import _parse_blocks

VIENNA_PROFILE = "PROJECT_CONTEXT v1\n\nconfirmed:\n- country=at\n- federal_state=vienna\n"

WIRE = {
    "gate": {
        "state": "open",
        "reason": None,
        "leaves": [
            {
                "territoryId": "DE-NW",
                "country": "DE",
                "certainty": "verified",
                "entitled": True,
                "coverage": "open",
                "municipalLaw": None,
            }
        ],
    },
    "packs": [{"packId": "DE", "seq": 12}, {"packId": "EU", "seq": 3}],
    "chains": {"DE-NW": ["DE-NW", "DE", "EU"]},
    "date": "2026-12-14",
    "procedures": [
        {
            "id": "p1",
            "procedureType": None,
            "filedOn": None,
            "decidedOn": None,
            "referenceDates": {"DE-NW": {"date": None, "basis": "undetermined"}},
        }
    ],
    "uses": [{"workId": "work:bauo-nrw", "role": "binding", "qualifier": "uncurated"}],
    "retrieval": {"countries": ["DE", "EU"]},
    "updatedSinceLastAnswer": ["DE"],
}


def _rendered() -> str | None:
    """The jurisdiction block the turn context renders for the Vienna profile."""
    return jurisdiction_block(VIENNA_PROFILE, render_project_block)


@pytest.fixture(autouse=True)
def _unbound():
    set_turn_knowledge_context(None)
    yield
    set_turn_knowledge_context(None)


def _blocks(extra: dict[str, object]) -> dict[str, object]:
    data = {
        "projectContext": None,
        "projectMemory": None,
        "orgInstructions": None,
        "drewOnOtherProjects": False,
        "referenceProjects": None,
        "workspace": None,
        "baseKnowledge": None,
        "baseKnowledgeLabels": [],
        "buildingLaw": None,
    }
    return {"data": {**data, **extra}}


def test_reads_no_context_when_the_bff_sends_no_key():
    assert _parse_blocks(_blocks({})).knowledge_context is None


def test_reads_the_gate_coverage_packs_and_retrieval_the_bff_sends():
    context = _parse_blocks(_blocks({"knowledgeContext": WIRE})).knowledge_context
    assert context is not None
    assert context.gate == "open"
    assert context.coverage == "open"
    assert context.packs == {"DE": 12, "EU": 3}
    assert context.retrieval_countries == frozenset({"DE", "EU"})
    assert context.chains == {"DE-NW": ("DE-NW", "DE", "EU")}


@pytest.mark.parametrize(
    "raw", [None, "open", {"gate": {"state": "partial"}, "retrieval": {"countries": []}}, {"gate": {"state": "open"}}]
)
def test_reads_a_context_not_of_its_shape_as_unavailable(raw):
    context = parse_knowledge_context(raw)
    assert context.gate == "knowledge_unavailable"
    assert context.retrieval_countries == frozenset()
    assert context.withholds_law


def test_trace_metadata_names_chains_gate_coverage_packs_and_reference_dates():
    assert trace_metadata(parse_knowledge_context(WIRE)) == {
        "gate": "open",
        "coverage": "open",
        "jurisdiction_chains": "DE-NW:DE-NW>DE>EU",
        "pack_seqs": "DE:12,EU:3",
        "reference_dates": "p1@DE-NW=undetermined",
        "base_updated_since_last_answer": "DE",
    }


def test_without_a_bound_context_the_site_decides_as_before():
    assert austrian_corpus_applies(VIENNA_PROFILE) is True
    assert austrian_corpus_applies(None) is True


def test_a_gate_that_does_not_read_austria_withholds_the_corpus_and_ris():
    set_turn_knowledge_context(KnowledgeContext(gate="not_entitled", retrieval_countries=frozenset()))
    assert austrian_corpus_applies(VIENNA_PROFILE) is False
    assert austrian_only_sources(VIENNA_PROFILE) == frozenset({"ris"})


def test_an_unknown_site_of_an_austrian_office_still_reads_austria():
    set_turn_knowledge_context(KnowledgeContext(gate="site_unknown", retrieval_countries=frozenset({"AT"})))
    assert austrian_corpus_applies(None) is True


def test_an_unknown_site_reads_the_corpus_but_not_the_legal_database():
    # E04: the office's entitled corpus answers, but no law lookup runs while the site is unknown.
    set_turn_knowledge_context(KnowledgeContext(gate="site_unknown", retrieval_countries=frozenset({"AT"})))
    assert austrian_corpus_applies(None) is True
    assert austrian_only_sources(None) == frozenset({"ris"})


def test_a_covered_austrian_site_keeps_the_legal_database():
    set_turn_knowledge_context(KnowledgeContext(gate="core", retrieval_countries=frozenset({"AT", "EU"})))
    assert austrian_only_sources(VIENNA_PROFILE) == frozenset()


@pytest.mark.parametrize(
    ("gate", "country", "heading"),
    [
        ("organization_unplaced", None, "the office's country is not set"),
        ("site_unknown", None, "site not stated"),
        ("not_entitled", "DE", "DE, not included"),
        ("knowledge_unavailable", "AT", "not available this turn"),
        ("none", "CH", "CH, no base yet"),
        ("open", "DE", "DE, open coverage"),
    ],
)
def test_the_prompt_reads_the_gate_and_withholds_the_verdicts_where_law_is_withheld(gate, country, heading):
    verdicts = _rendered()  # flag off: the Vienna profile's own verdict block
    assert verdicts
    context = KnowledgeContext(gate=gate, site_country=country)
    set_turn_knowledge_context(context)
    rendered = _rendered()
    assert rendered is not None
    assert f"## Building law: {heading}" in rendered
    assert (verdicts in rendered) is not context.withholds_law


def test_core_coverage_reads_like_the_flag_off_and_says_when_the_base_moved():
    flag_off = _rendered()
    set_turn_knowledge_context(KnowledgeContext(gate="core", site_country="AT"))
    assert _rendered() == flag_off
    set_turn_knowledge_context(KnowledgeContext(gate="core", site_country="AT", updated_since_last_answer=("AT",)))
    assert "updated since this conversation's last answer (AT)" in (_rendered() or "")


def test_an_open_gate_keeps_the_doctrine_and_a_withholding_gate_replaces_it():
    from agent.common.norm_registry import doctrine_for

    doctrine = doctrine_for(VIENNA_PROFILE)
    set_turn_knowledge_context(KnowledgeContext(gate="open", site_country="AT", retrieval_countries=frozenset({"AT"})))
    assert doctrine_for(VIENNA_PROFILE) == doctrine
    set_turn_knowledge_context(KnowledgeContext(gate="not_entitled", site_country="AT"))
    assert doctrine_for(VIENNA_PROFILE).startswith("## Building law: AT, not included")
