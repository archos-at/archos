from __future__ import annotations

import json

from agent.cards.catalog import CARD_EXAMPLES
from agent.cards.envelope import ENVELOPE_SHAPE_TYPES
from agent.cards.envelope import REFUSED_NOT_AN_OBJECT
from agent.cards.envelope import REFUSED_RETIRED_TYPE
from agent.cards.envelope import REFUSED_SHAPE
from agent.cards.envelope import REFUSED_SYSTEM_TYPE
from agent.cards.envelope import envelope_card_objects
from agent.cards.envelope import render_envelope_cards_contract
from agent.cards.envelope import validate_model_card

BASIS = CARD_EXAMPLES["calculation"]


class TestTheOneValidator:
    def test_a_sound_card_validates_to_its_dump(self):
        validated, refusal = validate_model_card(BASIS)
        assert refusal is None
        assert validated is not None and validated["type"] == "calculation"

    def test_a_shape_miss_names_the_type_the_clauses_and_the_full_shape(self):
        validated, refusal = validate_model_card({"type": "stair_diagram", "title": "Treppe", "riser_count": 17})
        assert validated is None
        assert refusal is not None and refusal.kind == REFUSED_SHAPE
        assert refusal.card_type == "stair_diagram"
        assert "riser_height" in refusal.detail
        assert refusal.hint and "stair_diagram" in refusal.hint
        assert "errors.pydantic.dev" not in refusal.for_repair()
        assert refusal.for_repair().startswith("card of type 'stair_diagram' failed validation:")

    def test_a_system_card_is_refused_whatever_its_fields(self):
        validated, refusal = validate_model_card(
            {"type": "document_grid", "title": "fake", "documents": [{"file_name": "x.pdf"}]}
        )
        assert validated is None
        assert refusal is not None and refusal.kind == REFUSED_SYSTEM_TYPE

    def test_a_retired_type_reached_for_as_a_card_names_what_replaced_it(self):
        validated, refusal = validate_model_card({"type": "summary", "title": "t", "content": "c"})
        assert validated is None
        assert refusal is not None and refusal.kind == REFUSED_RETIRED_TYPE
        assert "`summary` field of your ```answer_json envelope" in refusal.message

    def test_a_non_object_is_refused_by_kind(self):
        validated, refusal = validate_model_card("calculation")
        assert validated is None
        assert refusal is not None and refusal.kind == REFUSED_NOT_AN_OBJECT


class TestTheArrayTheModelWrites:
    def test_objects_pass_through_and_json_strings_are_parsed(self):
        objects = envelope_card_objects([BASIS, json.dumps(BASIS)])
        assert objects == [BASIS, BASIS]

    def test_a_string_that_is_not_json_stays_a_string_to_be_refused_by_name(self):
        assert envelope_card_objects(["not json"]) == ["not json"]

    def test_nothing_is_nothing(self):
        assert envelope_card_objects(None) == []


class TestTheTaughtContract:
    def test_it_carries_the_doctrine_the_index_and_the_shapes(self):
        contract = render_envelope_cards_contract()
        assert "MARKDOWN FIRST" in contract
        assert "WHEN TO EMIT ONE" in contract
        assert "WHEN NOT TO" in contract
        assert "Card types:" in contract
        for card_type in ENVELOPE_SHAPE_TYPES:
            assert f'"{card_type}"' in contract or f"{card_type}:" in contract
        assert '"stair_diagram":' in contract
        assert "Steigung" not in contract.split('"stair_diagram":')[1].split("\n")[0]
        assert contract.count("Example:") <= len(ENVELOPE_SHAPE_TYPES) + 1

    def test_it_states_the_placement_rule_once(self):
        contract = render_envelope_cards_contract()
        assert contract.count("[[card:N]]") == 1
        assert "continue after the highest one" in contract

    def test_the_envelope_schema_teaches_the_field(self):
        from agent.common.answer_envelope import render_envelope_schema

        schema = render_envelope_schema()
        assert "cards: [" in schema
        assert "CARDS (the `cards` field):" in schema

    def test_the_strict_schema_omits_the_field_it_cannot_express(self):
        from agent.common.answer_envelope import render_envelope_response_format

        properties = render_envelope_response_format()["json_schema"]["schema"]["properties"]
        assert "cards" not in properties
        assert "answer" in properties and "verdict" in properties


class TestTheRenderedShapeIsTheValidatedShape:
    def test_the_card_discriminator_is_not_rendered_as_a_field(self):
        from agent.cards.catalog import shape_hint_for

        hint = shape_hint_for("stair_diagram") or ""
        assert "shape: { type" not in hint

    def test_a_card_written_from_the_worked_example_validates(self):
        for card_type, example in CARD_EXAMPLES.items():
            validated, refusal = validate_model_card(example)
            assert refusal is None or refusal.kind == REFUSED_SYSTEM_TYPE, card_type
