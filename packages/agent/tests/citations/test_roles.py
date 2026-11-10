"""Roles from the platform's records decide a cited edition's status (ADR-0168).

With the turn's building law bound, an OIB-RL 2:2023 passage is guidance in
Steiermark (where 2019 binds) and declared binding in Wien; without it, every
source keeps exactly the status ``citations/binding.py`` gave it.
"""

from __future__ import annotations

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
    # Positive control: the guess calls it binding everywhere.
    assert without["binding_status"] == "declared_binding"
    assert "role" not in without

    set_turn_building_law(parse_building_law(STYRIA))
    wire = source_entry_to_wire(OIB_2023)
    assert wire["binding_status"] == "interpretive"
    assert wire["role"] == "guidance"
    assert wire["edition_id"] == "edition:oib-rl-2-2023"


def test_without_the_records_the_wire_is_byte_for_byte_what_it_was():
    before = source_entry_to_wire(OIB_2023)
    set_turn_building_law(None)
    assert source_entry_to_wire(OIB_2023) == before


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
