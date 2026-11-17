from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from agent.common.knowledge_context import corpus_country_allowed
from agent.common.knowledge_context import parse_knowledge_context
from agent.common.knowledge_context import set_turn_knowledge_context
from agent.common.law_gate import jurisdiction_note
from agent.common.law_gate import law_sources_withheld
from agent.common.law_gate import turn_building_law_block
from agent.common.project_facts import facts_from_project_context

CASES_FILE = Path(__file__).resolve().parents[4] / "evals" / "base-knowledge" / "edge_cases.yaml"
CASES = {case["id"]: case for case in yaml.safe_load(CASES_FILE.read_text(encoding="utf-8"))["cases"]}

VIENNA_TEXT = "PROJECT_CONTEXT v1\n\nconfirmed:\n- country=at\n- federal_state=vienna\n- building_class=4\n"
CHAIN = "Building law at this site, from the platform's reviewed records."

AGENT = {
    "E01": (False, "not included", False, False),
    "E02": (True, "open coverage", False, False),
    "E04": (False, "site not stated", False, False),
    "E28": (True, "open coverage", False, False),
    "E40": (True, "open coverage", False, False),
    "E47": (False, "the office's country is not set", False, False),
    "E-none": (False, "no base yet", False, False),
    "E-core-AT": (True, None, True, True),
}


def _wire(case: dict) -> dict:
    expect = case["expect"]
    site = case.get("site") or {}
    country = str(site.get("territoryId", "")).split("-")[0] or None
    retrieval = expect.get("retrieval", [country, "EU"] if country else [])
    leaves = [{"territoryId": site["territoryId"], "country": country}] if site else []
    return {"gate": {"state": expect["gate"], "leaves": leaves}, "retrieval": {"countries": retrieval}}


@pytest.fixture(autouse=True)
def _reset():
    yield
    set_turn_knowledge_context(None)


def test_every_case_the_agent_answers_is_in_the_file():
    assert set(AGENT) <= set(CASES)


@pytest.mark.parametrize("case_id", sorted(AGENT))
def test_the_agent_follows_the_context_alone(case_id: str):
    shows_chain, heading, ris_runs, reads_austria = AGENT[case_id]
    set_turn_knowledge_context(parse_knowledge_context({**_wire(CASES[case_id]), "text": CHAIN}))
    note = jurisdiction_note()

    assert (turn_building_law_block() == f"<building_law>\n{CHAIN}\n</building_law>") is shows_chain
    if heading is None:
        assert note is None
    else:
        assert note is not None and note.startswith("## Building law: ") and heading in note
    assert ("ris" not in law_sources_withheld()) is ris_runs
    assert corpus_country_allowed("AT") is reads_austria
    assert facts_from_project_context(VIENNA_TEXT)["federal_state"] == "vienna"
