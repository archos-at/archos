"""The old ways of deciding which law applies stay gone (ADR-0175).

Each module below once decided, beside the knowledge context, which country's law a turn read or
whether a source binds: from a host regex, a filename, the project's own text, a hand-written verdict
table, or a static block every turn read. Bringing one back would make two sources of the same
answer again, and the old one always guessed Austria.
"""

from __future__ import annotations

import importlib
from pathlib import Path

import pytest

AGENT_ROOT = Path(__file__).resolve().parents[2] / "src" / "agent"

RETIRED = (
    "agent.citations.binding",
    "agent.common.country_profile",
    "agent.common.applicability",
    "agent.turn.building_law",
)


@pytest.mark.parametrize("module", RETIRED)
def test_a_retired_module_cannot_be_imported(module: str) -> None:
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module(module)


def test_no_prompt_file_carries_a_building_law_block() -> None:
    """The chain text in the turn context is the only building law a turn reads, rendered in code."""
    carriers = [
        path.relative_to(AGENT_ROOT)
        for pattern in ("*.md", "*.j2")
        for path in AGENT_ROOT.rglob(pattern)
        if "<building_law>\n" in path.read_text(encoding="utf-8")
    ]
    assert carriers == []
