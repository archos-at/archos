import typing

import pytest
from pydantic import ValidationError

from agent.cards.card_model import CardModel
from agent.cards.card_model import flatten_card_markup
from agent.cards.models import AnswerCard
from agent.cards.models import answer_card_adapter
from agent.cards.models import validate_cards
from agent.cards.proposal_cards import MemoryProposalCard


class TestMemoryProposalCard:
    def test_validates_with_defaults(self):
        card = MemoryProposalCard(
            type="memory_proposal",
            title="Save this finding?",
            content="The client requires all facades to be non-combustible.",
            kind="constraint",
        )
        assert card.confidence == "medium"

    def test_carries_the_topic_the_note_is_filed_under(self):
        card = MemoryProposalCard(
            type="memory_proposal",
            title="Save this finding?",
            content="Alle Fassaden sind nicht brennbar.",
            kind="constraint",
            topic="Brandschutz",
        )
        assert card.topic == "Brandschutz"

    def test_a_topic_longer_than_the_shelf_keeps_is_refused(self):
        with pytest.raises(ValidationError):
            MemoryProposalCard(
                type="memory_proposal",
                title="Save this finding?",
                content="Alle Fassaden sind nicht brennbar.",
                kind="constraint",
                topic="T" * 41,
            )

    def test_adapter_routes_type(self):
        raw = {
            "type": "memory_proposal",
            "title": "Save this finding?",
            "content": "The firm always uses REI 90 for GK4.",
            "kind": "preference",
            "confidence": "high",
        }
        validated = answer_card_adapter.validate_python(raw)
        assert isinstance(validated, MemoryProposalCard)
        assert validated.kind == "preference"
        assert validated.confidence == "high"

    def test_validate_cards_drops_it_as_a_model_fabrication(self):
        raw = [
            {
                "type": "memory_proposal",
                "title": "Save this finding?",
                "content": "The site is in a Schutzzone.",
                "kind": "derived_fact",
            }
        ]
        assert validate_cards(raw) == []
        assert answer_card_adapter.validate_python(raw[0]).confidence == "medium"


class TestValidateCards:
    def test_drops_unknown_card_type(self):
        raw = [{"type": "unknown_type", "title": "Unknown"}]
        assert validate_cards(raw) == []

    def test_drops_card_missing_required_field(self):
        raw = [{"type": "calculation"}]
        assert validate_cards(raw) == []

    def test_keeps_valid_cards_and_drops_invalid_in_same_batch(self):
        raw = [
            {"type": "ifc_model_picker", "title": "Good"},
            {"type": "ifc_model_picker"},  # missing required title -> dropped
            {"type": "ifc_model_picker", "title": "Also good", "note": "Ein Klick öffnet das Modell."},
        ]
        result = validate_cards(raw)
        assert result == [
            {"type": "ifc_model_picker", "title": "Good"},
            {"type": "ifc_model_picker", "title": "Also good", "note": "Ein Klick öffnet das Modell."},
        ]

    def test_drops_none_fields(self):
        raw = [{"type": "ifc_model_picker", "title": "Welches Modell?", "note": None}]
        result = validate_cards(raw)
        assert result == [{"type": "ifc_model_picker", "title": "Welches Modell?"}]


