import pytest

from agent.cards.catalog import CHAT_ONLY_CARD_TYPES
from agent.cards.catalog import MODEL_BACKED_CARD_TYPES
from agent.cards.catalog import render_card_catalog
from agent.cards.catalog import render_card_doctrine
from agent.cards.catalog import render_card_index
from agent.cards.prompt import build_card_generation_prompt
from agent.cards.register import _build_tool_description


class TestBuildCardGenerationPrompt:
    def test_returns_string(self):
        assert isinstance(build_card_generation_prompt(), str)

    def test_contains_card_type_values(self):
        prompt = build_card_generation_prompt()
        assert '"calculation"' in prompt
        assert '"stair_diagram"' in prompt

    def test_contains_card_type_descriptions(self):
        prompt = build_card_generation_prompt()
        assert "A staircase drawn to scale" in prompt

    def test_expands_nested_building_blocks(self):
        prompt = build_card_generation_prompt()
        assert "DimensionCheck = {" in prompt
        assert "NormReference = {" in prompt
        assert "needs_input" in prompt

    def test_includes_worked_examples(self):
        prompt = build_card_generation_prompt()
        assert "Worked examples" in prompt
        assert "daylight_incidence" in prompt

    def test_asks_for_cards_object_wrapper(self):
        assert '{"cards":' in build_card_generation_prompt()

    def test_does_not_dump_raw_json_schema(self):
        prompt = build_card_generation_prompt()
        assert "$defs" not in prompt
        assert "$ref" not in prompt


class TestCatalogSharedAcrossSurfaces:
    def test_the_tool_embeds_the_card_index(self):
        description = _build_tool_description()
        assert render_card_index(exclude=CHAT_ONLY_CARD_TYPES) in description
        assert render_card_catalog() not in description

    def test_the_tool_teaches_the_shape_on_the_RETRY_rather_than_in_advance(self):
        description = _build_tool_description()
        assert "describe_card" not in description
        assert "the error hands you that type's full shape and a worked example" in description
        assert "never a reason to skip a card the answer called for" in description

    def test_post_hoc_generation_embeds_the_catalog_minus_the_model_cards(self):
        catalog = render_card_catalog(include_model_backed=False, exclude=CHAT_ONLY_CARD_TYPES)
        assert catalog in build_card_generation_prompt()

    def test_post_hoc_generation_is_not_shown_a_card_it_cannot_fill(self):
        prompt = build_card_generation_prompt()
        for card_type in MODEL_BACKED_CARD_TYPES:
            assert f'"{card_type}"' not in prompt, card_type
            assert f"  {card_type}:" not in prompt, card_type

    def test_the_tool_still_is(self):
        tool = _build_tool_description()
        for card_type in MODEL_BACKED_CARD_TYPES:
            assert f'"{card_type}"' in tool, card_type

    def test_the_withheld_set_is_real(self):
        from agent.cards.models import AnswerCard

        real = {getattr(card.model_fields["type"].annotation, "__args__", ("?",))[0] for card in AnswerCard.__args__}
        assert sorted(MODEL_BACKED_CARD_TYPES - real) == []


class TestTheDoctrineReachesThePostHocPath:
    def test_the_trigger_table_is_rendered(self):
        prompt = build_card_generation_prompt()
        assert "WHEN TO EMIT ONE" in prompt
        assert "a riser, tread or stair width" in prompt
        assert "-> stair_diagram" in prompt
        assert "key_takeaways" not in prompt
        assert "-> callout" not in prompt

    def test_the_negative_default_survives(self):
        prompt = build_card_generation_prompt()
        assert "WHEN NOT TO" in prompt
        assert "two the ceiling" in prompt
        assert "Never fabricate a field, a reference or a number" in prompt

    def test_the_volume_rule_is_stated_once_across_the_two_blocks(self):
        prompt = build_card_generation_prompt()
        assert prompt.count("two the ceiling") == 1
        assert "Two content cards is the ceiling and one is often right" not in prompt

    def test_the_retired_card_reaches_this_path_nowhere(self):
        prompt = build_card_generation_prompt()
        assert "follow_ups" not in prompt
        assert "closes a subject-matter answer by default" not in prompt
        assert "WHERE THEY GO" in prompt
        assert "the substance the report turns on first" in prompt

    def test_both_surfaces_render_the_one_doctrine(self):
        assert render_card_doctrine() in _build_tool_description()
        assert render_card_doctrine(include_ifc_triggers=False, include_craft=False) in build_card_generation_prompt()


