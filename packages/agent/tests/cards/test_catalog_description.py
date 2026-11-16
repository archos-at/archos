from agent.cards.catalog import INTERACTIVE_CARD_TYPES
from agent.cards.catalog import SYSTEM_CARD_TYPES
from agent.cards.catalog import describe_card_catalog
from agent.cards.catalog import render_card_catalog
from agent.cards.models import AnswerCard

_CARD_TYPES = [getattr(c.model_fields["type"].annotation, "__args__", ("?",))[0] for c in AnswerCard.__args__]


def test_describes_every_union_member():
    described = [card["type"] for card in describe_card_catalog()["cards"]]
    assert described == _CARD_TYPES


def test_includes_system_cards_the_model_catalog_hides():
    cards = {card["type"]: card for card in describe_card_catalog()["cards"]}
    model_facing = render_card_catalog()

    for card_type in SYSTEM_CARD_TYPES:
        assert cards[card_type]["emittedBy"] == "system"
        assert f'"{card_type}"' not in model_facing

    for card_type in set(_CARD_TYPES) - SYSTEM_CARD_TYPES:
        assert cards[card_type]["emittedBy"] == "agent"


def test_flags_the_cards_that_ask_the_user_to_decide():
    cards = {card["type"]: card for card in describe_card_catalog()["cards"]}
    interactive = {t for t, card in cards.items() if card["interaction"] == "interactive"}
    assert interactive == set(INTERACTIVE_CARD_TYPES)


def test_field_specs_carry_type_requiredness_and_description():
    picker = next(c for c in describe_card_catalog()["cards"] if c["type"] == "ifc_model_picker")
    fields = {field["name"]: field for field in picker["fields"]}

    assert "type" not in fields
    assert fields["title"] == {
        "name": "title",
        "type": "string",
        "required": True,
        "description": "Short heading, e.g. 'Welches Modell möchten Sie öffnen?'",
        "constraints": ["non-empty"],
    }
    assert fields["note"]["type"] == "string"
    assert fields["note"]["required"] is False


def test_nested_shapes_are_defined_once_as_building_blocks():
    catalog = describe_card_catalog()
    blocks = catalog["buildingBlocks"]

    calculation = next(c for c in catalog["cards"] if c["type"] == "calculation")
    steps = next(f for f in calculation["fields"] if f["name"] == "steps")
    assert steps["type"] == "[CalculationStep]"
    assert "CalculationStep" in blocks

    operands = next(f for f in blocks["CalculationStep"] if f["name"] == "operands")
    assert operands["type"] == "[CalculationOperand]"
    assert "CalculationOperand" in blocks


def test_examples_come_from_the_shared_worked_examples():
    cards = {card["type"]: card for card in describe_card_catalog()["cards"]}
    assert cards["ifc_compliance"]["example"]["model_file"] == "haus-a.ifc"
    assert cards["stair_diagram"]["example"] is None


def test_summary_is_the_first_docstring_paragraph_only():
    memory_proposal = next(c for c in describe_card_catalog()["cards"] if c["type"] == "memory_proposal")
    assert memory_proposal["summary"] == ("A proposal to save a finding to long-term memory, confirmed by the user.")
