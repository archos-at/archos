"""A question that names a day reads the chain on that day, through an operation the door offers the agent.

The turn context resolves the building law on one day: today, or a filing day that has come. Asked
"welche OIB-RL 6 galt für eine Einreichung am 1. Oktober 2026?" in Eisenstadt, the agent read today's
chain, reached for the as-of operation (which reads only a work's own edition dates) and answered
"nicht bestimmbar" (dev QC run, 2026-11-12). The static prompt now names ``project-base-get`` with
``asOf`` for such a day; this holds the prompt and the door to each other.
"""

from __future__ import annotations

import json
from pathlib import Path

from agent.agents.piloti.prompt import PROMPTS_DIR
from agent.agents.piloti.prompt import STATIC_PROMPT_FILE

FIXTURES = Path(__file__).resolve().parents[5] / "apps/workspace/tests/fixtures"


def test_the_prompt_names_the_read_on_a_day_the_question_names():
    static = (PROMPTS_DIR / STATIC_PROMPT_FILE).read_text(encoding="utf-8")
    line = next(line for line in static.splitlines() if line.startswith("- Which law and edition bind at this site"))
    assert "project-base-get with asOf for a day the question names" in line


def test_the_door_offers_that_read_to_the_agent_with_its_day():
    exposure = json.loads((FIXTURES / "exposure.json").read_text(encoding="utf-8"))["operations"]
    assert exposure["project-base-get"]["agent"] is True
    catalog = json.loads((FIXTURES / "workspace/catalog.json").read_text(encoding="utf-8"))["operations"]
    described = json.loads(next(op for op in catalog if op["name"] == "project-base-get")["describe"])
    assert "asOf" in described["inputSchema"]["properties"]["query"]["properties"]
