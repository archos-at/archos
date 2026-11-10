"""Roles from the knowledge context decide a cited edition's status (ADR-0168, ADR-0175).

With the turn's knowledge context bound, an OIB-RL 2:2023 passage is guidance in
Steiermark (where 2019 binds) and declared binding in Wien, and a RIS passage
takes the role of the edition whose records name its identity. Without a
context nothing binds: every source is ``unknown``. The context is the turn's
one answer to which law applies, so a citation follows the role the gate
corrected (open coverage, freshness, connecting factor), never a second list.
"""

from __future__ import annotations

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

REPO = Path(__file__).resolve().parents[4]


def _context(text: str, leaf: str, uses: list[dict], coverage: str = "core") -> dict:
    """A turn context's ``knowledgeContext`` as the BFF sends it, for a site at ``leaf``."""
    return {
        "gate": {"state": coverage, "reason": None, "leaves": [{"country": "AT", "coverage": coverage}]},
        "chains": {leaf: [leaf, "AT", "EU"]},
        "date": "2026-11-10",
        "retrieval": {"countries": ["AT"]},
        "text": text,
        "uses": uses,
    }


def _bind(context: dict | None) -> None:
    set_turn_knowledge_context(None if context is None else parse_knowledge_context(context))


STYRIA = _context(
    "Building law at this site, Steiermark (AT-6, AT, EU) …",
    "AT-6",
    [
        {
            "workId": "work:oib-rl-2",
            "editionId": "edition:oib-rl-2-2019",
            "role": "binding",
            "qualifier": None,
            "via": "relation",
            "corpusFiles": [],
            "designation": "OIB-Richtlinie 2",
            "editionLabel": "Ausgabe April 2019",
        },
        {
            "workId": "work:oib-rl-2",
            "editionId": "edition:oib-rl-2-2023",
            "role": "guidance",
            "qualifier": None,
            "via": "none",
            "corpusFiles": ["oib-rl_2_ausgabe_mai_2023.pdf"],
            "designation": "OIB-Richtlinie 2",
            "editionLabel": "Ausgabe Mai 2023",
        },
    ],
)

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


def test_without_a_context_a_passage_carries_no_binding_claim():
    _bind(None)
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
    context = parse_knowledge_context({**STYRIA, "uses": [{**STYRIA["uses"][1], "role": role, "via": via}]})
    assert binding_status_for(context.uses[0]) == status


def test_a_malformed_use_is_dropped_never_guessed():
    context = parse_knowledge_context(
        {**STYRIA, "uses": [{**STYRIA["uses"][1], "role": "verbindlich"}, "x", STYRIA["uses"][0]]}
    )
    assert [use.edition_id for use in context.uses] == ["edition:oib-rl-2-2019"]


def test_a_citation_follows_the_role_the_gate_corrected():
    """Architecture review: one answer to which law applies. Open coverage makes guidance information, so the
    2023 passage carries no badge, where the uncorrected chain would have called it interpretive."""
    corrected = {**STYRIA["uses"][1], "role": "information"}
    _bind(_context(STYRIA["text"], "AT-6", [corrected], coverage="open"))
    wire = source_entry_to_wire(OIB_2023)
    assert wire["binding_status"] == "unknown" and wire["role"] == "information"


def test_an_uncurated_binding_edition_carries_its_qualifier_to_the_wire():
    uncurated = {**STYRIA["uses"][1], "role": "binding", "via": "territory", "qualifier": "uncurated"}
    _bind(_context(STYRIA["text"], "AT-6", [uncurated], coverage="open"))
    assert source_entry_to_wire(OIB_2023)["role_qualifier"] == "uncurated"


def test_a_gate_that_carries_no_uses_maps_every_passage_to_nothing():
    _bind(_context("", "AT-6", [], coverage="none"))
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


@pytest.mark.parametrize("published", ["oib-richtlinie_2.2_ausgabe_mai_2023.pdf", "OIB-RL_2.2_Ausgabe_Mai_2023.pdf"])
def test_a_published_spelling_finds_its_edition_on_either_side(published):
    use = {**STYRIA["uses"][1], "editionId": "edition:oib-rl-2-2-2023", "corpusFiles": [published]}
    _bind({**STYRIA, "uses": [use]})
    for key in ("oib-richtlinie_2.2_ausgabe_mai_2023.pdf", "oib-rl_2.2_ausgabe_mai_2023.pdf"):
        entry = SourceEntry(citation_key=f"{key}, p.3", source_type="knowledge_layer", shelf="base")
        found = use_for_entry(entry)
        assert found is not None and found.edition_id == "edition:oib-rl-2-2-2023"
        assert source_entry_to_wire(entry)["binding_status"] == "interpretive"


