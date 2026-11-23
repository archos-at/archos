from __future__ import annotations

import re
from collections.abc import Collection
from collections.abc import Mapping
from typing import Any

from pydantic import ValidationError

from agent.cards.models import answer_card_adapter
from agent.cards.surface_card import SURFACE_LAYOUTS
from agent.cards.surface_card import SURFACE_TEXT
from agent.cards.surface_card import SurfaceCard
from agent.citations.markdown_code import map_outside_code
from agent.citations.references import expand_grouped_citations

_CITATION = re.compile(r"([ \t ]*)(?<!\[)\[(\d+)\](?![\](])")

_NO_MERGES: Mapping[int, int] = {}

BLANK_TEXT = "—"


def recite_text(
    text: str,
    renumber: Mapping[int, int],
    cited: Collection[int],
    merged: Mapping[int, int] = _NO_MERGES,
) -> str:

    def replace(match: re.Match[str]) -> str:
        old = int(match.group(2))
        old = merged.get(old, old)
        new = renumber.get(old) if renumber else old
        return f"{match.group(1)}[{new}]" if new is not None and new in cited else ""

    return map_outside_code(
        text,
        lambda prose: _CITATION.sub(replace, expand_grouped_citations(prose)),
        unterminated_fence_is_code=False,
    )


def recite_surface(
    card: dict[str, Any],
    renumber: Mapping[int, int],
    cited: Collection[int],
    merged: Mapping[int, int] = _NO_MERGES,
) -> dict[str, Any]:
    if card.get("type") != "surface":
        return card
    components = [
        {**component, "text": recite_text(str(component.get("text", "")), renumber, cited, merged)}
        if component.get("component") == SURFACE_TEXT
        else component
        for component in card.get("components", [])
    ]
    blank = {
        component.get("id")
        for component in components
        if component.get("component") == SURFACE_TEXT and not component["text"].strip()
    }
    if not blank:
        return {**card, "components": components}
    kept = [_without(component, blank) for component in components if component.get("id") not in blank]
    recited = {**card, "components": kept}
    if _stands(recited):
        return recited
    return _hoisted(kept) or {
        **card,
        "components": [
            {**component, "text": BLANK_TEXT} if component.get("id") in blank else component for component in components
        ],
    }


def _stands(surface: dict[str, Any]) -> bool:
    try:
        SurfaceCard.model_validate(surface)
    except ValidationError:
        return False
    return True


def _hoisted(components: list[dict[str, Any]]) -> dict[str, Any] | None:
    leaves = [component for component in components if component.get("component") not in SURFACE_LAYOUTS]
    if len(leaves) != 1 or leaves[0].get("component") == SURFACE_TEXT:
        return None
    props = {key: value for key, value in leaves[0].items() if key not in ("id", "component")}
    try:
        return answer_card_adapter.validate_python({**props, "type": leaves[0]["component"]}).model_dump(
            exclude_none=True
        )
    except ValidationError:
        return None


def _without(component: dict[str, Any], ids: set[Any]) -> dict[str, Any]:
    if isinstance(component.get("children"), list):
        return {**component, "children": [child for child in component["children"] if child not in ids]}
    if isinstance(component.get("tabs"), list):
        tabs = [tab for tab in component["tabs"] if not (isinstance(tab, dict) and tab.get("child") in ids)]
        return {**component, "tabs": tabs}
    return component