class TestIfcViewerHighlightSelectors:
    def _card(self, highlight: dict) -> list[dict]:
        return validate_cards(
            [
                {
                    "type": "ifc_viewer",
                    "title": "Außenwände EG",
                    "model_file": "haus-a.ifc",
                    "highlights": [highlight],
                }
            ]
        )

    def test_a_filter_is_carried_through_untouched(self):
        [card] = self._card(
            {
                "match": {
                    "ifc_types": ["IfcWall"],
                    "storeys": ["Erdgeschoss"],
                    "properties": [{"set": "Pset_WallCommon", "name": "IsExternal", "value": True}],
                },
                "label": "Außenwände",
                "status": "info",
            }
        )
        match = card["highlights"][0]["match"]
        assert match["ifc_types"] == ["IfcWall"]
        assert match["properties"][0]["name"] == "IsExternal"
        assert match["properties"][0]["operator"] == "eq"

    def test_an_id_list_still_works_for_the_few_elements_an_answer_names(self):
        [card] = self._card({"global_ids": ["1kTvXnbbzCWw8lcMd1dR4o"], "label": "T-14", "status": "fail"})
        assert card["highlights"][0]["global_ids"] == ["1kTvXnbbzCWw8lcMd1dR4o"]

    def test_a_group_with_neither_selector_is_refused(self):
        assert self._card({"label": "Außenwände", "status": "info"}) == []

    def test_a_group_with_both_is_refused(self):
        assert (
            self._card(
                {
                    "global_ids": ["1kTvXnbbzCWw8lcMd1dR4o"],
                    "match": {"ifc_types": ["IfcWall"]},
                    "label": "Außenwände",
                    "status": "info",
                }
            )
            == []
        )

    def test_a_filter_copied_from_ifc_query_is_not_silently_emptied(self):
        [card] = self._card(
            {
                "match": {"ifcTypes": ["IfcWall"], "nameContains": "AW", "classification": "B.1.2"},
                "label": "Außenwände",
                "status": "info",
            }
        )
        match = card["highlights"][0]["match"]
        assert match["ifc_types"] == ["IfcWall"]
        assert match["name_contains"] == "AW"
        assert match["classification"] == "B.1.2"

    def test_an_empty_match_object_is_refused(self):
        assert self._card({"match": {}, "label": "Außenwände", "status": "info"}) == []


class TestAMeasuredNumberCarriesWhereItCameFrom:
    def test_the_three_provenances_are_the_engine_s_own(self):
        from agent.cards.schematic_cards import DimensionCheck

        field = DimensionCheck.model_fields["provenance"]
        assert set(typing.get_args(typing.get_args(field.annotation)[0])) == {
            "declared",
            "computed",
            "inferred",
        }

    def test_a_measured_dimension_keeps_its_band(self):
        from agent.cards.schematic_cards import DimensionCheck

        check = DimensionCheck(
            label="lichte Raumhöhe",
            value=2.47,
            required=2.50,
            unit="m",
            comparator=">=",
            status="fail",
            provenance="computed",
            tolerance=0.005,
        )
        assert check.provenance == "computed"
        assert check.tolerance == 0.005

    def test_all_three_are_optional_because_not_every_number_comes_from_a_model(self):
        from agent.cards.schematic_cards import DimensionCheck

        check = DimensionCheck(label="Mindestbreite laut OIB", required=80, unit="cm", status="needs_input")
        assert check.provenance is None
        assert check.tolerance is None
        assert check.missing is None

    def test_a_negative_band_is_refused(self):
        import pytest as _pytest

        from agent.cards.schematic_cards import DimensionCheck

        with _pytest.raises(ValidationError):
            DimensionCheck(label="x", value=1.0, status="pass", provenance="computed", tolerance=-0.1)

    def test_the_remedy_survives_onto_the_card(self):
        from agent.cards.schematic_cards import DimensionCheck

        check = DimensionCheck(
            label="lichte Durchgangsbreite",
            value=None,
            status="needs_input",
            missing="Die Tür trägt kein IfcOpeningElement mit Geometrie — im CAD als Öffnung modellieren.",
        )
        assert "im CAD" in (check.missing or "")


class TestTheCatalogTellsTheModelToCopyNotGuess:
    def test_the_measured_note_is_in_the_catalog_body(self):
        from agent.cards.catalog import render_card_catalog

        body = render_card_catalog()
        assert "ifc_measure" in body
        assert "provenance" in body and "tolerance" in body
        assert "never infer them" in body
        assert "missing.remedy" in body


