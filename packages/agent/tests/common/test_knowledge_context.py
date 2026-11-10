"""The turn's knowledge context (ADR-0173): parsed fail-closed, bound per turn, the gate decides the corpus."""

from __future__ import annotations

import re
from pathlib import Path

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

REPO = Path(__file__).resolve().parents[4]

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
    "uses": [{"workId": "work:bauo-nrw", "role": "binding", "via": "territory", "qualifier": "uncurated"}],
    "text": "Building law at this site, Düsseldorf (DE-NW, DE, EU) …",
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
        "building_law_uses": 1,
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


@pytest.mark.parametrize("gate", ["site_unknown", "none", "open", "core"])
def test_reading_the_primary_law_is_not_a_verdict(gate):
    """Dev acceptance A5: an office-level question in its home country quotes RIS, whatever the coverage."""
    set_turn_knowledge_context(KnowledgeContext(gate=gate, site_country="AT", retrieval_countries=frozenset({"AT"})))
    assert corpus_country_allowed("AT") is True
    assert law_sources_withheld() == frozenset()


@pytest.fixture
def ris_registered():
    from agent.common.data_source_registry import populate_from_config
    from agent.common.data_source_registry import reset_registry

    reset_registry()
    populate_from_config([{"id": "ris", "name": "RIS", "description": "Austrian law.", "tools": ["ris_lookup_tool"]}])
    yield
    reset_registry()


@pytest.mark.parametrize(
    ("gate", "country", "reason"),
    [
        ("organization_unplaced", None, "the office's country is not set"),
        ("not_entitled", "DE", "the site is in DE"),
        ("knowledge_unavailable", "AT", "could not be read"),
    ],
)
def test_a_withheld_legal_database_says_why_and_never_that_it_is_switched_off(gate, country, reason, ris_registered):
    from agent.common.data_sources import disabled_source_notice

    set_turn_knowledge_context(KnowledgeContext(gate=gate, site_country=country))
    notice = disabled_source_notice("ris_lookup_tool", {"ris"})
    assert notice is not None and reason in notice
    assert "switched off" not in notice
    assert "below high" in notice


def test_a_switched_off_source_the_gate_allows_still_reads_as_switched_off(ris_registered):
    """The org's own toggle is a setting; only the gate's reasons replace its text."""
    from agent.common.data_sources import disabled_source_notice

    set_turn_knowledge_context(KnowledgeContext(gate="core", site_country="AT", retrieval_countries=frozenset({"AT"})))
    assert "switched off" in (disabled_source_notice("ris_lookup_tool", {"ris"}) or "")


def test_the_unknown_site_note_names_what_the_base_covers_and_keeps_the_web_to_information():
    """Dev acceptance A3 and A4: no assumed country, a place outside the base is not covered, the web is information."""
    set_turn_knowledge_context(KnowledgeContext(gate="site_unknown", retrieval_countries=frozenset({"AT", "EU"})))
    note = jurisdiction_note() or ""
    assert "AT, EU" in note and "do not assume a" in note
    # Baseline Q3: an unconfirmed München from project memory applied Bavarian law.
    assert "project memory" in note and "not a confirmed site" in note
    assert "unverified information" in note and "never from a web copy" in note
    # Each sentence of A4 on its own: a reworded or dropped one fails here.
    assert "You may read and quote the primary law of AT, EU as information." in note
    assert "A place the question names outside AT, EU is not covered by this office's base: say so plainly." in note
    assert "ask for the country and Land" in note


def test_a_site_nobody_placed_with_no_covered_country_says_no_country_s_law_is_read():
    """Review of #1582: an empty scope rendered "the primary law of no country … outside no country"."""
    set_turn_knowledge_context(KnowledgeContext(gate="site_unknown"))
    note = jurisdiction_note() or ""
    assert "This office's base covers no country, so no country's primary law is read here" in note
    assert "of no country as information" not in note and "outside no country" not in note


@pytest.mark.parametrize(
    "gate", ["organization_unplaced", "site_unknown", "not_entitled", "knowledge_unavailable", "none", "open"]
)
def test_every_note_keeps_the_web_from_supplying_a_requirement_or_an_edition(gate):
    set_turn_knowledge_context(KnowledgeContext(gate=gate, site_country="AT"))
    assert "never the source of a requirement or of which edition binds" in (jurisdiction_note() or "")


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
    chain = "Building law at this site, Wien"
    set_turn_knowledge_context(KnowledgeContext(gate="core", site_country="AT", text=chain))
    assert research_doctrine().endswith(f"<building_law>\n{chain}\n</building_law>")
    set_turn_knowledge_context(KnowledgeContext(gate="not_entitled", site_country="AT", text=chain))
    doctrine = research_doctrine()
    assert "## Building law: AT, not included" in doctrine and "<building_law>" not in doctrine


def test_the_research_doctrine_names_no_country():
    """The method holds everywhere; Austria's doctrine is its pack's chain text (ADR-0175)."""
    set_turn_knowledge_context(KnowledgeContext(gate="core", site_country="DE"))
    for austrian in ("ÖNORM", "OIB", "Wien", "Bundesland", "MA 37", "Flächenwidmung"):
        assert austrian not in research_doctrine(), austrian


# --- the law gate on confidence (staging QC F6, ADR-0175) ---

OIB_PASSAGE = {"citation_key": "oib-rl_2_ausgabe_mai_2023.pdf, p.12", "source_type": "knowledge_layer", "shelf": "base"}
PROJECT_PASSAGE = {"citation_key": "Einreichplan.pdf, p.2", "source_type": "knowledge_layer", "shelf": "project"}


@pytest.mark.parametrize(
    ("gate", "passage", "unsettled"),
    [
        ("none", OIB_PASSAGE, True),
        ("site_unknown", OIB_PASSAGE, True),
        ("open", OIB_PASSAGE, True),
        ("core", OIB_PASSAGE, False),
        ("full", OIB_PASSAGE, False),
        ("none", PROJECT_PASSAGE, False),
    ],
)
def test_an_answer_on_law_the_records_do_not_settle_is_unsettled(gate, passage, unsettled):
    from agent.citations.entries import SourceEntry
    from agent.common.law_gate import law_unsettled

    set_turn_knowledge_context(KnowledgeContext(gate=gate, site_country="AT", retrieval_countries=frozenset({"AT"})))
    assert law_unsettled([SourceEntry(**passage)]) is unsettled


def test_every_gate_state_the_bff_sends_has_a_policy():
    """Review of #1582: one table, so a state added on the wire and not here fails here, not open."""
    from agent.common.knowledge_context import GATES

    source = (REPO / "apps/workspace/bff/base-knowledge/wire/vocab.ts").read_text(encoding="utf-8")

    def listed(name: str) -> list[str]:
        match = re.search(rf"export const {name} = \[([^\]]*)\]", source)
        assert match is not None, name
        items = re.findall(r"'([a-z_]+)'|\.\.\.([A-Z_]+)", match.group(1))
        return [value for word, spread in items for value in ([word] if word else listed(spread))]

    assert tuple(listed("GATE_STATES")) == tuple(GATES)


def test_an_unknown_gate_state_fails_closed():
    from agent.common.knowledge_context import gate_policy

    assert gate_policy("partial") == gate_policy("knowledge_unavailable")
    assert KnowledgeContext(gate="partial").withholds_law
    set_turn_knowledge_context(KnowledgeContext(gate="partial", retrieval_countries=frozenset({"AT"})))
    assert law_sources_withheld() == frozenset({"ris"})
