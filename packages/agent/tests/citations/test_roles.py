"""Roles from the knowledge context decide a cited edition's status (ADR-0168, ADR-0175).

Fed by what the BFF really sends: ``tests/fixtures/base-knowledge/turn_law_austria.json``, each Land's
``knowledgeContext`` as the production resolvers write it from the Austria and EU packs
(``apps/workspace/bff/base-knowledge/context/turn-law.fixture.spec.ts``). With it bound, an OIB-RL 2:2023
passage is guidance in Steiermark (where 2019 binds) and declared binding in Wien, and a RIS passage of the
Wiener Bauordnung takes its binding role by an identity the work's records carry. Without a context nothing
binds: every source is ``unknown``. The context is the turn's one answer to which law applies, so a
citation follows the role the gate corrected (open coverage, freshness, connecting factor).
"""

from __future__ import annotations

import copy
import dataclasses
import json
import re
from pathlib import Path

import pytest

from agent.citations.entries import SourceEntry
from agent.citations.roles import binding_status_for
from agent.citations.roles import use_for_entry
from agent.citations.wire import source_entry_to_wire
from agent.common.knowledge_context import EDITION_ROLES
from agent.common.knowledge_context import parse_knowledge_context
from agent.common.knowledge_context import set_turn_knowledge_context
from agent.common.knowledge_context import use_for_source_ref

REPO = Path(__file__).resolve().parents[4]
LAW = json.loads((REPO / "tests/fixtures/base-knowledge/turn_law_austria.json").read_text(encoding="utf-8"))

STYRIA: dict = LAW["AT-6"]["knowledgeContext"]
VIENNA: dict = LAW["AT-9"]["knowledgeContext"]


def _use(context: dict, *, edition: str | None = None, work: str | None = None) -> dict:
    """One use of a fixture context, by its edition or (for law read live) its work."""
    return next(
        use for use in context["uses"] if (edition and use["editionId"] == edition) or (work and use["workId"] == work)
    )


OIB_2_2023 = _use(STYRIA, edition="edition:oib-rl-2-2023")
BO_WIEN = _use(VIENNA, work="work:bo-wien")


def _with(context: dict, uses: list, **gate: str) -> dict:
    """``context`` with other uses, and optionally another gate state and coverage (a derived case)."""
    changed = copy.deepcopy(context) | {"uses": uses}
    if gate:
        changed["gate"]["state"] = gate["state"]
        changed["gate"]["leaves"][0]["coverage"] = gate["state"]
    return changed


def _bind(context: dict | None) -> None:
    set_turn_knowledge_context(None if context is None else parse_knowledge_context(context))


OIB_2023 = SourceEntry(citation_key="oib-rl_2_ausgabe_mai_2023.pdf, p.5", source_type="knowledge_layer", shelf="base")


@pytest.fixture(autouse=True)
def _reset():
    _bind(None)
    yield
    _bind(None)


def test_the_roles_are_the_workspace_vocabulary():
    source = (REPO / "apps/workspace/bff/base-knowledge/wire/vocab.ts").read_text(encoding="utf-8")
    match = re.search(r"EDITION_ROLES = \[([^\]]*)\]", source)
    assert match is not None
    assert tuple(re.findall(r"'([a-z_]+)'", match.group(1))) == EDITION_ROLES


def test_every_use_the_bff_sends_is_kept():
    for land, law in LAW.items():
        assert len(parse_knowledge_context(law["knowledgeContext"]).uses) == len(law["knowledgeContext"]["uses"]), land


def test_defect_7_an_oib_2023_passage_is_guidance_in_steiermark():
    without = source_entry_to_wire(OIB_2023)
    # Without a context nothing says it binds (ADR-0175): no guess from the file name.
    assert without["binding_status"] == "unknown"
    assert "role" not in without

    _bind(STYRIA)
    wire = source_entry_to_wire(OIB_2023)
    assert wire["binding_status"] == "interpretive"
    assert wire["role"] == "guidance"
    assert wire["edition_id"] == "edition:oib-rl-2-2023"


