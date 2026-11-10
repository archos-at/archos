"""Roles from the platform's records decide a cited edition's status (ADR-0168).

With the turn's building law bound, an OIB-RL 2:2023 passage is guidance in
Steiermark (where 2019 binds) and declared binding in Wien; without it, every
source keeps exactly the status ``citations/binding.py`` gave it.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from agent.citations.entries import SourceEntry
from agent.citations.roles import EDITION_ROLES
from agent.citations.roles import binding_status_for
from agent.citations.roles import parse_building_law
from agent.citations.roles import set_turn_building_law
from agent.citations.roles import use_for_entry
from agent.citations.wire import source_entry_to_wire

REPO = Path(__file__).resolve().parents[4]

STYRIA = {
    "text": "Building law at this site, Steiermark (AT-6, AT, EU) …",
    "chain": ["AT-6", "AT", "EU"],
    "date": "2026-11-10",
    "uses": [
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
}

OIB_2023 = SourceEntry(citation_key="oib-rl_2_ausgabe_mai_2023.pdf, p.5", source_type="knowledge_layer", shelf="base")


@pytest.fixture(autouse=True)
def _reset():
    set_turn_building_law(None)
    yield
    set_turn_building_law(None)


def test_the_roles_are_the_workspace_vocabulary():
    source = (REPO / "apps/workspace/bff/base-knowledge/wire/vocab.ts").read_text(encoding="utf-8")
    match = re.search(r"EDITION_ROLES = \[([^\]]*)\]", source)
    assert match is not None
    assert tuple(re.findall(r"'([a-z_]+)'", match.group(1))) == EDITION_ROLES


def test_defect_7_an_oib_2023_passage_is_guidance_in_steiermark():
    without = source_entry_to_wire(OIB_2023)
    # Without the records nothing says it binds (ADR-0175): no guess from the file name.
    assert without["binding_status"] == "unknown"
    assert "role" not in without

    set_turn_building_law(parse_building_law(STYRIA))
    wire = source_entry_to_wire(OIB_2023)
    assert wire["binding_status"] == "interpretive"
    assert wire["role"] == "guidance"
    assert wire["edition_id"] == "edition:oib-rl-2-2023"


def test_without_the_records_a_passage_carries_no_binding_claim():
    set_turn_building_law(None)
    wire = source_entry_to_wire(OIB_2023)
    assert wire["binding_status"] == "unknown"
    assert "role" not in wire and "binding_note" not in wire and "rank" not in wire


def test_an_office_copy_with_the_same_file_name_is_not_the_platform_edition():
    set_turn_building_law(parse_building_law(STYRIA))
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
    law = parse_building_law({**STYRIA, "uses": [{**STYRIA["uses"][1], "role": role, "via": via}]})
    assert law is not None
    assert binding_status_for(law.uses[0]) == status


def test_a_malformed_building_law_or_use_is_dropped_never_guessed():
    assert parse_building_law(None) is None
    assert parse_building_law({"text": "x"}) is None
    law = parse_building_law({**STYRIA, "uses": [{**STYRIA["uses"][1], "role": "verbindlich"}, "x", STYRIA["uses"][0]]})
    assert law is not None
    assert [use.edition_id for use in law.uses] == ["edition:oib-rl-2-2019"]


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
    set_turn_building_law(parse_building_law({**STYRIA, "uses": [use]}))
    for key in ("oib-richtlinie_2.2_ausgabe_mai_2023.pdf", "oib-rl_2.2_ausgabe_mai_2023.pdf"):
        entry = SourceEntry(citation_key=f"{key}, p.3", source_type="knowledge_layer", shelf="base")
        found = use_for_entry(entry)
        assert found is not None and found.edition_id == "edition:oib-rl-2-2-2023"
        assert source_entry_to_wire(entry)["binding_status"] == "interpretive"
