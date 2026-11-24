import pytest

from agent.cards.card_doctrine import _CARD_HONESTY
from agent.cards.card_doctrine import _CARD_RESTRAINT
from agent.cards.card_doctrine import _CARD_TRIGGER_HEAD
from agent.cards.card_doctrine import _CARD_TRIGGERS
from agent.cards.card_doctrine import _MODEL_PICKER_NOTE
from agent.cards.card_doctrine import _MODEL_PICKER_ROW
from agent.cards.card_doctrine import render_card_doctrine
from agent.cards.catalog import CHAT_ONLY_CARD_TYPES
from agent.cards.catalog import INTERACTIVE_CARD_TYPES
from agent.cards.catalog import SYSTEM_CARD_TYPES
from agent.cards.catalog import _interactive_note
from agent.cards.catalog import model_facing_card_types
from agent.cards.catalog import render_card_catalog
from agent.cards.catalog import render_card_details
from agent.cards.catalog import render_card_index
from agent.cards.models import AnswerCard
from agent.cards.models import answer_card_adapter
from agent.cards.register import _CARD_EXAMPLES
from agent.cards.register import _build_tool_description
from agent.cards.register import _shape_hint_for
from agent.cards.retired_cards import RETIRED_CARD_TYPES

_CARD_TYPES = [getattr(c.model_fields["type"].annotation, "__args__", ("?",))[0] for c in AnswerCard.__args__]


_EXAMPLE_EXEMPT = {
    "ifc_schedule",
    "ifc_element",
    "ifc_diff",
    "stair_diagram",
    "dimension_diagram",
    "setback_plan",
    "egress_diagram",
    "guardrail_check",
    "fire_access_plan",
    "memory_proposal",
    "document_grid",
    "document_draft",
    "file_operation_proposal",
    "operation_proposal",
    "task_created",
    "canvas_activity",
    "look",
    "revision_compare",
}


class TestWorkedExamples:
    @pytest.mark.parametrize("card_type", list(_CARD_EXAMPLES))
    def test_example_validates(self, card_type):
        answer_card_adapter.validate_python(_CARD_EXAMPLES[card_type])

    def test_every_card_type_has_example_or_is_exempt(self):
        documented = set(_CARD_EXAMPLES) | _EXAMPLE_EXEMPT
        missing = [t for t in _CARD_TYPES if t not in documented]
        assert not missing, f"New card type(s) need a worked example or an _EXAMPLE_EXEMPT entry: {missing}"


class TestModelFacingCardTypes:
    def test_is_the_union_minus_system_cards(self):
        assert model_facing_card_types() == set(_CARD_TYPES) - SYSTEM_CARD_TYPES
        assert model_facing_card_types().isdisjoint(SYSTEM_CARD_TYPES | RETIRED_CARD_TYPES)


class TestToolDescription:
    def test_returns_string(self):
        assert isinstance(_build_tool_description(), str)

    def test_several_cards_are_one_call(self):
        desc = _build_tool_description()
        assert "Several cards are one call: pass a JSON array of card objects." in desc
        assert "one call each" not in desc
        assert "several times" not in desc
        assert "same round" not in render_card_doctrine()

    def test_lists_every_card_type(self):
        desc = _build_tool_description()
        for card_type in _CARD_TYPES:
            if card_type in SYSTEM_CARD_TYPES | CHAT_ONLY_CARD_TYPES:
                continue
            assert f'"{card_type}"' in desc

    def test_system_cards_are_not_advertised(self):
        desc = _build_tool_description()
        for card_type in SYSTEM_CARD_TYPES:
            assert f'"{card_type}"' not in desc
        assert "memory_proposal" not in desc

    def test_expands_nested_building_blocks_on_demand(self):
        detail = render_card_details(["daylight_incidence"])
        assert "DimensionCheck = {" in detail
        assert "NormReference = {" in detail
        assert "needs_input" in detail  # enum options surfaced

    def test_includes_worked_examples_on_demand(self):
        detail = render_card_details(["daylight_incidence"])
        assert "Worked examples" in detail
        assert "daylight_incidence" in detail

    def test_the_index_names_every_card_without_its_shape(self):
        desc = _build_tool_description()
        assert '"daylight_incidence"' in desc
        assert "DimensionCheck = {" not in desc
        assert "Worked examples" not in desc

    def test_says_the_fields_are_plain_text_wherever_the_shapes_are_shown(self):
        for shown in (render_card_details(["calculation"]), render_card_catalog()):
            assert "Every text field is PLAIN TEXT" in shown
            assert "no [text](url) links" in shown
        assert "PLAIN TEXT" not in render_card_doctrine()
        assert "PLAIN TEXT" not in render_card_index()

    def test_flags_cards_that_ask_the_user_to_confirm(self):
        desc = _build_tool_description()
        assert "Cards that ask the user to CONFIRM something" in desc
        for card_type in INTERACTIVE_CARD_TYPES - SYSTEM_CARD_TYPES:
            assert f'"{card_type}"' in desc
        assert "At most one per turn" in desc


