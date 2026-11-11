"""A formula card is stamped with which editions bind at the turn's site, and the model cannot stamp it.

The card's bounds are transcribed from one edition of each rule (``formulas.ts``). It may give a verdict
only where that edition binds at the site and the gate is settled; elsewhere it shows a hint. Which
edition binds is the knowledge context's answer, so the server stamps it while the card validates
(``FormulaCard.site_binding``) and the browser compares it with the edition its values come from. Fed by
what the BFF really sends: ``tests/fixtures/base-knowledge/turn_law_austria.json``.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from agent.cards.catalog import render_card_details
from agent.cards.envelope import validate_model_card
from agent.common.knowledge_context import parse_knowledge_context
from agent.common.knowledge_context import set_turn_knowledge_context

REPO = Path(__file__).resolve().parents[4]
LAW = json.loads((REPO / "tests/fixtures/base-knowledge/turn_law_austria.json").read_text(encoding="utf-8"))
#: The work the U-value rule's bound is written in, as the browser names it (``formulas.ts``, ``FORMULA_SOURCES``).
U_VALUE_WORK = "OIB-Richtlinie 6"

U_VALUE_CARD = {
    "type": "formula",
    "title": "U-Wert Außenwand AW 01",
    "formula": {
        "name": "u_value",
        "component": "external_wall",
        "measure": "new_build",
        "layers": [{"label": "Stahlbeton", "thickness": {"value": 20}, "conductivity": {"value": 2.3}}],
    },
}


@pytest.fixture(autouse=True)
def _unbound():
    set_turn_knowledge_context(None)
    yield
    set_turn_knowledge_context(None)


def _bind(territory: str, *, gate: str | None = None) -> None:
    raw = copy.deepcopy(LAW[territory]["knowledgeContext"])
    if gate is not None:
        raw["gate"]["state"] = gate
    set_turn_knowledge_context(parse_knowledge_context(raw))


def _stamp(card: dict) -> dict:
    validated, refusal = validate_model_card(card)
    assert refusal is None, refusal
    return validated["site_binding"]


def _edition(stamp: dict, designation: str) -> str | None:
    return next(entry for entry in stamp["editions"] if entry["designation"] == designation).get("edition_label")


def test_where_a_later_edition_binds_the_card_learns_which_and_that_the_gate_is_settled():
    _bind("AT-9")
    stamp = _stamp(U_VALUE_CARD)
    assert stamp["settled"] is True
    assert _edition(stamp, U_VALUE_WORK) == "Ausgabe September 2025"


def test_where_the_card_s_own_edition_binds_it_learns_that_too():
    _bind("AT-2")
    stamp = _stamp(U_VALUE_CARD)
    assert stamp["settled"] is True
    assert _edition(stamp, U_VALUE_WORK) == "Ausgabe Mai 2023"


@pytest.mark.parametrize("gate", ["none", "open", "site_unknown"])
def test_a_gate_that_is_not_settled_is_stamped_unsettled(gate):
    _bind("AT-2", gate=gate)
    assert _stamp(U_VALUE_CARD)["settled"] is False


def test_what_the_model_writes_is_replaced_and_outside_a_turn_nothing_is_stamped():
    forged = {**U_VALUE_CARD, "site_binding": {"settled": True, "editions": [{"designation": U_VALUE_WORK}]}}
    validated, _ = validate_model_card(forged)
    assert "site_binding" not in validated
    _bind("AT-9")
    assert _edition(_stamp(forged), U_VALUE_WORK) == "Ausgabe September 2025"


def test_a_formula_leaf_of_a_surface_is_stamped_as_well():
    _bind("AT-9")
    leaf = {key: value for key, value in U_VALUE_CARD.items() if key != "type"}
    surface = {
        "type": "surface",
        "components": [
            {"id": "root", "component": "Tabs", "tabs": [{"title": "A", "child": "a"}, {"title": "B", "child": "b"}]},
            {"id": "a", "component": "formula", **leaf, "site_binding": {"settled": True, "editions": []}},
            {"id": "b", "component": "Text", "text": "Variante B"},
        ],
    }
    validated, refusal = validate_model_card(surface)
    assert refusal is None, refusal
    formula = next(component for component in validated["components"] if component["id"] == "a")
    assert _edition(formula["site_binding"], U_VALUE_WORK) == "Ausgabe September 2025"


def test_the_model_is_never_taught_the_stamp():
    assert "site_binding" not in render_card_details(["formula"])