VIENNA_BO = _context(
    "Building law at this site, Wien (AT-9, AT, EU) …",
    "AT-9",
    [
        {
            "workId": "work:bo-wien",
            "editionId": None,
            "role": "binding",
            "qualifier": None,
            "via": "territory",
            "corpusFiles": [],
            "designation": "BO für Wien",
            "sourceRefs": [
                {"scheme": "eli", "value": "https://www.ris.bka.gv.at/eli/lgbl/wi/1930/11"},
                {"scheme": "ris_gesetzesnummer", "value": "20000006"},
            ],
        }
    ],
)


def _ris(url: str, tool: str = "ris_fetch_document") -> SourceEntry:
    return SourceEntry(url=url, title="Bauordnung für Wien", tool_name=tool)


@pytest.mark.parametrize(
    "url",
    [
        "https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrW&Gesetzesnummer=20000006",
        "https://www.ris.bka.gv.at/eli/lgbl/wi/1930/11/P63",
    ],
)
def test_a_ris_passage_takes_the_role_of_the_edition_whose_records_name_it(url):
    """Coordinator's decision: the Wiener Bauordnung keeps its binding badge, from the records."""
    _bind(VIENNA_BO)
    wire = source_entry_to_wire(_ris(url))
    assert wire["binding_status"] == "binding"
    assert wire["role"] == "binding"


def test_a_ris_passage_no_record_names_is_unknown():
    _bind(VIENNA_BO)
    wire = source_entry_to_wire(
        _ris("https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrW&Gesetzesnummer=20000099")
    )
    assert wire["binding_status"] == "unknown" and "role" not in wire


@pytest.mark.parametrize(
    "url",
    [
        "https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrW&Gesetzesnummer=200000061",
        "https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=LrW&Dokumentnummer=LRWI_20000006_P63",
        "https://www.ris.bka.gv.at/20000006/GeltendeFassung.wxe",
    ],
)
def test_a_law_number_matches_only_as_the_ris_url_s_query_parameter(url):
    _bind(VIENNA_BO)
    assert use_for_entry(_ris(url)) is None


def test_a_document_number_matches_as_a_whole_token():
    ref = {"scheme": "ris_dokumentnummer", "value": "LRWI_40000007"}
    _bind({**VIENNA_BO, "uses": [{**VIENNA_BO["uses"][0], "sourceRefs": [ref]}]})
    assert use_for_entry(_ris("https://www.ris.bka.gv.at/Dokument.wxe?Dokumentnummer=LRWI_40000007")) is not None
    assert use_for_entry(_ris("https://www.ris.bka.gv.at/Dokument.wxe?Dokumentnummer=LRWI_400000071")) is None


def test_a_web_page_carrying_a_ris_number_is_not_matched():
    """Only a passage read through the legal database takes a role by its identity."""
    _bind(VIENNA_BO)
    assert use_for_entry(_ris("https://example.org/bauordnung?Gesetzesnummer=20000006", tool="tavily_search")) is None


def test_a_use_without_source_refs_reads_none():
    assert parse_knowledge_context(STYRIA).uses[0].source_refs == ()


def test_an_unknown_scheme_or_a_bare_value_never_matches():
    refs = [{"scheme": "gesetz", "value": "20000006"}, "ris_gesetzesnummer:20000006", {"value": "20000006"}]
    _bind({**VIENNA_BO, "uses": [{**VIENNA_BO["uses"][0], "sourceRefs": refs}]})
    assert (
        use_for_entry(_ris("https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrW&Gesetzesnummer=20000006")) is None
    )


def test_an_eli_matches_as_the_url_s_prefix_only():
    _bind(VIENNA_BO)
    assert use_for_entry(_ris("https://www.ris.bka.gv.at/eli/lgbl/wi/1930/11/P63")) is not None
    assert use_for_entry(_ris("https://example.org/?u=https://www.ris.bka.gv.at/eli/lgbl/wi/1930/11")) is None
