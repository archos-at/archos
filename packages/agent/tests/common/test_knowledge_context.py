"""The turn's knowledge context (ADR-0173): parsed fail-closed, bound per turn, the gate decides the corpus."""

from __future__ import annotations

import pytest

from agent.common.knowledge_context import UNAVAILABLE
from agent.common.knowledge_context import KnowledgeContext
from agent.common.knowledge_context import corpus_country_allowed
from agent.common.knowledge_context import law_tools_allowed
from agent.common.knowledge_context import parse_knowledge_context
from agent.common.knowledge_context import set_turn_knowledge_context
from agent.common.knowledge_context import trace_metadata
from agent.common.knowledge_context import turn_knowledge_context
from agent.common.law_gate import building_law_block
from agent.common.law_gate import jurisdiction_note
from agent.common.law_gate import law_sources_withheld
from agent.common.law_gate import research_doctrine
from agent.turn.context_client import _parse_blocks

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


def test_a_turn_the_bff_sent_no_context_reads_as_unavailable():
    """ADR-0175: the BFF sends a context on every turn, so a missing key fails closed, never as "everything"."""
    assert _parse_blocks(_blocks({})).knowledge_context == UNAVAILABLE


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


def test_without_a_bound_context_nothing_is_allowed():
    """No context bound (a run that brought none, a test) is ``knowledge_unavailable``: no law, no corpus."""
    assert turn_knowledge_context() == UNAVAILABLE
    assert law_tools_allowed("AT") is False
    assert corpus_country_allowed("AT") is False
    assert law_sources_withheld() == frozenset({"ris"})
    assert "not available this turn" in (jurisdiction_note() or "")


def test_a_gate_that_does_not_read_austria_withholds_the_corpus_and_ris():
    set_turn_knowledge_context(KnowledgeContext(gate="not_entitled", site_country="AT"))
    assert corpus_country_allowed("AT") is False
    assert law_sources_withheld() == frozenset({"ris"})


def test_an_unknown_site_reads_the_corpus_but_not_the_legal_database():
    set_turn_knowledge_context(KnowledgeContext(gate="site_unknown", retrieval_countries=frozenset({"AT"})))
    assert corpus_country_allowed("AT") is True
    assert law_sources_withheld() == frozenset({"ris"})


def test_a_covered_austrian_site_keeps_the_legal_database():
    set_turn_knowledge_context(
        KnowledgeContext(gate="core", site_country="AT", retrieval_countries=frozenset({"AT", "EU"}))
    )
    assert law_sources_withheld() == frozenset()


def test_a_german_site_never_runs_the_austrian_legal_database():
    set_turn_knowledge_context(
        KnowledgeContext(gate="core", site_country="DE", retrieval_countries=frozenset({"DE", "EU"}))
    )
    assert law_sources_withheld() == frozenset({"ris"})


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
def test_the_prompt_reads_the_gate_and_shows_the_chain_only_where_law_is_read(gate, country, heading):
    context = KnowledgeContext(gate=gate, site_country=country)
    set_turn_knowledge_context(context)
    assert f"## Building law: {heading}" in (jurisdiction_note() or "")
    assert (building_law_block("Building law at this site") is None) is context.withholds_law


def test_core_coverage_has_no_note_and_says_when_the_base_moved():
    set_turn_knowledge_context(KnowledgeContext(gate="core", site_country="AT"))
    assert jurisdiction_note() is None
    set_turn_knowledge_context(KnowledgeContext(gate="core", site_country="AT", updated_since_last_answer=("AT",)))
    assert "updated since this conversation's last answer (AT)" in (jurisdiction_note() or "")


def test_the_research_doctrine_is_the_method_then_the_note_or_the_chain():
    from agent.citations.roles import BuildingLaw
    from agent.citations.roles import set_turn_building_law

    set_turn_building_law(
        BuildingLaw(text="Building law at this site, Wien", chain=("AT-9",), date="2026-11-10", uses=())
    )
    try:
        set_turn_knowledge_context(KnowledgeContext(gate="core", site_country="AT"))
        assert research_doctrine().endswith("<building_law>\nBuilding law at this site, Wien\n</building_law>")
        set_turn_knowledge_context(KnowledgeContext(gate="not_entitled", site_country="AT"))
        doctrine = research_doctrine()
        assert "## Building law: AT, not included" in doctrine and "<building_law>" not in doctrine
    finally:
        set_turn_building_law(None)


def test_the_research_doctrine_names_no_country():
    """The method holds everywhere; Austria's doctrine is its pack's chain text (ADR-0175)."""
    set_turn_knowledge_context(KnowledgeContext(gate="core", site_country="DE"))
    for austrian in ("ÖNORM", "OIB", "Wien", "Bundesland", "MA 37", "Flächenwidmung"):
        assert austrian not in research_doctrine(), austrian
