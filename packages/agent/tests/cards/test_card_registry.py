import json
import logging

import pytest

from agent.cards.models import answer_card_adapter
from agent.cards.registry import CardRegistry
from agent.cards.registry import get_card_registry
from agent.cards.registry import get_or_create_card_registry
from agent.cards.registry import reset_card_registry
from agent.cards.registry import set_card_registry


def _emit(card_json: str) -> str:
    try:
        payload = json.loads(card_json)
    except (json.JSONDecodeError, TypeError) as exc:
        return f"Error: card_json is not valid JSON ({exc})."
    if not isinstance(payload, dict):
        return "Error: card_json must be a single JSON object with a 'type' field."
    try:
        validated = answer_card_adapter.validate_python(payload).model_dump(exclude_none=True)
    except Exception as exc:
        return f"Error: card failed validation: {exc}."
    registry = get_card_registry()
    if registry is None:
        return "Noted, but no card channel is available."
    registry.add(validated)
    return f"Card '{validated['type']}' will be shown with your answer."


class TestCardRegistry:
    def test_add_and_snapshot(self):
        reg = CardRegistry()
        reg.add({"type": "summary", "title": "A"})
        reg.add({"type": "legal_basis", "law": "OIB-2"})
        assert [c["type"] for c in reg.snapshot()] == ["summary", "legal_basis"]

    def test_len_is_the_position_of_the_next_card(self):
        reg = CardRegistry()
        assert len(reg) == 0
        reg.add({"type": "summary", "title": "A"})
        assert len(reg) == 1

    def test_clear(self):
        reg = CardRegistry()
        reg.add({"type": "summary", "title": "A"})
        reg.clear()
        assert reg.snapshot() == []

    def test_snapshot_is_a_copy(self):
        reg = CardRegistry()
        reg.add({"type": "summary", "title": "A"})
        snap = reg.snapshot()
        snap.append({"type": "summary", "title": "B"})
        assert len(reg.snapshot()) == 1

    def test_same_conversation_shares_registry(self):
        a = get_or_create_card_registry("conv-1")
        b = get_or_create_card_registry("conv-1")
        assert a is b

    def test_none_conversation_is_isolated(self):
        a = get_or_create_card_registry(None)
        b = get_or_create_card_registry(None)
        assert a is not b


class TestEmitCardBody:
    def test_valid_card_is_registered(self):
        reg = get_or_create_card_registry("conv-emit-1")
        reg.clear()
        token = set_card_registry(reg)
        try:
            msg = _emit('{"type": "ifc_model_picker", "title": "Answer"}')
        finally:
            reset_card_registry(token)
        assert "will be shown" in msg
        cards = reg.snapshot()
        assert len(cards) == 1
        assert cards[0]["type"] == "ifc_model_picker"

    def test_invalid_json_registers_nothing(self):
        reg = get_or_create_card_registry("conv-emit-2")
        reg.clear()
        token = set_card_registry(reg)
        try:
            msg = _emit("not valid json")
        finally:
            reset_card_registry(token)
        assert msg.startswith("Error")
        assert reg.snapshot() == []

    def test_unknown_card_type_registers_nothing(self):
        reg = get_or_create_card_registry("conv-emit-3")
        reg.clear()
        token = set_card_registry(reg)
        try:
            msg = _emit('{"type": "not_a_real_card", "foo": "bar"}')
        finally:
            reset_card_registry(token)
        assert msg.startswith("Error")
        assert reg.snapshot() == []

    def test_no_active_registry_does_not_raise(self):
        msg = _emit('{"type": "ifc_model_picker", "title": "A"}')
        assert "no card channel" in msg

    @pytest.mark.parametrize(
        "card_json",
        [
            '{"type": "ifc_model_picker", "title": "Egress widths"}',
            '{"type": "ifc_model_picker", "title": "Welches Modell?", "note": "Haus A"}',
        ],
    )
    def test_multiple_real_types(self, card_json):
        reg = get_or_create_card_registry("conv-emit-multi")
        reg.clear()
        token = set_card_registry(reg)
        try:
            msg = _emit(card_json)
        finally:
            reset_card_registry(token)
        assert "will be shown" in msg
        assert len(reg.snapshot()) == 1


class TestEmitCardRejectsSystemCards:
    @pytest.mark.asyncio
    async def test_memory_proposal_is_rejected(self):
        from unittest.mock import MagicMock

        from agent.cards.register import EmitCardConfig
        from agent.cards.register import emit_card

        reg = get_or_create_card_registry("conv-emit-system")
        reg.clear()
        token = set_card_registry(reg)
        payload = json.dumps(
            {
                "type": "memory_proposal",
                "title": "Save this finding?",
                "content": "The firm always uses REI 90 for GK4.",
                "kind": "preference",
            }
        )
        try:
            async with emit_card(EmitCardConfig(), MagicMock()) as info:
                msg = await info.single_fn(card_json=payload)
        finally:
            reset_card_registry(token)
        assert msg.startswith("Error")
        assert "system-emitted" in msg
        assert reg.snapshot() == []