def test_the_same_passage_is_declared_binding_in_wien():
    _bind(VIENNA)
    wire = source_entry_to_wire(OIB_2023)
    assert wire["binding_status"] == "declared_binding" and wire["role"] == "binding"


def test_without_a_context_a_passage_carries_no_binding_claim():
    wire = source_entry_to_wire(OIB_2023)
    assert wire["binding_status"] == "unknown"
    assert "role" not in wire and "binding_note" not in wire and "rank" not in wire


def test_an_office_copy_with_the_same_file_name_is_not_the_platform_edition():
    _bind(STYRIA)
    office = SourceEntry(
        citation_key="oib-rl_2_ausgabe_mai_2023.pdf, p.5", source_type="knowledge_layer", shelf="office_shelf"
    )
    assert use_for_entry(office) is None
    assert use_for_entry(OIB_2023) is not None


@pytest.mark.parametrize(
    ("role", "via", "status"),
    [
        ("binding", "territory", "binding"),
        ("binding", "relation", "declared_binding"),
        ("authority_practice", "none", "declared_binding"),
        ("guidance", "none", "interpretive"),
        ("interpretation", "none", "interpretive"),
        ("information", "none", "unknown"),
    ],
)
def test_each_role_has_the_status_the_chip_shows(role, via, status):
    context = parse_knowledge_context(_with(STYRIA, [{**OIB_2_2023, "role": role, "via": via}]))
    assert binding_status_for(context.uses[0]) == status


def test_a_malformed_use_is_dropped_never_guessed():
    context = parse_knowledge_context(_with(STYRIA, [{**OIB_2_2023, "role": "verbindlich"}, "x", OIB_2_2023]))
    assert [use.edition_id for use in context.uses] == ["edition:oib-rl-2-2023"]


def test_a_citation_follows_the_role_the_gate_corrected():
    """Architecture review: one answer to which law applies. Open coverage makes guidance information, so the
    2023 passage carries no badge, where the uncorrected chain would have called it interpretive."""
    _bind(_with(STYRIA, [{**OIB_2_2023, "role": "information"}], state="open"))
    wire = source_entry_to_wire(OIB_2023)
    assert wire["binding_status"] == "unknown" and wire["role"] == "information"


def test_an_uncurated_binding_edition_carries_its_qualifier_to_the_wire():
    uncurated = {**OIB_2_2023, "role": "binding", "via": "territory", "qualifier": "uncurated"}
    _bind(_with(STYRIA, [uncurated], state="open"))
    assert source_entry_to_wire(OIB_2023)["role_qualifier"] == "uncurated"


def test_a_gate_that_carries_no_uses_maps_every_passage_to_nothing():
    _bind(_with(STYRIA, [], state="none"))
    assert use_for_entry(OIB_2023) is None


#: The nine 2023 file names as oib.or.at publishes them; RL 2.2 alone is spelt ``oib-richtlinie_``.
PUBLISHED_2023 = [
    "oib-rl_1_ausgabe_mai_2023.pdf",
    "oib-rl_2_ausgabe_mai_2023.pdf",
    "oib-rl_2.1_ausgabe_mai_2023.pdf",
    "oib-richtlinie_2.2_ausgabe_mai_2023.pdf",
    "oib-rl_2.3_ausgabe_mai_2023.pdf",
    "oib-rl_3_ausgabe_mai_2023.pdf",
    "oib-rl_4_ausgabe_mai_2023.pdf",
    "oib-rl_5_ausgabe_mai_2023.pdf",
    "oib-rl_6_ausgabe_mai_2023.pdf",
]


def test_the_austrian_pack_names_every_2023_text_by_its_published_file_name():
    pack = json.loads((REPO / "configs/knowledge-packs/at.json").read_text(encoding="utf-8"))
    names = sorted(str(record["corpusFile"]) for record in pack["records"] if "2023" in str(record.get("corpusFile")))
    assert names == sorted(PUBLISHED_2023)


