from __future__ import annotations

import json
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from agent.cards.card_doctrine import render_card_doctrine
from agent.cards.catalog import MODEL_BACKED_CARD_TYPES
from agent.cards.catalog import SYSTEM_CARD_TYPES
from agent.cards.catalog import render_card_details
from agent.cards.catalog import render_card_index
from agent.cards.catalog import shape_hint_for
from agent.cards.proposal_cards import SERVER_FILLED_CARD_FIELDS
from agent.cards.registry import CardRegistry
from agent.cards.retired_cards import RETIRED_CARD_TYPES
from agent.cards.retired_cards import retired_refusal
from agent.cards.surface_card import SURFACE_MAX_CHILDREN
from agent.cards.surface_card import SURFACE_MAX_LEAVES
from agent.cards.surface_card import SURFACE_MAX_TABS
from agent.cards.surface_card import SURFACE_TEXT_MAX
from agent.common.tool_errors import render_error_detail

logger = logging.getLogger(__name__)

ENVELOPE_SHAPE_TYPES: tuple[str, ...] = ()

FLOOR_EXEMPT_CARD_TYPES = SYSTEM_CARD_TYPES | MODEL_BACKED_CARD_TYPES | {"ifc_model_picker"}


def is_floor_exempt(card: dict[str, Any]) -> bool:
    if card.get("type") != "surface":
        return card.get("type") in FLOOR_EXEMPT_CARD_TYPES
    return any(leaf.get("component") in FLOOR_EXEMPT_CARD_TYPES for leaf in card.get("components", []))


_COMPOSE_RULE = (
    "COMPOSE. Variants the reader picks ONE of to read (two designs, two Bundesländer, Bestand "
    "against Umbau, Außentreppe against zweites Treppenhaus) travel as ONE `surface` card, an A2UI "
    "v0.9 component list with a `Tabs` root, one tab per variant. A tab holds a card, or a `Text` "
    "holding the Markdown you would otherwise write for that variant: its table, its Status column, "
    "its steps, its [N]. What holds for every variant stays in the prose above the tabs, and the "
    "prose names the difference that decides between them; the tabs carry the detail. `Row` (side "
    "by side where the screen is wide) and `Column` (in order) put cards that read together into "
    'one slot. The container has id "root"; every other component is a card named by its type with '
    'that card\'s own fields, or `{"id", "component": "Text", "text": "<Markdown>"}`; children are '
    "referenced by id, each in ONE place (no id listed twice, no leaf in two tabs). Limits: a `Row` or "
    f"`Column` holds 2 to {SURFACE_MAX_CHILDREN} children, `Tabs` 2 to {SURFACE_MAX_TABS} tabs, the "
    f"surface 2 to {SURFACE_MAX_LEAVES} leaves; a `Text` is at most {SURFACE_TEXT_MAX} characters and "
    "carries no card or callout marker (those are placed from the prose). Never an interactive or "
    "tool card inside, nor an envelope field (verdict, summary, takeaways, callout), and a surface "
    "counts as one card against the ceiling. Two tabs that say nearly the same are one answer, not "
    "variants.\n"
    '{"type": "surface", "title": "Zweiter Fluchtweg — zwei Varianten", "components": ['
    '{"id": "root", "component": "Tabs", "tabs": [{"title": "Außentreppe", "child": "a"}, '
    '{"title": "Zweites Treppenhaus", "child": "b"}]}, '
    '{"id": "a", "component": "Text", '
    '"text": "| Kriterium | Anforderung | Status | Fundstelle |\\n|---|---|---|---|\\n…"}, '
    '{"id": "b", "component": "Text", "text": "1. …\\n2. …"}]}'
)

_MARKER_RULE = (
    "PLACEMENT. `[[card:N]]` alone on a line of `answer` draws the N-th card of your `cards` array at "
    "that point; a card with no marker lands after the whole answer. N counts your array from 1 — "
    "unless a tool handed you such a marker earlier this turn (a filed draft, a document "
    "grid): those numbers are taken, so continue after the highest one. Several cards are one "
    "array; two content cards is a turn's ceiling."
)


def render_envelope_cards_contract() -> str:
    shapes = render_card_details(ENVELOPE_SHAPE_TYPES)
    return "\n\n".join(
        part
        for part in (
            render_card_doctrine(chat=True),
            render_card_index(),
            (
                "SHAPES. The exact shape of the cards answers most often earn follows; fill them "
                "from these, and fill any other type from its index line above — a field you get wrong is "
                "repaired, never a reason to skip a card the answer called for. Fields marked * are "
                "required; omit optional ones rather than passing null. Numbers are plain JSON numbers.\n\n" + shapes
            )
            if shapes
            else "",
            _COMPOSE_RULE,
            _MARKER_RULE,
        )
        if part
    )


