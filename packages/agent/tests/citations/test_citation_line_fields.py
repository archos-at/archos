"""A citation carries what its line states: edition, role, route and dates, from the records (design §6.7).

``test_roles.py`` holds which role a passage gets, on the Austrian records. Here: that a passage finds its
record by the id its producer stated and by nothing else, that everything a status line reads rides the same
wire, and that the days a citation states are true. Every fixture is an invented country: what is under
test is code, and a country is data (ADR-0162, ADR-0168).
"""

from __future__ import annotations

import dataclasses
from datetime import UTC
from datetime import datetime

import pytest

from agent.citations.entries import SourceEntry
from agent.citations.registry import SourceRegistry
from agent.citations.roles import use_for_entry
from agent.citations.session import _registry_from_cached_entries
from agent.citations.wire import source_entry_to_wire
from agent.common.knowledge_context import parse_knowledge_context
from agent.common.knowledge_context import set_turn_knowledge_context
from agent.common.knowledge_context import use_for_source_ref

ACT = {
    "workId": "work:building-act",
    "editionId": None,
    "role": "binding",
    "qualifier": None,
    "via": "territory",
    "route": None,
    "roleSince": None,
    "date": "2026-11-10",
    "freshness": "current",
    "lastCheckedAt": None,
    "connectsBy": ["site"],
    "labels": [],
    "corpusFiles": [],
    "designation": "BA-N",
    "editionLabel": None,
    "sourceRefs": [{"scheme": "xa_law_number", "value": "77"}],
    "sourceUrl": None,
    "language": None,
    "textStatus": None,
    "applicability": None,
}

GUIDELINE = {
    **ACT,
    "workId": "work:guideline-2",
    "editionId": "edition:guideline-2-2021",
    "via": "relation",
    "route": {
        "workId": "work:technical-ordinance",
        "designation": "TO-N",
        "editionLabel": "TO-N 2022",
        "provision": None,
    },
    "roleSince": "2022-06-15",
    "freshness": "newer_known",
    "lastCheckedAt": "2026-10-30",
    "labels": ["check_overdue"],
    "corpusFiles": ["guideline_2_edition_may_2021.pdf"],
    "designation": "GL 2",
    "editionLabel": "Edition May 2021",
    "sourceRefs": [],
    "sourceUrl": "https://standards.xa.example/guideline-2",
    "language": "fr-XA",
    "textStatus": "translation",
}

CONTEXT = {
    "gate": {
        "state": "core",
        "reason": None,
        "leaves": [
            {
                "territoryId": "XA-1",
                "country": "XA",
                "certainty": "verified",
                "entitled": True,
                "coverage": "core",
                "municipalLaw": None,
            }
        ],
    },
    "packs": [{"packId": "XA", "seq": 1}],
    "chains": {"XA-1": ["XA-1", "XA"]},
    "date": "2026-11-10",
    "procedures": [],
    "uses": [ACT, GUIDELINE],
    "text": None,
    "retrieval": {"countries": ["XA"]},
}


@pytest.fixture(autouse=True)
def _turn():
    set_turn_knowledge_context(parse_knowledge_context(CONTEXT))
    yield
    set_turn_knowledge_context(None)


GAZETTE_URL = "https://gazette.xa.example/code?Law=77"


def _at_the_gazette(work_id: str | None = "work:building-act", **fields) -> SourceEntry:
    """A passage cited by its key, as a legal-database producer states it: no ``url``, the record it read,
    and the address beside it."""
    return SourceEntry(
        citation_key="Building Act of Nordland, § 12",
        source_type="knowledge_layer",
        tool_name="statute_lookup",
        shelf="base",
        work_id=work_id,
        public_url=GAZETTE_URL,
        **fields,
    )


def test_a_passage_read_at_a_public_source_takes_its_role_by_the_work_its_producer_stated():
    wire = source_entry_to_wire(_at_the_gazette())
    assert (wire["binding_status"], wire["role"], wire["designation"]) == ("binding", "binding", "BA-N")
    # The address is offered to a reader and is not the entry's identity: no ``url``, so no URL dedup.
    assert wire["public_url"] == GAZETTE_URL
    assert "url" not in wire


