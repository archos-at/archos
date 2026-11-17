from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator

from agent.common.knowledge_context import parse_knowledge_context

ROOT = Path(__file__).parents[4]
SCHEMA = json.loads(
    (ROOT / "apps" / "workspace" / "tests" / "fixtures" / "knowledge-context.schema.json").read_text(encoding="utf-8")
)
TURN_LAW = json.loads(
    (ROOT / "tests" / "fixtures" / "base-knowledge" / "turn_law_austria.json").read_text(encoding="utf-8")
)
VALIDATOR = Draft202012Validator({**SCHEMA, "$ref": "#/$defs/KnowledgeContext"})


def _context(land: str) -> dict[str, Any]:
    return TURN_LAW[land]["knowledgeContext"]


OPEN = "open:DE-NW"


def test_the_fixture_covers_every_austrian_land_and_an_open_country() -> None:
    assert sorted(TURN_LAW) == sorted([*(f"AT-{n}" for n in range(1, 10)), OPEN])


def test_where_coverage_is_open_law_is_uncurated_and_the_office_seat_binds_nothing_here() -> None:
    uses = {use["workId"]: use for use in _context(OPEN)["uses"]}
    assert uses["work:bauo-nrw"]["qualifier"] == "uncurated"
    assert uses["work:bauo-nrw"]["labels"] == ["uncurated_source"]
    assert uses["work:hoai"]["role"] == "information"
    assert uses["work:hoai"]["connectsBy"] == ["office_seat", "client"]


@pytest.mark.parametrize("land", sorted(TURN_LAW))
def test_every_land_s_context_is_what_the_schema_allows(land: str) -> None:
    errors = [error.message for error in VALIDATOR.iter_errors(_context(land))]
    assert errors == []


@pytest.mark.parametrize("land", sorted(TURN_LAW))
def test_the_agent_parses_every_use_and_keeps_the_gate(land: str) -> None:
    raw = _context(land)
    parsed = parse_knowledge_context(raw)
    assert parsed.gate == raw["gate"]["state"]
    assert len(parsed.uses) == len(raw["uses"])
    assert [(use.work_id, use.role, use.qualifier) for use in parsed.uses] == [
        (use["workId"], use["role"], use["qualifier"]) for use in raw["uses"]
    ]
    assert [len(use.source_refs) for use in parsed.uses] == [len(use["sourceRefs"]) for use in raw["uses"]]
    assert parsed.text == raw["text"]


def test_the_schema_refuses_a_qualifier_or_a_malformed_scheme_the_bff_never_sends() -> None:
    raw = copy.deepcopy(_context("AT-9"))
    raw["uses"][0]["qualifier"] = "decisive"
    assert not VALIDATOR.is_valid(raw)
    for scheme in ("Gesetzesnummer", "law-number", "1st"):
        raw = copy.deepcopy(_context("AT-9"))
        raw["uses"][0]["sourceRefs"] = [{"scheme": scheme, "value": "1"}]
        assert not VALIDATOR.is_valid(raw), scheme


def test_the_schema_takes_a_scheme_no_code_names() -> None:
    raw = copy.deepcopy(_context("AT-9"))
    raw["uses"][0]["sourceRefs"] = [{"scheme": "xa_gazette_number", "value": "42"}]
    assert VALIDATOR.is_valid(raw)


def test_vienna_names_its_building_code_by_its_ris_identifiers() -> None:
    bo = next(use for use in _context("AT-9")["uses"] if use["workId"] == "work:bo-wien")
    assert {"scheme": "ris_gesetzesnummer", "value": "20000006"} in bo["sourceRefs"]