class TestTheDoctrineStaysCalibrated:
    MIN_RESTRAINT_RATIO = 1.15
    MAX_RESTRAINT_RATIO = 1.75

    @staticmethod
    def _polarity() -> tuple[int, int]:
        import tiktoken

        encoding = tiktoken.get_encoding("cl100k_base")
        count = lambda text: len(encoding.encode(text))  # noqa: E731

        head = _CARD_TRIGGER_HEAD
        picker_invitation = _MODEL_PICKER_NOTE.split("It renders")[0]

        invitation = count(head) + count(picker_invitation)
        restraint = count(_CARD_RESTRAINT) + count(_interactive_note())
        return invitation, restraint

    def test_the_doctrine_sits_inside_its_calibration_band(self):
        pytest.importorskip("tiktoken")
        invitation, restraint = self._polarity()
        ratio = restraint / invitation

        assert self.MIN_RESTRAINT_RATIO <= ratio <= self.MAX_RESTRAINT_RATIO, (
            f"The always-on card doctrine reads {ratio:.2f} : 1 restraint to invitation "
            f"(invitation {invitation} tokens, restraint {restraint}), outside the "
            f"{self.MIN_RESTRAINT_RATIO}–{self.MAX_RESTRAINT_RATIO} band. Below the band the "
            "doctrine reads as an obligation and buys cards that restate the prose beside them "
            "(charter anti-goal D.8); above it, it reads as a disclaimer and specific cards stop "
            "being emitted at all. Moving this band is a decision about the fleet's emission rate "
            "and needs a field observation behind it, not a rewording."
        )

    def test_a_trigger_match_is_a_reason_and_not_an_obligation(self):
        doctrine = render_card_doctrine()
        assert "is a reason to" in doctrine
        assert "carries more than the sentence beside it" in doctrine
        assert "IS a card, by default" not in doctrine
        assert "Not emitting on a match is" not in doctrine
        assert "one failure mode" not in doctrine

    def test_the_naming_clause_converts_recognition_into_emission(self):
        doctrine = render_card_doctrine()
        assert "Naming the card IS the decision" in doctrine
        assert "not a second judgement" in doctrine

    def test_markdown_carries_what_the_retired_cards_carried(self):
        doctrine = render_card_doctrine()
        assert doctrine.startswith("MARKDOWN FIRST.")
        assert "trifft zu" in doctrine and "> „…“ [N]" in doctrine
        assert render_card_doctrine(include_ifc_triggers=False, include_craft=False).startswith("MARKDOWN FIRST.")
        assert "is a restatement: keep the prose" in _CARD_RESTRAINT

    def test_every_craft_row_names_its_card_and_says_it_once(self):
        doctrine = render_card_doctrine()
        flat = " ".join(doctrine.split())
        crafted = [(card, craft) for _, card, craft in (*_CARD_TRIGGERS, _MODEL_PICKER_ROW) if craft]
        assert crafted, "the doctrine carries no craft at all; the tool no longer owns its contract"

        for card, craft in crafted:
            assert f"-> {card}" in doctrine, card
            said = flat.count(" ".join(craft.split()))
            assert said == 1, f"{card}: craft stated {said} times"

        crafted_types = {card for card, _ in crafted}
        for card in ("calculation", "setback_plan", "dimension_diagram"):
            assert card in crafted_types, card

    def test_the_craft_comes_off_when_the_surface_cannot_act_on_it(self):
        rows_only = render_card_doctrine(include_craft=False)
        assert "-> calculation" in rows_only
        assert "there is no result field" not in rows_only
        assert "there is no result field" in render_card_doctrine()

    def test_the_default_is_not_scoped_to_one_class_of_card(self):
        doctrine = render_card_doctrine()
        assert "An answer that turns on a dimension gets its card by default" not in doctrine

    def test_the_specific_cards_keep_their_own_imperative_in_the_always_on_index(self):
        index = render_card_index()
        assert '"calculation": Emit for' in index
        for card_type in RETIRED_CARD_TYPES:
            assert f'"{card_type}"' not in index

    def test_the_anti_fabrication_rule_stands_apart_and_outranks_the_triggers(self):
        doctrine = render_card_doctrine()
        assert "Never fabricate a field, a reference or a number" in _CARD_HONESTY
        assert "outranks every trigger" in _CARD_HONESTY
        assert "needs_input" in _CARD_HONESTY
        assert "never" in _CARD_HONESTY and "estimated" in _CARD_HONESTY
        assert "fabricate" not in _CARD_RESTRAINT
        assert doctrine.count("Never fabricate a field") == 1

    def test_the_volume_rule_reads_as_a_ceiling(self):
        assert "ceiling" in _CARD_RESTRAINT
        assert "there to be SPENT" not in _CARD_RESTRAINT
        assert "budget" not in _CARD_RESTRAINT
        assert "none the normal case" in _CARD_RESTRAINT

    def test_looking_a_shape_up_is_not_framed_as_a_cost(self):
        desc = _build_tool_description()
        assert "never a reason to skip a card" in desc
        assert "guessing the nesting wastes a turn" not in desc


