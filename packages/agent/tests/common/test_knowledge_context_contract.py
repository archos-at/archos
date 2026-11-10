"""The knowledge context's contract between the BFF and the agent (ADR-0175).

The BFF sends one payload for the law of a site, ``knowledgeContext``; its zod
schema is the source, exported to ``knowledge-context.schema.json``, and the
BFF's own resolver writes what an entitled Austrian office's turn carries in
every Land (``turn_law_austria.json``, ``turn-law.fixture.spec.ts``). Here the
agent's side holds both: every fixture context is what the schema allows, and
the agent's parser keeps every use of it. A field renamed on one side, an enum
the other does not know, or a parser that silently drops uses fails here
rather than in an answer.
"""

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


def test_the_fixture_covers_every_austrian_land() -> None:
    assert sorted(TURN_LAW) == [f"AT-{n}" for n in range(1, 10)]


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
    assert [use["workId"] for use in parsed.uses] == [use["workId"] for use in raw["uses"]]


def test_the_schema_refuses_a_qualifier_or_a_scheme_the_bff_never_sends() -> None:
    raw = copy.deepcopy(_context("AT-9"))
    raw["uses"][0]["qualifier"] = "decisive"
    assert not VALIDATOR.is_valid(raw)
    raw = copy.deepcopy(_context("AT-9"))
    raw["uses"][0]["sourceRefs"] = [{"scheme": "gesetzesnummer", "value": "1"}]
    assert not VALIDATOR.is_valid(raw)


def test_vienna_names_its_building_code_by_its_ris_identifiers() -> None:
    bo = next(use for use in _context("AT-9")["uses"] if use["workId"] == "work:bo-wien")
    assert {"scheme": "ris_gesetzesnummer", "value": "20000006"} in bo["sourceRefs"]
