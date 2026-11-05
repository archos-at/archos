"""The engine's vocabulary, written where the agent's tests can read it without the engine.

The agent spells the engine's enums out (``agent/tools/bim/measure_vocab.py``)
so plugin discovery does not import IfcOpenShell. Its tests pin that copy, but
the agent's suite runs without the engine, so they read the names from
``fixtures/vocabulary.json`` instead. This test keeps that file the engine's
own: it fails when an enum or a tool changes, and ``UPDATE_FIXTURES=1`` rewrites it.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from ifc_spatial import tools
from ifc_spatial import tools_constants

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "vocabulary.json"


def _vocabulary() -> dict[str, object]:
    def names(value: object) -> list[str]:
        return sorted(value)  # a dict yields its keys

    return {
        "RELATIONS": names(tools_constants.RELATIONS),
        "GEOMETRIC_RELATIONS": names(tools_constants.GEOMETRIC_RELATIONS),
        "MEASURES": names(tools_constants.MEASURES),
        "KINDS": names(tools_constants.KINDS),
        "FIRE_ASPECTS": names(tools_constants.FIRE_ASPECTS),
        "ENVELOPE_ASPECTS": names(tools_constants.ENVELOPE_ASPECTS),
        "MAX_BATCH": tools_constants.MAX_BATCH,
        "TOOLS": sorted(tool.name for tool in tools.create_tools()),
    }


def test_the_fixture_is_the_engine_s_vocabulary() -> None:
    text = json.dumps(_vocabulary(), indent=2, ensure_ascii=False) + "\n"
    if os.environ.get("UPDATE_FIXTURES") == "1":
        FIXTURE.write_text(text, encoding="utf-8")
    assert FIXTURE.read_text(encoding="utf-8") == text, (
        "The engine's vocabulary changed: run with UPDATE_FIXTURES=1, then update "
        "agent/tools/bim/measure_vocab.py to match"
    )
