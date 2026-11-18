import functools
import re
from typing import Any
from typing import Literal

from pydantic import ConfigDict
from pydantic import Field
from pydantic import model_validator

from agent.cards.card_model import CardModel
from agent.cards.card_model import flatten_card_markup
from agent.cards.catalog import INTERACTIVE_CARD_TYPES
from agent.cards.catalog import RETIRED_CARD_TYPES
from agent.cards.catalog import SYSTEM_CARD_TYPES
from agent.cards.catalog import retired_refusal

SURFACE_LAYOUTS: frozenset[str] = frozenset({"Row", "Column", "Tabs"})


_ENVELOPE_FIELD_TYPES: frozenset[str] = frozenset(
    {"summary", "verdict_header", "key_takeaways", "callout", "follow_ups"}
)


@functools.cache
def _basic_catalog() -> Any:
    from a2ui.core.basic_catalog import BasicCatalog

    return BasicCatalog("0.9")


SURFACE_EXCLUDED_LEAVES: frozenset[str] = SYSTEM_CARD_TYPES | INTERACTIVE_CARD_TYPES | frozenset({"surface"})


SURFACE_TEXT = "Text"


SURFACE_TEXT_MAX = 4000


_PROSE_MARKER = re.compile(r"\[\[\s*[a-z_]+(?:\s*:\s*\d+)?\s*\]\]", re.IGNORECASE)


SURFACE_MAX_LEAVES = 6


SURFACE_MAX_CHILDREN = 4


SURFACE_MAX_TABS = 6


SURFACE_JUSTIFY = frozenset({"start", "center", "end", "spaceBetween", "spaceAround", "spaceEvenly", "stretch"})


SURFACE_ALIGN = frozenset({"start", "center", "end", "stretch"})


def _check_row(component: dict[str, Any]) -> dict[str, Any]:
    name, component_id = component["component"], component["id"]
    for prop, allowed in (("justify", SURFACE_JUSTIFY), ("align", SURFACE_ALIGN)):
        if prop in component and (not isinstance(component[prop], str) or component[prop] not in allowed):
            raise ValueError(f"'{component_id}' ({name}): `{prop}` is one of {sorted(allowed)}.")
    children = component.get("children")
    if not isinstance(children, list) or not all(isinstance(child, str) for child in children):
        raise ValueError(f"'{component_id}' ({name}): `children` must be a list of component ids.")
    if not 2 <= len(children) <= SURFACE_MAX_CHILDREN:
        raise ValueError(
            f"'{component_id}' ({name}): {len(children)} children; a {name} holds 2 to "
            f"{SURFACE_MAX_CHILDREN}. One child is that child, and more do not fit a column."
        )
    extra = set(component) - {"id", "component", "children", "justify", "align"}
    if extra:
        raise ValueError(f"'{component_id}' ({name}) does not take {sorted(extra)}.")
    return component


def _checked_tab(component_id: str, tab: Any) -> dict[str, str]:
    if not isinstance(tab, dict) or set(tab) != {"title", "child"}:
        raise ValueError(f"'{component_id}' (Tabs): every tab is exactly {{title, child}}.")
    title = flatten_card_markup(tab["title"]).strip() if isinstance(tab["title"], str) else ""
    if not title or not isinstance(tab["child"], str):
        raise ValueError(f"'{component_id}' (Tabs): a tab's `title` is text and its `child` an id.")
    return {"title": title, "child": tab["child"]}


def _check_tabs(component: dict[str, Any]) -> dict[str, Any]:
    component_id = component["id"]
    tabs = component.get("tabs")
    if not isinstance(tabs, list) or not 2 <= len(tabs) <= SURFACE_MAX_TABS:
        raise ValueError(f"'{component_id}' (Tabs): `tabs` must list 2 to {SURFACE_MAX_TABS} tabs.")
    checked = [_checked_tab(component_id, tab) for tab in tabs]
    extra = set(component) - {"id", "component", "tabs"}
    if extra:
        raise ValueError(f"'{component_id}' (Tabs) does not take {sorted(extra)}.")
    return {**component, "tabs": checked}


def _check_layout(component: dict[str, Any]) -> dict[str, Any]:
    if component["component"] == "Tabs":
        return _check_tabs(component)
    return _check_row(component)


def _checked_text(component: dict[str, Any]) -> dict[str, Any]:
    component_id = component["id"]
    extra = set(component) - {"id", "component", "text"}
    if extra:
        raise ValueError(f"'{component_id}' (Text) takes only `text`, not {sorted(extra)}.")
    text = component.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ValueError(f"'{component_id}' (Text): `text` is the Markdown to show, and it is empty.")
    if len(text) > SURFACE_TEXT_MAX:
        raise ValueError(
            f"'{component_id}' (Text): {len(text)} characters; a tab holds at most {SURFACE_TEXT_MAX}. "
            "Say the rest in the answer."
        )
    if marker := _PROSE_MARKER.search(text):
        raise ValueError(
            f"'{component_id}' (Text): `{marker.group(0)}` is a marker of the answer's prose and is shown "
            "literally here. Reference cards from the prose, not inside a tab."
        )
    return {"id": component_id, "component": SURFACE_TEXT, "text": text.strip()}