def test_a_corpus_point_finds_its_edition_by_the_id_it_was_marked_with_whatever_its_file_is_called():
    """The edition rides the point (``knowledge_edition_id``, set at ingest), so a file the publisher spelt
    another way needs no rule here: the 2023 text of part 2.2 ships under two spellings."""
    use = {
        **OIB_2_2023,
        "editionId": "edition:oib-rl-2-2-2023",
        "corpusFiles": ["oib-richtlinie_2.2_ausgabe_mai_2023.pdf"],
    }
    _bind(_with(STYRIA, [use]))
    for key in ("oib-richtlinie_2.2_ausgabe_mai_2023.pdf", "oib-rl_2.2_ausgabe_mai_2023.pdf", "any_name_at_all.pdf"):
        entry = SourceEntry(
            citation_key=f"{key}, p.3",
            source_type="knowledge_layer",
            shelf="base",
            edition_id="edition:oib-rl-2-2-2023",
        )
        found = use_for_entry(entry)
        assert found is not None and found.edition_id == "edition:oib-rl-2-2-2023"
        assert source_entry_to_wire(entry)["binding_status"] == "interpretive"


def test_a_point_that_carries_no_edition_is_found_by_the_file_its_records_name_and_by_nothing_looser():
    """The bridge for a point indexed before the mark: the records' own file name, compared whole. No
    spelling rule: another spelling of the same text waits for its mark and states no role meanwhile."""
    use = {
        **OIB_2_2023,
        "editionId": "edition:oib-rl-2-2-2023",
        "corpusFiles": ["oib-richtlinie_2.2_ausgabe_mai_2023.pdf"],
    }
    _bind(_with(STYRIA, [use]))

    def unmarked(key: str) -> SourceEntry:
        return SourceEntry(citation_key=f"{key}, p.3", source_type="knowledge_layer", shelf="base")

    assert use_for_entry(unmarked("OIB-Richtlinie_2.2_Ausgabe_Mai_2023.pdf")) is not None
    assert use_for_entry(unmarked("oib-rl_2.2_ausgabe_mai_2023.pdf")) is None


def test_an_edition_id_the_turn_does_not_carry_is_unknown_even_when_the_file_name_would_match():
    """Fail closed: the id is the answer. A point marked as an edition the site's records do not use states no
    role, and the file-name bridge is not asked instead."""
    _bind(STYRIA)
    entry = dataclasses.replace(OIB_2023, edition_id="edition:of-another-country")
    assert use_for_entry(OIB_2023) is not None
    assert use_for_entry(entry) is None
    assert source_entry_to_wire(entry)["binding_status"] == "unknown"


GESETZ_URL = "https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrW&Gesetzesnummer=20000006"


def _read_by_the_lookup(url: str, version_date: str = "") -> SourceEntry:
    """A passage as CHAT gets it: the legal-database producer's own records, read back by the citation reader.

    Built through ``format_passages`` and ``extract_sources_from_tool_result``, never by hand. For as long as
    this file built its legal-database entries by hand (with a ``url`` and deep research's tool name, a shape
    chat never produces), no chat passage of a law had a role and nothing failed: the defect this is the
    ratchet for (the citations design's G3, dev acceptance A5).
    """
    from agent.citations.extraction import extract_sources_from_tool_result
    from agent.common.grounding_block import begin_grounding_capture
    from agent.common.grounding_block import end_grounding_capture
    from agent.knowledge.law_lookup.address import Address
    from agent.knowledge.law_lookup.passages import SCORE_ADDRESSED
    from agent.knowledge.law_lookup.passages import Passage
    from agent.knowledge.law_lookup.passages import citation_for
    from agent.knowledge.law_lookup.render import format_passages
    from agent.knowledge.law_lookup.source import law_source

    law = law_source("at-ris")

    passage = Passage(
        title="Bauordnung für Wien",
        url=url,
        collection="ris/LrKons/Wien",
        clause_label="§ 63 Abs 1",
        citation=citation_for("Bauordnung für Wien", "§ 63 Abs 1", version_date, law),
        body="Dem Ansuchen um Baubewilligung sind anzuschließen …",
        score=SCORE_ADDRESSED,
        version_date=version_date,
    )
    address = Address(kind="§", number="63", subsection="1", territory="W", territory_source="the question")
    token = begin_grounding_capture()
    try:
        (entry,) = extract_sources_from_tool_result(
            "ris_lookup", format_passages([passage], None, address, law, "ris_lookup")
        )
    finally:
        end_grounding_capture(token)
    return entry


