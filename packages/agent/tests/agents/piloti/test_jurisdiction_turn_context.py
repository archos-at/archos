"""Where the project is decides what Austrian law the turn context presents (design A1, defects 1, 2, 6).

A German, Swiss or other project got the OIB verdicts and nothing that said its
own law was not covered; a project whose site nothing states was treated as
Austrian. The turn context now carries a jurisdiction note for those, and the
OIB block only for a project placed in Austria. An Austrian project's context
gains nothing but the binding OIB edition of its Land.
"""

from __future__ import annotations

import pytest
from langchain_core.messages import HumanMessage

from agent.agents.piloti import prompt as prompt_module
from agent.agents.piloti.models import ResearchAgentState
from agent.agents.piloti.prompt import render_turn_prompt
from agent.agents.piloti.prompt import system_prompt_template
from agent.common.prompt_store import PromptStore

FACTS = "- main_use=residential\n- building_class=4\n- parking_relevant=true\n- allotment_garden_area=true"


@pytest.fixture(autouse=True)
def _bundled_prompt(monkeypatch):
    monkeypatch.setattr(prompt_module, "prompt_store", lambda: PromptStore(enabled=False))


def _context(placing: str) -> str:
    state = ResearchAgentState(
        messages=[HumanMessage(content="Welche Anforderungen gelten für das Stiegenhaus?")],
        project_context=f"PROJECT_CONTEXT v1\n\nconfirmed:\n{placing}{FACTS}\n",
    )
    return render_turn_prompt(system_prompt_template(), state, [{"name": "knowledge_search"}]).context


@pytest.mark.parametrize("placing", ["- country=de\n", "- country=ch\n", "- country=other\n", "- federal_state=outside_austria\n"])
def test_a_project_abroad_gets_no_austrian_law_and_is_told_so(placing):
    context = _context(placing)
    assert "not covered" in context
    assert "OIB 1 —" not in context
    assert "Wiener" not in context
    assert "OIB edition" not in context


def test_an_unplaced_project_gets_no_verdicts_and_is_asked_for_its_site():
    context = _context("")
    assert "site not stated" in context
    assert "OIB 1 —" not in context


def test_an_austrian_project_keeps_its_block_and_reads_no_note():
    context = _context("- federal_state=tyrol\n")
    assert "OIB 1 — required —" in context
    assert "OIB edition binding in Tirol" in context
    assert "Jurisdiction:" not in context
    # Tirol is not Wien: no Viennese law.
    assert "Wiener" not in context


def test_vienna_still_names_its_own_laws():
    context = _context("- federal_state=vienna\n")
    assert "Wiener Kleingartengesetz" in context
    assert "Wiener Garagengesetz" in context