class TestShapeHint:
    @pytest.mark.parametrize("card_type", sorted(model_facing_card_types()))
    def test_the_hint_is_what_describe_card_returns(self, card_type):
        hint = _shape_hint_for(card_type)
        assert hint is not None
        assert card_type in hint
        assert hint == render_card_details([card_type])
        if card_type in CHAT_ONLY_CARD_TYPES:
            return  # a surface's entry is the COMPOSE rule (test_surface_card.py)
        assert "shape:" in hint
        assert "Every text field is PLAIN TEXT" in hint

    def test_the_hint_carries_the_worked_example_where_there_is_one(self):
        hint = _shape_hint_for("daylight_incidence")
        assert "Worked examples" in hint
        assert '"type": "daylight_incidence"' in hint

    def test_hint_expands_referenced_blocks(self):
        hint = _shape_hint_for("daylight_incidence")
        assert "DimensionCheck = {" in hint
        assert "NormReference = {" in hint

    def test_unknown_type_returns_none(self):
        assert _shape_hint_for("not_a_real_card") is None

    @pytest.mark.parametrize("card_type", sorted(SYSTEM_CARD_TYPES | RETIRED_CARD_TYPES))
    def test_a_card_the_model_may_not_emit_is_taught_no_shape(self, card_type):
        assert _shape_hint_for(card_type) is None


class TestTheDescriptionStaysAffordable:
    MAX_TOKENS = 2_900

    def test_the_tool_description_stays_under_the_ceiling(self):
        tiktoken = pytest.importorskip("tiktoken")
        encoding = tiktoken.get_encoding("cl100k_base")

        cost = len(encoding.encode(_build_tool_description()))

        assert cost <= self.MAX_TOKENS, (
            f"emit_card's description is {cost} tokens, over the {self.MAX_TOKENS} ceiling. "
            "Every turn pays this whether or not a card is emitted. If you added a card type, "
            "its trigger line AND its craft belong in `cards.card_doctrine._CARD_TRIGGERS`, together — "
            "so what to cut is prose that repeats what another row already says, never the craft "
            "moved back out into a prompt where nothing counts it."
        )