def test_a_passage_chat_s_lookup_returned_states_its_work_and_binds_by_the_records():
    """A5: the producer finds the work by the identifier the source's record reads off the document's address
    (``identifiers`` in ``configs/sources/at/ris/source.yml``) and the pack's ``sourceRefs`` carry; the role is
    then the use with that work id. Nothing is matched by URL or host in ``citations/roles``."""
    refs = BO_WIEN["sourceRefs"]
    assert {"scheme": "ris_gesetzesnummer", "value": "20000006"} in refs
    _bind(VIENNA)
    entry = _read_by_the_lookup(GESETZ_URL, version_date="14.03.2026")
    assert (entry.work_id, entry.edition_id, entry.url) == ("work:bo-wien", None, None)
    wire = source_entry_to_wire(entry)
    assert (wire["binding_status"], wire["role"]) == ("binding", "binding")
    assert wire["designation"] == BO_WIEN["designation"]
    # What a reader opens, and which Fassung the text is, as the source stated it.
    assert wire["public_url"] == GESETZ_URL
    assert wire["revision"] == {"date": "2026-03-14"}


@pytest.mark.parametrize(
    "url",
    [
        GESETZ_URL.replace("20000006", "20000099"),  # a law no record names
        GESETZ_URL.replace("20000006", "200000061"),  # the number as a prefix of another
        "https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=LrW&Dokumentnummer=LRWI_20000006_P63",
        "https://www.ris.bka.gv.at/20000006/GeltendeFassung.wxe",  # the number anywhere but where the record says
        "https://example.org/bauordnung?Gesetzesnummer=20000006",  # off the source's hosts
    ],
)
def test_a_passage_the_lookup_read_of_a_document_no_record_names_states_no_work(url):
    _bind(VIENNA)
    entry = _read_by_the_lookup(url)
    assert entry.work_id is None
    wire = source_entry_to_wire(entry)
    assert wire["binding_status"] == "unknown" and "role" not in wire


def test_an_address_decides_no_role():
    """What was matching before: a hand-built entry whose URL carries the law's number or lies within its ELI.
    An address is display; without a stated record there is no role, whatever tool read it."""
    _bind(VIENNA)
    for tool in ("ris_fetch_document", "ris_lookup", "tavily_search"):
        for url in (GESETZ_URL, "https://www.ris.bka.gv.at/eli/lgbl/WI/1930/11/P63"):
            for entry in (
                SourceEntry(url=url, title="Bauordnung für Wien", tool_name=tool),
                SourceEntry(citation_key="Bauordnung für Wien, § 63", public_url=url, tool_name=tool),
            ):
                assert use_for_entry(entry) is None


def test_a_use_without_source_refs_reads_none():
    assert parse_knowledge_context(_with(STYRIA, [OIB_2_2023])).uses[0].source_refs == ()


def test_a_malformed_source_ref_is_dropped_and_finds_no_work():
    refs = ["ris_gesetzesnummer:20000006", {"value": "20000006"}, {"scheme": "ris_gesetzesnummer"}]
    context = parse_knowledge_context(_with(VIENNA, [{**BO_WIEN, "sourceRefs": refs}]))
    assert context.uses[0].source_refs == ()
    assert use_for_source_ref(context, "ris_gesetzesnummer", "20000006") is None


