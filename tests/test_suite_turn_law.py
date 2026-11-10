"""The answer suite's turns carry the law of their Land, as production's do since ADR-0175.

A turn without a knowledge context reads no building law, so a suite whose fixture BFF sent none
would measure fail-closed answers and call them a regression. The fixture is the production
resolvers' output from the packs (``suite-turn-law.fixture.spec.ts``); this holds the Python half:
the agent reads it as an entitled Austrian office's turn, in every Land.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts" / "turn_census"))

import fixture_law  # noqa: E402

from agent.citations.roles import parse_building_law  # noqa: E402
from agent.common.knowledge_context import parse_knowledge_context  # noqa: E402


@pytest.mark.parametrize("state", sorted(fixture_law.TERRITORY_OF_STATE))
def test_every_land_reads_as_core_austria_with_its_chain(state: str) -> None:
    territory = fixture_law.territory_of(state)
    data = fixture_law.with_law({"data": {"projectContext": None}}, {"facts": {"federal_state": state}})["data"]

    context = parse_knowledge_context(data["knowledgeContext"])
    law = parse_building_law(data["buildingLaw"])

    assert context.gate == "core" and not context.withholds_law
    assert "AT" in context.retrieval_countries
    assert law is not None and law.chain[0] == territory
    assert data["projectContext"] is None


def test_a_question_with_no_land_sits_in_vienna() -> None:
    assert fixture_law.territory_of(None) == "AT-9"


def test_the_norm_set_runs_behind_a_fixture_bff_that_sends_the_law(tmp_path: Path) -> None:
    import suite

    bff, env_for = fixture_law.start_law_bff(tmp_path, suite.precedent_envelope)
    try:
        env = env_for("conv-1", {"id": "q"})
        status, answer = bff._answer("/api/internal/turn-context", {}, bff.office, "conv-1")
    finally:
        bff.stop()
    assert status == 200
    assert parse_knowledge_context(answer["data"]["knowledgeContext"]).gate == "core"
    assert env["FRONTEND_INTERNAL_URL"] == bff.url and env["EVAL_ENVELOPE"]