class TestARefusedCardIsVisibleAfterTheTurn:
    @staticmethod
    async def _emit_real(registry, payload) -> str:
        from unittest.mock import MagicMock

        from agent.cards.register import EmitCardConfig
        from agent.cards.register import emit_card

        token = set_card_registry(registry)
        try:
            async with emit_card(EmitCardConfig(), MagicMock()) as info:
                return await info.single_fn(card_json=payload if isinstance(payload, str) else json.dumps(payload))
        finally:
            reset_card_registry(token)

    @pytest.mark.asyncio
    async def test_a_validation_failure_logs_the_type_the_model_reached_for(self, caplog):
        reg = get_or_create_card_registry("conv-refusal-1")
        reg.clear()
        with caplog.at_level(logging.WARNING, logger="agent.cards"):
            msg = await self._emit_real(reg, {"type": "stair_diagram", "title": "Treppe"})

        assert msg.startswith("Error")
        records = [r for r in caplog.records if r.levelno == logging.WARNING]
        assert records, "a refused card left no trace at all — the exact gap this closes"
        assert "stair_diagram" in records[0].getMessage()
        assert "rejected" in records[0].getMessage()

    @pytest.mark.asyncio
    async def test_a_validation_refusal_carries_no_link(self):
        reg = get_or_create_card_registry("conv-refusal-5")
        reg.clear()

        msg = await self._emit_real(reg, {"type": "stair_diagram", "title": "Treppe"})

        assert msg.startswith("Error: card of type 'stair_diagram' failed validation:")
        assert "http" not in msg
        assert "For further information" not in msg

    @pytest.mark.asyncio
    async def test_unparseable_json_logs_too(self, caplog):
        reg = get_or_create_card_registry("conv-refusal-2")
        reg.clear()
        with caplog.at_level(logging.WARNING, logger="agent.cards"):
            msg = await self._emit_real(reg, "{not json")

        assert msg.startswith("Error")
        assert any("not valid JSON" in r.getMessage() for r in caplog.records if r.levelno == logging.WARNING)

    @pytest.mark.asyncio
    async def test_a_system_card_refusal_logs_too(self, caplog):
        reg = get_or_create_card_registry("conv-refusal-3")
        reg.clear()
        with caplog.at_level(logging.WARNING, logger="agent.cards"):
            msg = await self._emit_real(
                reg, {"type": "memory_proposal", "title": "X", "content": "Y", "scope": "project"}
            )

        assert msg.startswith("Error")
        assert any("memory_proposal" in r.getMessage() for r in caplog.records if r.levelno == logging.WARNING)

    @pytest.mark.asyncio
    async def test_a_successful_card_logs_at_info_and_not_as_a_warning(self, caplog):
        reg = get_or_create_card_registry("conv-refusal-4")
        reg.clear()
        with caplog.at_level(logging.INFO, logger="agent.cards.register"):
            msg = await self._emit_real(reg, {"type": "ifc_model_picker", "title": "Treppe"})

        assert not msg.startswith("Error")
        assert not [r for r in caplog.records if r.levelno >= logging.WARNING]
        assert any("registered a 'ifc_model_picker' card" in r.getMessage() for r in caplog.records)


class TestEmitCardPlacementMarker:
    @staticmethod
    async def _emit_real(registry, payload: dict) -> str:
        from unittest.mock import MagicMock

        from agent.cards.register import EmitCardConfig
        from agent.cards.register import emit_card

        token = set_card_registry(registry)
        try:
            async with emit_card(EmitCardConfig(), MagicMock()) as info:
                return await info.single_fn(card_json=json.dumps(payload))
        finally:
            reset_card_registry(token)

    @pytest.mark.asyncio
    async def test_first_card_is_card_one(self):
        reg = get_or_create_card_registry("conv-marker-1")
        reg.clear()
        msg = await self._emit_real(reg, {"type": "ifc_model_picker", "title": "Treppe"})
        assert "[[card:1]]" in msg
        assert "line of its own" in msg

    @pytest.mark.asyncio
    async def test_marker_counts_with_the_registry(self):
        reg = get_or_create_card_registry("conv-marker-2")
        reg.clear()
        first = await self._emit_real(reg, {"type": "ifc_model_picker", "title": "Eins"})
        second = await self._emit_real(reg, {"type": "ifc_model_picker", "title": "Zwei"})
        assert "[[card:1]]" in first
        assert "[[card:2]]" in second
        assert [c["title"] for c in reg.snapshot()] == ["Eins", "Zwei"]

    @pytest.mark.asyncio
    async def test_a_rejected_card_does_not_consume_a_number(self):
        reg = get_or_create_card_registry("conv-marker-3")
        reg.clear()
        await self._emit_real(reg, {"type": "ifc_model_picker", "title": "Eins"})
        rejected = await self._emit_real(reg, {"type": "ifc_model_picker"})
        assert rejected.startswith("Error")
        assert "[[card:2]]" in await self._emit_real(reg, {"type": "ifc_model_picker", "title": "Zwei"})

    @pytest.mark.asyncio
    async def test_an_envelope_shape_is_refused_with_the_channel_that_takes_it(self):
        reg = get_or_create_card_registry("conv-envelope-1")
        reg.clear()
        refusal = await self._emit_real(reg, {"type": "callout", "kind": "warning", "text": "Frist läuft."})
        assert "answer_json" in refusal
        assert "no longer exists" in refusal
        assert reg.snapshot() == []

    def test_the_marker_contract_is_paid_per_CALL_and_not_per_TURN(self):
        from agent.cards.register import _CARD_DOCTRINE

        assert "[[card:" not in _CARD_DOCTRINE
        assert "WHERE IT GOES" not in _CARD_DOCTRINE
        assert "WHEN TO EMIT ONE" in _CARD_DOCTRINE
        assert "WHEN NOT TO" in _CARD_DOCTRINE
        assert "there is no result field" in _CARD_DOCTRINE