REFUSED_NOT_AN_OBJECT = "not_an_object"
REFUSED_SHAPE = "shape"
REFUSED_SYSTEM_TYPE = "system_type"
REFUSED_RETIRED_TYPE = "retired_type"
REFUSED_CONFINED = "confined"

CONFINED_CARD_TYPES = frozenset({"project_profile_patch"})


def _turn_is_confined() -> bool:
    from agent.knowledge.restricted_collections import restricted_collections_in
    from agent.knowledge.restricted_use import current_restricted_use
    from agent.knowledge.restricted_use import drew_on_other_projects
    from agent.knowledge.scoping import get_collection_scope_from_context

    try:
        use = current_restricted_use()
        if use is not None and use.confined:
            return True
        if drew_on_other_projects():
            return True
        return bool(restricted_collections_in(get_collection_scope_from_context()))
    except Exception:  # noqa: BLE001 - an unreadable scope must not let the card through
        logger.warning("card check: the turn's scope could not be read; treating it as confined", exc_info=True)
        return True


@dataclass(frozen=True)
class CardRefusal:
    kind: str
    card_type: str
    detail: str = ""
    hint: str | None = None

    @property
    def message(self) -> str:
        if self.kind == REFUSED_NOT_AN_OBJECT:
            return "card_json must be a JSON object with a 'type' field, or an array of them."
        if self.kind == REFUSED_SHAPE:
            return f"card of type '{self.card_type}' failed validation: {self.detail}."
        if self.kind == REFUSED_SYSTEM_TYPE:
            return f"card type '{self.card_type}' is system-emitted: the tool that does the work pushes it."
        if self.kind == REFUSED_CONFINED:
            return (
                f"card type '{self.card_type}' is not offered in a conversation that reads folders with "
                "restricted access: what it writes is read by everyone in the project."
            )
        return retired_refusal(self.card_type)

    def for_repair(self) -> str:
        return self.message + (f"\n\n{self.hint}" if self.hint else "")


def validate_model_card(payload: object) -> tuple[dict[str, Any] | None, CardRefusal | None]:
    from agent.cards.models import answer_card_adapter

    if not isinstance(payload, dict):
        logger.warning("card rejected: card_json is a %s, not a JSON object", type(payload).__name__)
        return None, CardRefusal(REFUSED_NOT_AN_OBJECT, type(payload).__name__)

    card_type = str(payload.get("type", "?"))
    if card_type in SYSTEM_CARD_TYPES:
        logger.warning("card rejected: '%s' is system-emitted", card_type)
        return None, CardRefusal(REFUSED_SYSTEM_TYPE, card_type)
    if card_type in RETIRED_CARD_TYPES:
        logger.warning("card rejected: '%s' no longer exists", card_type)
        return None, CardRefusal(REFUSED_RETIRED_TYPE, card_type)
    if card_type in CONFINED_CARD_TYPES and _turn_is_confined():
        logger.warning("card rejected: '%s' in a turn whose scope holds a restricted folder", card_type)
        return None, CardRefusal(REFUSED_CONFINED, card_type)
    try:
        validated = answer_card_adapter.validate_python(payload).model_dump(exclude_none=True)
    except Exception as exc:
        detail = render_error_detail(exc)
        logger.warning("card rejected: a '%s' card failed validation: %s", card_type, detail)
        return None, CardRefusal(REFUSED_SHAPE, card_type, detail=detail, hint=_repair_hint(payload, card_type))

    for field in SERVER_FILLED_CARD_FIELDS:
        validated.pop(field, None)
    return validated, None


async def register_envelope_card(registry: CardRegistry, card: dict[str, Any]) -> None:
    from agent.tools.proposals_client import add_card

    if card.get("type") != "project_profile_patch":
        registry.add(card)
        return
    payload: dict[str, Any] = {"title": card["title"], "patch": card["patch"]}
    if card.get("rationale"):
        payload["rationale"] = card["rationale"]
    await add_card(registry, card, kind="project_profile", payload=payload)


def _repair_hint(payload: dict[str, Any], card_type: str) -> str | None:
    if card_type != "surface":
        return shape_hint_for(card_type)
    components = payload.get("components")
    leaves = [
        component["component"]
        for component in (components if isinstance(components, list) else ())
        if isinstance(component, dict) and isinstance(component.get("component"), str)
    ]
    return render_card_details(["surface", *leaves]) or None


def envelope_card_objects(raw: Sequence[Any] | None) -> list[Any]:
    objects: list[Any] = []
    for element in raw or ():
        if isinstance(element, str):
            try:
                objects.append(json.loads(element, strict=False))
            except json.JSONDecodeError, TypeError:
                objects.append(element)
            continue
        objects.append(element)
    return objects


def compose_rule() -> str:
    return _COMPOSE_RULE
