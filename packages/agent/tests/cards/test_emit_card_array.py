import json
from unittest.mock import MagicMock

from agent.cards.catalog import CARD_EXAMPLES
from agent.cards.register import EmitCardConfig
from agent.cards.register import emit_card
from agent.cards.registry import CardRegistry
from agent.cards.registry import reset_card_registry
from agent.cards.registry import set_card_registry

PICKER = {"type": "ifc_model_picker", "title": "Treppe"}
BASIS = CARD_EXAMPLES["calculation"]


async def _emit(registry: CardRegistry, payload) -> str:
    token = set_card_registry(registry)
    try:
        async with emit_card(EmitCardConfig(), MagicMock()) as info:
            return await info.single_fn(card_json=json.dumps(payload))
    finally:
        reset_card_registry(token)


class TestAnArrayRegistersEveryCard:
    async def test_two_valid_cards_register_as_two_and_come_back_as_two_markers(self):
        registry = CardRegistry()

        message = await _emit(registry, [PICKER, BASIS])

        assert [card["type"] for card in registry.snapshot()] == ["ifc_model_picker", "calculation"]
        assert "[[card:1]]" in message
        assert "[[card:2]]" in message
        assert message.index("[[card:1]]") < message.index("[[card:2]]")
        assert "line of its own" in message

    async def test_the_positions_continue_the_turn_s_registry(self):
        registry = CardRegistry()

        await _emit(registry, PICKER)
        message = await _emit(registry, [BASIS, PICKER])

        assert len(registry) == 3
        assert "[[card:2]]" in message
        assert "[[card:3]]" in message
        assert "[[card:1]]" not in message

    async def test_an_array_of_one_is_an_array(self):
        registry = CardRegistry()

        message = await _emit(registry, [PICKER])

        assert len(registry) == 1
        assert "[[card:1]]" in message


class TestARefusedElementNamesItself:
    async def test_the_valid_card_registers_and_the_refusal_carries_index_and_type(self):
        registry = CardRegistry()

        message = await _emit(registry, [PICKER, {"type": "stair_diagram", "title": "Treppe"}])

        assert [card["type"] for card in registry.snapshot()] == ["ifc_model_picker"]
        assert "[[card:1]]" in message
        assert "Card at index 1 (type 'stair_diagram')" in message
        assert "failed validation" in message

    async def test_a_system_card_in_an_array_is_refused_like_one_on_its_own(self):
        registry = CardRegistry()

        message = await _emit(
            registry,
            [{"type": "memory_proposal", "title": "X", "content": "Y", "kind": "preference"}, BASIS],
        )

        assert [card["type"] for card in registry.snapshot()] == ["calculation"]
        assert "Card at index 0 (type 'memory_proposal')" in message
        assert "system-emitted" in message

    async def test_an_element_that_is_not_an_object_is_named_by_its_index(self):
        registry = CardRegistry()

        message = await _emit(registry, [PICKER, "calculation"])

        assert len(registry) == 1
        assert "Card at index 1 (type 'str')" in message

    async def test_every_element_refused_comes_back_as_refusals_alone(self):
        registry = CardRegistry()

        message = await _emit(registry, [{"type": "stair_diagram"}, {"type": "calculation"}])

        assert registry.snapshot() == []
        assert "Card at index 0 (type 'stair_diagram')" in message
        assert "Card at index 1 (type 'calculation')" in message
        assert "[[card:" not in message

    async def test_an_empty_array_says_so(self):
        registry = CardRegistry()

        message = await _emit(registry, [])

        assert message.startswith("Error")
        assert registry.snapshot() == []


class TestTheSingleObjectPathIsUnchanged:
    async def test_a_bare_object_still_registers_and_still_says_card_one(self):
        registry = CardRegistry()

        message = await _emit(registry, PICKER)

        assert [card["type"] for card in registry.snapshot()] == ["ifc_model_picker"]
        assert message == (
            "Card 'ifc_model_picker' will be shown with your answer, as card 1. "
            "Write [[card:1]] on a line of its own at the point in your answer where the "
            "card belongs, and it is drawn there instead of after the whole answer. Leave the marker "
            "out and the card lands at the end."
        )

    async def test_a_bare_object_that_fails_validation_still_names_its_type_alone(self):
        registry = CardRegistry()

        message = await _emit(registry, {"type": "stair_diagram", "title": "Treppe"})

        assert message.startswith("Error: card of type 'stair_diagram' failed validation:")
        assert "Card at index" not in message
