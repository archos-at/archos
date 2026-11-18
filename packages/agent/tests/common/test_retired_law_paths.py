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
    carriers = [
        path.relative_to(AGENT_ROOT)
        for pattern in ("*.md", "*.j2")
        for path in AGENT_ROOT.rglob(pattern)
        if "<building_law>\n" in path.read_text(encoding="utf-8")
    ]
    assert carriers == []


def test_no_document_class_label_claims_that_it_binds() -> None:
    from agent.knowledge.doc_class_vocabulary import DOCUMENT_CLASS_LABELS

    claims = {key: label for key, label in DOCUMENT_CLASS_LABELS.items() if "verbindlich" in label.lower()}
    assert claims == {}