def test_a_producer_finds_the_work_by_the_identifier_its_record_carries_compared_whole():
    """What a live source's producer asks (``use_for_source_ref``): scheme and value, both whole."""
    context = parse_knowledge_context(CONTEXT)
    assert use_for_source_ref(context, "xa_law_number", " 77 ").work_id == "work:building-act"
    for scheme, value in (("xa_law_number", "770"), ("xa_law_number", "7"), ("another_scheme", "77")):
        assert use_for_source_ref(context, scheme, value) is None


@pytest.mark.parametrize("work_id", [None, "work:of-another-country"])
def test_without_a_record_the_turn_carries_an_address_decides_nothing(work_id):
    """The address names the law's own number on the source's own host, and still states no role: a role is
    resolved by the id of a record, never by a URL."""
    entry = _at_the_gazette(work_id)
    assert use_for_entry(entry) is None
    wire = source_entry_to_wire(entry)
    assert wire["binding_status"] == "unknown" and "role" not in wire
    assert wire["public_url"] == GAZETTE_URL


def test_a_cited_edition_carries_its_label_route_and_dates_from_the_records():
    entry = SourceEntry(
        citation_key="any_file_name.pdf, p.14",
        source_type="knowledge_layer",
        shelf="base",
        edition_id="edition:guideline-2-2021",
    )
    wire = source_entry_to_wire(entry)
    assert {key: wire[key] for key in ("designation", "edition_label", "role", "binding_status")} == {
        "designation": "GL 2",
        "edition_label": "Edition May 2021",
        "role": "binding",
        "binding_status": "declared_binding",
    }
    # The instrument that declares it, without the keys its record leaves unstated.
    assert wire["route"] == {"work_id": "work:technical-ordinance", "designation": "TO-N", "edition_label": "TO-N 2022"}
    assert (wire["role_since"], wire["as_of"]) == ("2022-06-15", "2026-11-10")
    assert (wire["last_checked_at"], wire["freshness"], wire["role_labels"]) == (
        "2026-10-30",
        "newer_known",
        ["check_overdue"],
    )
    # Which text was read, for a country that publishes in more than one language.
    assert (wire["language"], wire["text_status"]) == ("fr-XA", "translation")
    # A corpus passage states no address of its own: the edition's records name where it is published.
    assert wire["public_url"] == "https://standards.xa.example/guideline-2"
    assert "retrieved_at" not in wire


def test_a_source_no_record_reaches_carries_none_of_it():
    wire = source_entry_to_wire(SourceEntry(citation_key="site_plan.pdf, p.2", source_type="knowledge_layer"))
    absent = ("role", "designation", "edition_label", "route", "role_since", "as_of", "last_checked_at", "freshness")
    absent += ("language", "text_status")
    assert not set(absent) & set(wire)


def test_a_use_the_bff_sends_malformed_dates_for_states_no_date():
    """Never guessed: a day that is no ISO day, an unknown freshness or label, a non-https address: all absent."""
    bent = {
        **GUIDELINE,
        "roleSince": "June 2022",
        "lastCheckedAt": 20261030,
        "freshness": "fresh",
        "labels": ["check_overdue", "made_up"],
        "sourceUrl": "http://standards.xa.example/guideline-2",
        "route": {"designation": "TO-N"},
        "language": 7,
        "textStatus": "original",
    }
    use = parse_knowledge_context({**CONTEXT, "uses": [bent]}).uses[0]
    assert (use.role_since, use.last_checked_at, use.freshness, use.source_url, use.route) == (None,) * 5
    assert (use.language, use.text_status) == (None, None)
    assert use.labels == ("check_overdue",)


