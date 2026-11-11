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


@pytest.mark.parametrize("published", ["oib-richtlinie_2.2_ausgabe_mai_2023.pdf", "OIB-RL_2.2_Ausgabe_Mai_2023.pdf"])
def test_a_published_spelling_finds_its_edition_on_either_side(published):
    use = {**OIB_2_2023, "editionId": "edition:oib-rl-2-2-2023", "corpusFiles": [published]}
    _bind(_with(STYRIA, [use]))
    for key in ("oib-richtlinie_2.2_ausgabe_mai_2023.pdf", "oib-rl_2.2_ausgabe_mai_2023.pdf"):
        entry = SourceEntry(citation_key=f"{key}, p.3", source_type="knowledge_layer", shelf="base")
        found = use_for_entry(entry)
        assert found is not None and found.edition_id == "edition:oib-rl-2-2-2023"
        assert source_entry_to_wire(entry)["binding_status"] == "interpretive"


def _ris(url: str, tool: str = "ris_fetch_document") -> SourceEntry:
    return SourceEntry(url=url, title="Bauordnung für Wien", tool_name=tool)


#: How a RIS passage of a work carries each identity: what the legal-database tools return as its URL.
RIS_URLS = {
    "ris_gesetzesnummer": lambda value: [
        f"https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrW&Gesetzesnummer={value}"
    ],
    "eli": lambda value: [f"{value.rstrip('/')}/P63", f"{value.rstrip('/').replace('://www.', '://')}/P63"],
}


def test_a_ris_passage_of_the_wiener_bauordnung_binds_by_the_records_the_bff_sends():
    """Coordinator's decision: the Wiener Bauordnung keeps its binding badge, from the records. Every identity
    the generated context carries finds it (the ELI with the host either way RIS spells it), and it carries
    its Gesetzesnummer at least."""
    refs = BO_WIEN["sourceRefs"]
    assert {"scheme": "ris_gesetzesnummer", "value": "20000006"} in refs
    _bind(VIENNA)
    for ref in refs:
        for url in RIS_URLS[ref["scheme"]](ref["value"]):
            wire = source_entry_to_wire(_ris(url))
            assert (wire["binding_status"], wire["role"]) == ("binding", "binding"), url


def test_a_ris_passage_no_record_names_is_unknown():
    _bind(VIENNA)
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
    _bind(_with(VIENNA, [{**BO_WIEN, "sourceRefs": [{"scheme": "ris_gesetzesnummer", "value": "20000006"}]}]))
    assert use_for_entry(_ris(url)) is None


def test_a_retired_document_number_scheme_never_matches():
    """``ris_dokumentnummer`` left the wire (#1584): it only ever matched one paragraph."""
    ref = {"scheme": "ris_dokumentnummer", "value": "LWI40000225"}
    _bind(_with(VIENNA, [{**BO_WIEN, "sourceRefs": [ref]}]))
    assert use_for_entry(_ris("https://www.ris.bka.gv.at/Dokument.wxe?Dokumentnummer=LWI40000225")) is None


def test_a_web_page_carrying_a_ris_number_is_not_matched():
    """Only a passage read through the legal database takes a role by its identity."""
    _bind(VIENNA)
    assert use_for_entry(_ris("https://example.org/bauordnung?Gesetzesnummer=20000006", tool="tavily_search")) is None


def test_a_use_without_source_refs_reads_none():
    assert parse_knowledge_context(_with(STYRIA, [OIB_2_2023])).uses[0].source_refs == ()


def test_an_unknown_scheme_or_a_bare_value_never_matches():
    refs = [{"scheme": "gesetz", "value": "20000006"}, "ris_gesetzesnummer:20000006", {"value": "20000006"}]
    _bind(_with(VIENNA, [{**BO_WIEN, "sourceRefs": refs}]))
    assert (
        use_for_entry(_ris("https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrW&Gesetzesnummer=20000006")) is None
    )


@pytest.mark.parametrize(
    "eli", ["https://www.ris.bka.gv.at/eli/lgbl/WI/1930/11", "https://www.ris.bka.gv.at/eli/lgbl/WI/1930/11/"]
)
def test_an_eli_matches_by_whole_path_segments_only(eli):
    """``…/1930/11`` is the Bauordnung; ``…/1930/110`` is another law of 1930 and gets no badge from it."""
    _bind(_with(VIENNA, [{**BO_WIEN, "sourceRefs": [{"scheme": "eli", "value": eli}]}]))
    assert use_for_entry(_ris("https://www.ris.bka.gv.at/eli/lgbl/WI/1930/11/P63")) is not None
    assert use_for_entry(_ris("https://www.ris.bka.gv.at/eli/lgbl/WI/1930/11")) is not None
    assert use_for_entry(_ris("https://www.ris.bka.gv.at/eli/lgbl/WI/1930/110")) is None
    assert use_for_entry(_ris("https://www.ris.bka.gv.at/eli/lgbl/WI/1930/110/P1")) is None
    assert use_for_entry(_ris("https://example.org/?u=https://www.ris.bka.gv.at/eli/lgbl/WI/1930/11")) is None


GESETZ_URL = "https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrW&Gesetzesnummer=20000006"


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
    wire = source_entry_to_wire(_ris(GESETZ_URL))
    assert wire["binding_status"] == status
    assert wire["role"] == "binding"
