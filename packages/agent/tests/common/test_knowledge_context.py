"""The turn's knowledge context (ADR-0173): parsed fail-closed, bound per turn, the gate decides the corpus."""

from __future__ import annotations

import pytest

from agent.common.country_profile import austrian_corpus_applies
from agent.common.country_profile import austrian_only_sources
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
            "stichtage": {"DE-NW": {"date": None, "basis": "undetermined"}},
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


def test_trace_metadata_names_chains_gate_coverage_packs_and_stichtage():
    assert trace_metadata(parse_knowledge_context(WIRE)) == {
        "gate": "open",
        "coverage": "open",
        "jurisdiction_chains": "DE-NW:DE-NW>DE>EU",
        "pack_seqs": "DE:12,EU:3",
        "stichtage": "p1@DE-NW=undetermined",
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