def test_a_work_read_live_is_its_use_without_an_edition_and_never_a_guess_among_several():
    """A work id alone is the consolidated text in force. Where the records hold several editions of the work
    and the producer stated none, no edition is assumed."""
    live = SourceEntry(citation_key="Bauordnung für Wien, § 63", work_id="work:bo-wien")
    _bind(VIENNA)
    assert use_for_entry(live).edition_id is None
    held = [{**BO_WIEN, "editionId": "edition:bo-wien-2023"}, {**BO_WIEN, "editionId": "edition:bo-wien-2018"}]
    _bind(_with(VIENNA, held))
    assert use_for_entry(live) is None
    _bind(_with(VIENNA, held[:1]))
    assert use_for_entry(live).edition_id == "edition:bo-wien-2023"


@pytest.mark.parametrize(
    ("applicability", "status"),
    [
        (None, "binding"),
        ({"verdict": "applies", "basis": ["building_class"], "open": [], "provision": "§ 1"}, "binding"),
        ({"verdict": "check", "basis": [], "open": ["building_height"], "provision": None}, "unknown"),
        ({"verdict": "check", "basis": [], "open": [], "provision": None}, "unknown"),
        ({"verdict": "applies", "basis": [], "open": ["building_height"], "provision": None}, "unknown"),
        ({"verdict": "not_applicable", "basis": [], "open": [], "provision": None}, "unknown"),
        ({"verdict": "gilt", "basis": [], "open": [], "provision": None}, "unknown"),
        ("applies", "unknown"),
    ],
)
def test_an_edition_whose_scope_is_open_here_claims_neither_way(applicability, status):
    """ADR-0178: until a building fact is known or a person has checked the scope, the chain text says the work
    neither binds nor does not bind, and so does the chip. A use stating no scope keeps its role's status."""
    _bind(_with(VIENNA, [{**BO_WIEN, "applicability": applicability}]))
    wire = source_entry_to_wire(SourceEntry(citation_key="Bauordnung für Wien, § 63", work_id="work:bo-wien"))
    assert wire["binding_status"] == status
    assert wire["role"] == "binding"


def test_every_edition_and_law_the_austrian_records_use_gives_its_cited_passage_a_role():
    """The gate of the id mechanism, on what the packs really hold: in every Land, a corpus point marked with
    each edition the site uses, and a passage the lookup read of each law that carries a law number, resolve
    to that use (``citation-role-resolved`` at 1.0, the bar is 0.95), and to the SAME work and edition."""
    from agent.observability.citation_scores import citation_line_scores

    for land, law in LAW.items():
        context = law["knowledgeContext"]
        if not context["uses"]:
            continue
        _bind(context)
        wire, expected = [], []
        for use in context["uses"]:
            number = next((ref["value"] for ref in use["sourceRefs"] if ref["scheme"] == "ris_gesetzesnummer"), None)
            if use["editionId"]:
                entry = SourceEntry(
                    citation_key="a_file_of_any_name.pdf, p.1",
                    source_type="knowledge_layer",
                    shelf="base",
                    doc_class="law",
                    edition_id=use["editionId"],
                )
            elif number:
                entry = _read_by_the_lookup(GESETZ_URL.replace("20000006", number))
            else:
                continue
            wire.append(source_entry_to_wire(entry))
            expected.append((use["workId"], use["editionId"]))
        assert [(source.get("work_id"), source.get("edition_id")) for source in wire] == expected, land
        if not wire:  # the synthetic open country: no edition held, no law number
            assert land == "open:DE-NW"
            continue
        assert {source["kind"] for source in wire} == {"building_law"}, land
        scores = {score.name: score.value for score in citation_line_scores(wire, may_bind=True)}
        assert scores["citation-role-resolved"] == 1.0, land