def _checked_leaf(component: dict[str, Any]) -> dict[str, Any]:
    name, component_id = component["component"], component["id"]
    if name == SURFACE_TEXT:
        return _checked_text(component)
    if name in RETIRED_CARD_TYPES:
        leaf = "" if name in _ENVELOPE_FIELD_TYPES else " Use a `Text` leaf holding that Markdown."
        raise ValueError(f"'{component_id}': {retired_refusal(name)}{leaf}")
    if name in SURFACE_EXCLUDED_LEAVES:
        raise ValueError(f"'{component_id}': a '{name}' cannot sit inside a surface.")
    from agent.cards.models import answer_card_adapter

    props = {key: value for key, value in component.items() if key not in ("id", "component")}
    try:
        card = answer_card_adapter.validate_python({**props, "type": name})
    except Exception as exc:  # the adapter's own clauses, prefixed with where they happened
        from agent.common.tool_errors import render_error_detail

        raise ValueError(f"'{component_id}' ({name}): {render_error_detail(exc)}") from exc
    normalised = card.model_dump(exclude_none=True)
    normalised.pop("type")
    return {"id": component_id, "component": name, **normalised}


def _structural_models(components: list[dict[str, Any]]) -> dict[str, Any]:
    from a2ui.core.state.component_model import ComponentModel

    catalog = _basic_catalog()
    models: dict[str, Any] = {}
    for component in components:
        name = component["component"]
        props = {key: value for key, value in component.items() if key not in ("id", "component")}
        models[component["id"]] = ComponentModel(
            component["id"], name, catalog, props if name in SURFACE_LAYOUTS else {}
        )
    return models


def _references(component: dict[str, Any]) -> list[str]:
    if component["component"] not in SURFACE_LAYOUTS:
        return []
    return list(component.get("children") or []) + [tab["child"] for tab in component.get("tabs") or []]


def _check_single_parent(components: list[dict[str, Any]]) -> None:
    seen: set[str] = set()
    for child in (child for component in components for child in _references(component)):
        if child in seen:
            raise ValueError(
                f"'{child}' is referenced more than once; a surface is a tree, and each component "
                "sits in one place. Give the second place a component of its own."
            )
        seen.add(child)


class SurfaceCard(CardModel):
    model_config = ConfigDict(
        json_schema_extra={
            "description": (
                "Several cards composed into one A2UI surface: variants as tabs, related cards side by side.\n"
                "\n"
                "`components` is an A2UI v0.9 component list (a2ui.org): flat, each entry\n"
                '`{"id", "component", …props}`, children referenced by id, exactly one\n'
                '`"id": "root"`. Containers are `Row` and `Column` (`children`: ids) and\n'
                "`Tabs` (`tabs`: `[{title, child}]`); `Text` (`text`: Markdown) holds what\n"
                "the answer would write in prose, a table or a list; every other component\n"
                "is a card, named by its type, with that card's own fields as props. Validated twice: the\n"
                "structure by `a2ui-core` (unique ids, a root, no dangling reference, no\n"
                "cycle, no orphan), each card by its own model."
            )
        }
    )

    type: Literal["surface"]
    title: str | None = Field(
        default=None,
        description="Optional heading over the whole surface, e.g. 'Zwei Varianten des zweiten Fluchtwegs'",
    )
    components: list[dict[str, Any]] = Field(
        min_length=3,
        description=(
            "The A2UI component list: one container with id 'root' (Row, Column or Tabs) and what "
            'it holds: cards, each `{"id", "component": <card type>, …that card\'s fields}`, and '
            '`{"id", "component": "Text", "text": <Markdown>}` for a table, a list or prose.'
        ),
    )

    @model_validator(mode="after")
    def _is_a_valid_a2ui_surface(self) -> SurfaceCard:
        from a2ui.core.state.validation_helpers import analyze_topology
        from a2ui.core.state.validation_helpers import validate_component_integrity

        for index, component in enumerate(self.components):
            if not isinstance(component.get("id"), str) or not isinstance(component.get("component"), str):
                raise ValueError(f"components.{index} needs a string `id` and a string `component`.")
        ids = [component["id"] for component in self.components]
        if duplicates := sorted({component_id for component_id in ids if ids.count(component_id) > 1}):
            raise ValueError(
                f"Duplicate component ID: {', '.join(duplicates)}. Ids are unique within a surface; "
                "give each component its own."
            )
        by_id = {component["id"]: component for component in self.components}
        root = by_id.get("root")
        if root is None or root["component"] not in SURFACE_LAYOUTS:
            raise ValueError(
                "The component with id 'root' must be a Row, Column or Tabs; a surface of one card "
                "is that card, emitted on its own."
            )

        checked: list[dict[str, Any]] = []
        for component in self.components:
            if component["component"] in SURFACE_LAYOUTS:
                checked.append(_check_layout(component))
            else:
                checked.append(_checked_leaf(component))
        structural = _structural_models(checked)
        try:
            validate_component_integrity(structural)
            analyze_topology(structural)
        except Exception as exc:
            raise ValueError(f"The component list is not a valid A2UI surface: {exc}") from exc
        _check_single_parent(checked)
        leaves = sum(1 for component in checked if component["component"] not in SURFACE_LAYOUTS)
        if not 2 <= leaves <= SURFACE_MAX_LEAVES:
            raise ValueError(
                f"A surface holds 2 to {SURFACE_MAX_LEAVES} cards or Text blocks; this one holds {leaves}."
            )
        self.components = checked
        return self
