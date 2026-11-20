from __future__ import annotations

import re
from collections.abc import Collection
from dataclasses import replace
from typing import Any

from pydantic import ValidationError

from agent.citations.registry import SourceRegistry
from agent.citations.session import get_turn_captures
from agent.citations.source_identity import agent_authored_document_names
from agent.citations.trailer_values import drop_ungrounded_trailer_values
from agent.common.answer_envelope import AnswerMeta
from agent.common.envelope_gates import gate_answer_meta

from .answer_check import prose_without_references
from .answer_pipeline import SettledStream
from .answer_pipeline import settle_streamed_citations
from .envelope_cards import _CARD_MARKER_NUMBER_RE
from .envelope_cards import _envelope_index


class LiveAnswer:
    def __init__(self, registry: SourceRegistry, *, handed: Collection[int] = ()) -> None:
        self._registry = registry
        self._handed = frozenset(handed)
        self._settled: SettledStream | None = None
        self._tool_cards: list[dict[str, Any]] | None = None

    def masthead(self, fields: dict[str, Any], prose: str = "") -> dict[str, Any] | None:
        from agent.common.envelope_schema import MASTHEAD_FIELDS

        try:
            meta = AnswerMeta.model_validate({key: value for key, value in fields.items() if key in MASTHEAD_FIELDS})
        except ValidationError:
            return None
        gated = gate_answer_meta(
            meta,
            prose_chars=len(prose),
            prose=prose,
            agent_authored_documents=agent_authored_document_names(self._registry),
            record=False,
        )
        if gated is None:
            return None
        grounded = drop_ungrounded_trailer_values(gated, get_turn_captures()) or {}
        head = {key: value for key, value in grounded.items() if key in MASTHEAD_FIELDS}
        return {"v": grounded.get("v"), **head} if head else None

    def settle(self, prose: str, sources_text: str, fields: dict[str, Any] | None) -> SettledStream | None:
        settled = settle_streamed_citations(
            prose,
            sources_text,
            self._registry,
            kind=(fields or {}).get("kind"),
        )
        if settled is None:
            return None
        meta = self.masthead(fields, prose_without_references(settled.content)) if fields else None
        self._settled = replace(settled, answer_meta=meta)
        return self._settled

    def tool_cards(self) -> list[dict[str, Any]]:
        if self._tool_cards is None:
            from agent.cards.registry import get_card_registry

            registry = get_card_registry()
            self._tool_cards = registry.snapshot() if registry is not None else []
        return list(self._tool_cards)

    def place(self, text: str) -> str:
        tools = len(self.tool_cards())
        if not tools and not self._handed:
            return text

        def substitute(match: re.Match[str]) -> str:
            index = _envelope_index(int(match.group(1)), self._handed)
            return match.group(0) if index is None or index < 1 else f"[[card:{tools + index}]]"

        return _CARD_MARKER_NUMBER_RE.sub(substitute, text)

    def card(self, payload: Any) -> dict[str, Any] | None:
        from agent.cards.envelope import validate_model_card
        from agent.cards.surface_citations import recite_surface

        card, _refusal = validate_model_card(payload)
        if card is None:
            return None
        settled = self._settled or SettledStream(content="", sources=[])
        return recite_surface(card, settled.renumber_map, settled.numbers, settled.merged)