def test_a_source_read_live_is_stamped_with_the_day_of_the_turn_and_keeps_it():
    """ "abgerufen am" is the day the turn read it: stamped once, and a later turn's cache restore keeps that day."""
    registry = SourceRegistry()
    web = SourceEntry(url="https://example.org/page", source_type="generic", tool_name="web_search")
    law = _at_the_gazette()
    corpus = SourceEntry(citation_key="guideline_2_edition_may_2021.pdf, p.14", source_type="knowledge_layer")
    for entry in (web, law, corpus):
        registry.add(entry)
    today = datetime.now(UTC).date().isoformat()
    assert (web.retrieved_at, law.retrieved_at, corpus.retrieved_at) == (today, today, None)
    assert source_entry_to_wire(web)["retrieved_at"] == today

    earlier = dataclasses.replace(web, retrieved_at="2026-03-02")
    restored = _registry_from_cached_entries([dataclasses.asdict(earlier), dataclasses.asdict(law)])
    assert [entry.retrieved_at for entry in restored.all_sources()] == ["2026-03-02", today]
    kept = restored.all_sources()[1]
    assert (kept.public_url, kept.work_id) == (GAZETTE_URL, "work:building-act")


def test_a_document_s_revision_reaches_the_wire_as_its_producer_stated_it():
    named = SourceEntry(
        citation_key="site_plan_index_c.pdf, p.2",
        source_type="knowledge_layer",
        revision_index="C",
        revision_date="2026-08-14",
    )
    assert source_entry_to_wire(named)["revision"] == {"index": "C", "date": "2026-08-14"}
    assert source_entry_to_wire(_at_the_gazette(revision_date="2026-03-14"))["revision"] == {"date": "2026-03-14"}
    assert "revision" not in source_entry_to_wire(SourceEntry(citation_key="site_plan.pdf, p.2"))
    restored = _registry_from_cached_entries([dataclasses.asdict(named)]).all_sources()[0]
    assert (restored.revision_index, restored.revision_date) == ("C", "2026-08-14")


# -- the two scores (docs/observability/langfuse.md) -------------------------------------------------------


def _law(**fields) -> dict:
    return {"kind": "building_law", **fields}


def test_the_scores_state_the_share_of_cited_building_law_that_names_its_edition_and_role():
    from agent.observability.citation_scores import citation_line_scores

    sources = [
        _law(role="binding", edition_label="Edition May 2021"),
        _law(role="binding", revision={"date": "2026-03-14"}),  # law read live: its Fassung day names it
        _law(revision={"index": "C"}),  # an index alone names no edition of a law
        _law(),
        {"kind": "project", "role": "binding", "edition_label": "x"},  # never counted
    ]
    scores = {score.name: (score.value, score.comment) for score in citation_line_scores(sources, may_bind=True)}
    assert scores == {"edition-named": (0.5, "2 of 4"), "citation-role-resolved": (0.5, "2 of 4")}


def test_no_role_share_is_written_where_the_gate_withholds_binding_and_nothing_without_building_law():
    from agent.observability.citation_scores import citation_line_scores

    assert [score.name for score in citation_line_scores([_law()], may_bind=False)] == ["edition-named"]
    assert citation_line_scores([{"kind": "project"}, "not a source"], may_bind=True) == []


def test_an_answer_s_cited_sources_are_scored_at_the_gate_its_context_is_bound_to(monkeypatch):
    from agent.observability import citation_scores

    written: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        citation_scores,
        "emit_scores",
        lambda scores, *, writer: written.append((writer, {score.name: score.value for score in scores})),
    )
    cited = [
        SourceEntry(
            citation_key="any_file_name.pdf, p.14",
            source_type="knowledge_layer",
            shelf="base",
            doc_class="law",
            edition_id="edition:guideline-2-2021",
        ),
        _at_the_gazette(None, doc_class="law"),
    ]
    wire = [source_entry_to_wire(entry) for entry in cited]
    citation_scores.emit_citation_line_scores(wire, writer="chat")
    set_turn_knowledge_context(None)
    citation_scores.emit_citation_line_scores(wire, writer="deep_research")
    assert written == [
        ("chat", {"edition-named": 0.5, "citation-role-resolved": 0.5}),
        # No context bound: the gate withholds binding, so no role share is written.
        ("deep_research", {"edition-named": 0.5}),
    ]