class TestWhatThePostHocPathIsNotToldToDo:
    def test_the_placement_contract_is_withheld(self):
        prompt = build_card_generation_prompt()
        assert "[[card:" not in prompt
        assert "WHERE IT GOES" not in prompt

    def test_ordering_replaces_it(self):
        prompt = build_card_generation_prompt()
        assert "in the order you list them" in prompt

    def test_describe_card_is_not_offered(self):
        assert "describe_card" not in build_card_generation_prompt()

    def test_the_model_picker_trigger_is_withheld_but_not_its_shape(self):
        prompt = build_card_generation_prompt()
        assert "ifc_model_picker" not in MODEL_BACKED_CARD_TYPES
        assert '"ifc_model_picker"' in prompt  # the shape, from the catalog
        assert "zeig mir das Modell" not in prompt
        assert "-> ifc_model_picker" not in prompt


class TestNothingOnACardWasInvented:
    def test_the_grounding_rule_leads(self):
        prompt = build_card_generation_prompt()
        assert "WHAT A CARD MAY BE BUILT OUT OF" in prompt
        assert "traceable to a sentence in the text you were given" in prompt
        assert "never fabricate" in prompt
        assert "never estimate" in prompt
        assert prompt.index("WHAT A CARD MAY BE BUILT OUT OF") < prompt.index("Card types:")

    def test_it_forbids_the_two_post_hoc_specific_moves(self):
        prompt = build_card_generation_prompt()
        assert "never complete a half-stated one from your own" in prompt
        assert "never sharpen a hedged statement" in prompt


class TestTheCraftThatCouldNotBeInherited:
    def test_the_shared_craft_is_not_paid_here(self):
        prompt = build_card_generation_prompt()
        assert "there is no result field" not in prompt
        assert "-> calculation" in prompt
        assert "WHICH ONE EARNS ITS PLACE" in prompt

    def test_the_generic_cards_carry_their_test(self):
        prompt = build_card_generation_prompt()
        assert "WHICH ONE EARNS ITS PLACE" in prompt
        assert "a number the report WORKED OUT" in prompt
        assert "verdict_header" not in prompt
        assert "A second callout" not in prompt

    def test_a_table_in_the_report_is_already_the_reader_s(self):
        prompt = build_card_generation_prompt()
        assert "already the reader's" in prompt
        assert prompt.startswith("You are") and "MARKDOWN FIRST" in prompt

    def test_the_skill_body_itself_is_not_inlined(self):
        prompt = build_card_generation_prompt()
        assert "Welche Karte eine gewöhnliche Antwort besser macht" not in prompt
        assert "Löschen Sie gedanklich alle Karten" not in prompt


class TestTheFramingStaysAffordable:
    MAX_FRAMING_TOKENS = 1_700

    def test_the_framing_stays_under_the_ceiling(self):
        tiktoken = pytest.importorskip("tiktoken")
        encoding = tiktoken.get_encoding("cl100k_base")

        total = len(encoding.encode(build_card_generation_prompt()))
        catalog = len(encoding.encode(render_card_catalog(include_model_backed=False)))
        framing = total - catalog

        assert framing <= self.MAX_FRAMING_TOKENS, (
            f"The post-hoc prompt's framing is {framing} tokens, over the {self.MAX_FRAMING_TOKENS} "
            "ceiling. The trigger doctrine is shared and measured on the other surface; what is "
            "capped here is what this module adds around it. Craft that only the answering agents "
            "need belongs in the `piloti-cards` skill, not in this prompt."
        )