class TestTheCalculationCardCannotStateItsOwnAnswer:
    def _schrittmass(self) -> dict:
        return {
            "type": "calculation",
            "title": "Schrittmaßregel – Treppenlauf Haus A",
            "steps": [
                {
                    "label": "Schrittmaß",
                    "operation": "sum",
                    "unit": "cm",
                    "operands": [
                        {"label": "Steigung", "value": 17.0, "unit": "cm", "factor": 2},
                        {"label": "Auftritt", "value": 30.0, "unit": "cm"},
                    ],
                }
            ],
            "limit": {"comparator": "between", "value": 59, "upper": 65},
        }

    def test_no_field_anywhere_lets_the_model_state_a_result(self):
        from agent.cards.calculation_card import CalculationCard
        from agent.cards.calculation_card import CalculationLimit
        from agent.cards.calculation_card import CalculationStep

        for model in (CalculationCard, CalculationStep, CalculationLimit):
            assert not {"result", "value", "total", "outcome"} & set(model.model_fields) - {"value"}
        assert "value" not in CalculationStep.model_fields
        assert "value" not in CalculationCard.model_fields

    def test_a_stated_result_does_not_survive_validation(self):
        raw = self._schrittmass()
        raw["steps"][0]["result"] = 999.0
        [card] = validate_cards([raw])
        assert "result" not in card["steps"][0], "a model-supplied result must not reach the renderer"

    def test_the_five_operations_are_the_whole_vocabulary(self):
        from agent.cards.calculation_card import CalculationStep

        operation = CalculationStep.model_fields["operation"].annotation
        assert set(typing.get_args(operation)) == {"sum", "product", "quotient", "percent_of", "percent_ratio"}

    def test_the_fixed_arity_operations_reject_a_third_operand(self):
        for operation in ("quotient", "percent_of", "percent_ratio"):
            raw = self._schrittmass()
            raw["steps"][0]["operation"] = operation
            raw["steps"][0]["operands"].append({"label": "Drittes", "value": 1.0})
            assert validate_cards([raw]) == [], operation

    def test_a_factor_belongs_only_to_a_sum(self):
        raw = self._schrittmass()
        raw["steps"][0]["operation"] = "product"
        assert validate_cards([raw]) == []

    def test_a_step_reference_must_point_backwards(self):
        raw = self._schrittmass()
        raw["steps"][0]["operands"][0] = {"label": "Rges", "step": 1}
        assert validate_cards([raw]) == [], "a self reference has no value to read"

        forward = self._schrittmass()
        forward["steps"][0]["operands"][0] = {"label": "Rges", "step": 2}
        assert validate_cards([forward]) == []

    def test_a_reference_carries_no_value_of_its_own(self):
        raw = self._schrittmass()
        raw["steps"].append(
            {
                "label": "U-Wert",
                "operation": "quotient",
                "operands": [{"label": "", "value": 1.0}, {"label": "Rges", "step": 1, "value": 4.0}],
            }
        )
        assert validate_cards([raw]) == []

    def test_a_bare_constant_may_go_unlabelled_but_a_quantity_may_not(self):
        from agent.cards.calculation_card import CalculationOperand

        assert CalculationOperand.model_fields["label"].is_required()
        assert CalculationOperand(label="", value=1.0).label == ""

    def test_a_two_step_derivation_chains_by_reference(self):
        raw = {
            "type": "calculation",
            "title": "U-Wert Außenwand",
            "steps": [
                {
                    "label": "Wärmedurchgangswiderstand",
                    "operation": "sum",
                    "unit": "m²K/W",
                    "operands": [
                        {"label": "Rsi", "value": 0.13, "unit": "m²K/W"},
                        {"label": "Dämmung", "value": 3.5, "unit": "m²K/W"},
                    ],
                },
                {
                    "label": "U-Wert",
                    "operation": "quotient",
                    "unit": "W/(m²K)",
                    "operands": [{"label": "", "value": 1.0}, {"label": "Rges", "step": 1}],
                },
            ],
        }
        [card] = validate_cards([raw])
        assert card["steps"][1]["operands"][1]["step"] == 1

    def test_a_range_limit_needs_both_bounds_the_right_way_round(self):
        for limit in (
            {"comparator": "between", "value": 59},
            {"comparator": "between", "value": 65, "upper": 59},
            {"comparator": "<=", "value": 65, "upper": 70},
        ):
            raw = self._schrittmass()
            raw["limit"] = limit
            assert validate_cards([raw]) == [], limit

    def test_the_worked_example_round_trips(self):
        from agent.cards.card_examples import CARD_EXAMPLES

        card = answer_card_adapter.validate_python(CARD_EXAMPLES["calculation"])
        assert card.type == "calculation"
        measured = [operand for operand in card.steps[0].operands if operand.provenance == "computed"]
        assert measured and measured[0].tolerance == 2.0

    def test_render_card_details_spells_out_the_nested_blocks(self):
        from agent.cards.catalog import render_card_details

        detail = render_card_details(["calculation"])
        assert '"calculation"' in detail
        assert "CalculationStep = {" in detail
        assert "CalculationOperand = {" in detail
        assert "CalculationLimit = {" in detail


class TestBothNewCardsAreInTheDoctrineAndNotInTheCraft:
    def test_the_craft_is_not_paid_for_on_every_turn(self):
        from agent.cards.register import _CARD_DOCTRINE

        assert "Ziviltechniker" not in _CARD_DOCTRINE
        assert "renderer" not in _CARD_DOCTRINE


class TestCardTextIsPlainText:
    def test_the_shipped_defect_reaches_the_card_as_text(self):
        card = answer_card_adapter.validate_python(
            {
                "type": "ifc_model_picker",
                "title": "Modell",
                "note": "Details: [OIB-Richtlinie ansehen](https://www.oib.or.at/de/oib-richtlinien)",
            }
        )
        assert card.note == "Details: OIB-Richtlinie ansehen (https://www.oib.or.at/de/oib-richtlinien)"

    def test_the_url_survives_as_text_rather_than_being_dropped(self):
        card = answer_card_adapter.validate_python(
            {"type": "ifc_model_picker", "title": "X", "note": "siehe [§ 3](https://ris.bka.gv.at/x)"}
        )
        assert "https://ris.bka.gv.at/x" in card.note
        assert "[" not in card.note
        assert "](" not in card.note

    def test_doubled_emphasis_and_code_spans_lose_their_delimiters(self):
        card = answer_card_adapter.validate_python(
            {"type": "ifc_model_picker", "title": "**OIB-Richtlinie 2**", "note": "Mindestens `REI 90`."}
        )
        assert card.title == "OIB-Richtlinie 2"
        assert card.note == "Mindestens REI 90."

    def test_single_character_emphasis_is_left_alone(self):
        excerpt = "Die Anforderung *) gilt sinngemäß für Anlage_1."
        card = answer_card_adapter.validate_python({"type": "ifc_model_picker", "title": "X", "note": excerpt})
        assert card.note == excerpt

    def test_it_is_the_class_and_not_just_one_card(self):
        card = answer_card_adapter.validate_python(
            {
                "type": "building_section",
                "title": "**Schnitt**",
                "storeys": [{"label": "`EG`", "height_m": 3.0}],
                "reference": {"document": "Siehe [RIS](https://ris.bka.gv.at)"},
            }
        )
        assert card.title == "Schnitt"
        assert card.storeys[0].label == "EG"
        assert card.reference.document == "Siehe RIS (https://ris.bka.gv.at)"

    def test_every_card_type_inherits_the_guarantee(self):
        for card_cls in AnswerCard.__args__:
            assert issubclass(card_cls, CardModel), card_cls.__name__

    def test_flattening_is_idempotent_and_leaves_plain_text_untouched(self):
        plain = "OIB-Richtlinie 2, Ausgabe Mai 2023 — § 3 Abs. 1 (Brandschutz)."
        assert flatten_card_markup(plain) == plain
        once = flatten_card_markup("[a](https://x) **b** `c`")
        assert flatten_card_markup(once) == once
