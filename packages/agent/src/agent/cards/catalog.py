import functools
import json
from collections.abc import Iterable
from typing import Any

from agent.cards.card_examples import CARD_EXAMPLES
from agent.cards.card_model import card_description
from agent.cards.card_shapes import _card_shape
from agent.cards.card_shapes import _field_specs
from agent.cards.card_shapes import _shape

SYSTEM_CARD_TYPES = frozenset(
    {
        "memory_proposal",
        "operation_proposal",
        "document_grid",
        "document_draft",
        "task_created",
        "file_operation_proposal",
        "canvas_activity",
        "look",
        "revision_compare",
    }
)

INTERACTIVE_CARD_TYPES = frozenset(
    {
        "project_profile_patch",
        "memory_proposal",
        "file_operation_proposal",
        "operation_proposal",
        "document_draft",
        "canvas_activity",
    }
)

CHAT_ONLY_CARD_TYPES = frozenset({"surface"})

MODEL_BACKED_CARD_TYPES = frozenset({"ifc_viewer", "ifc_element", "ifc_compliance", "ifc_schedule", "ifc_diff"})


def _card_type_of(card_cls: type) -> str:
    return getattr(card_cls.model_fields["type"].annotation, "__args__", ("?",))[0]


@functools.lru_cache(maxsize=1)
def model_facing_card_types() -> frozenset[str]:
    from agent.cards.models import AnswerCard

    return frozenset(_card_type_of(c) for c in AnswerCard.__args__) - SYSTEM_CARD_TYPES


def describe_card_catalog() -> dict[str, Any]:
    from agent.cards.models import AnswerCard

    nested: list[type] = []
    cards: list[dict[str, Any]] = []
    for card_cls in AnswerCard.__args__:
        type_value = getattr(card_cls.model_fields["type"].annotation, "__args__", ("?",))[0]
        doc = card_description(card_cls).strip()
        cards.append(
            {
                "type": type_value,
                "model": card_cls.__name__,
                "summary": " ".join(doc.split("\n\n")[0].split()),
                "emittedBy": "system" if type_value in SYSTEM_CARD_TYPES else "agent",
                "interaction": ("interactive" if type_value in INTERACTIVE_CARD_TYPES else "presentational"),
                "fields": _field_specs(card_cls, nested),
                "example": CARD_EXAMPLES.get(type_value),
            }
        )

    seen: set[type] = set()
    building_blocks: dict[str, list[dict[str, Any]]] = {}
    i = 0
    while i < len(nested):
        model_cls = nested[i]
        i += 1
        if model_cls in seen:
            continue
        seen.add(model_cls)
        building_blocks[model_cls.__name__] = _field_specs(model_cls, nested)

    return {"cards": cards, "buildingBlocks": building_blocks}


def shape_hint_for(card_type: str) -> str | None:
    return render_card_details([card_type]) or None


def render_card_catalog(*, include_model_backed: bool = True, exclude: frozenset[str] = frozenset()) -> str:
    from agent.cards.models import AnswerCard

    withheld = SYSTEM_CARD_TYPES | exclude
    if not include_model_backed:
        withheld |= MODEL_BACKED_CARD_TYPES

    nested: list[type] = []
    card_lines: list[str] = []
    for card_cls in AnswerCard.__args__:
        type_value = _card_type_of(card_cls)
        if type_value in withheld:
            continue
        doc = card_description(card_cls).strip().split("\n")[0]
        shape = _card_shape(card_cls, nested)
        card_lines.append(f'  - "{type_value}": {doc}\n      shape: {shape}')

    seen: set[type] = set()
    block_lines: list[str] = []
    i = 0
    while i < len(nested):
        model_cls = nested[i]
        i += 1
        if model_cls in seen:
            continue
        seen.add(model_cls)
        block_lines.append(f"  {model_cls.__name__} = {_shape(model_cls, nested, with_desc=True)}")

    examples = "\n".join(
        f"  {type_value}:\n    {json.dumps(payload, ensure_ascii=False)}"
        for type_value, payload in CARD_EXAMPLES.items()
        if type_value not in withheld
    )

    interactive_note = _interactive_note()
    measured_note = _measured_note()

    return (
        "Building blocks (reused object shapes):\n" + "\n".join(block_lines) + "\n\n"
        "Card types:\n" + "\n".join(card_lines) + interactive_note + measured_note + _plain_text_note() + "\n\n"
        "Worked examples (copy the nesting exactly):\n" + examples
    )


def _interactive_note() -> str:
    interactive = sorted(INTERACTIVE_CARD_TYPES - SYSTEM_CARD_TYPES)
    return (
        "\n\nCards that ask the user to CONFIRM something (" + ", ".join(f'"{t}"' for t in interactive) + "):\n"
        "  These are not presentation — they ask the user to authorize a real, persisted change, and\n"
        "  their answer is remembered. Emit one only when you have a SPECIFIC change worth interrupting\n"
        "  for, grounded in something the user actually said in this conversation. At most one per turn.\n"
        "  Never emit one speculatively, to ask a question you could ask in prose, or to restate a\n"
        "  change the user already confirmed."
        if interactive
        else ""
    )


def _measured_note() -> str:
    return (
        "\n\nNumbers that came from a MEASUREMENT (`ifc_measure`):\n"
        "  Every ifc_measure answer says HOW it was obtained. When you put one of its numbers on a\n"
        "  card, carry that with it — on DimensionCheck, set `provenance` to the answer's own\n"
        "  provenance, and for a 'computed' one set `tolerance` to the ± band in the SAME unit.\n"
        "  Copy them; never infer them. Marking our own measurement 'declared' turns our tolerance\n"
        "  into the architect's claim, and a measured dimension shown without its band reads as\n"
        "  exact — which is what decides whether 2.47 m clears a 2.50 m minimum.\n"
        "  Leave both null for a number that did not come from the model: a figure the user typed,\n"
        "  or a limit read out of the Bestimmung. Null means 'not stated', never 'declared'.\n"
        "  When the answer came back `decidable: false`, the dimension is status 'needs_input' with\n"
        "  `value` null and `missing` set to that answer's missing.remedy, VERBATIM — that sentence\n"
        "  is what the architect changes in their CAD. A blank slot instead of it reads as a fact\n"
        "  about the building, when it is a finding about the export."
    )


def _plain_text_note() -> str:
    return (
        "\n\nEvery text field is PLAIN TEXT:\n"
        "  No card renders markdown. Write the words, not the markup — no [text](url) links, no\n"
        "  **bold**, no `code`. A card that needs a link to its source already has one: the card\n"
        "  builds it from the fields you filled in, so writing one yourself adds a second, unchecked\n"
        "  claim next to the checked one."
    )


def render_card_index(*, include_model_backed: bool = True, exclude: frozenset[str] = frozenset()) -> str:
    from agent.cards.models import AnswerCard

    withheld = SYSTEM_CARD_TYPES | exclude
    if not include_model_backed:
        withheld |= MODEL_BACKED_CARD_TYPES

    lines: list[str] = []
    for card_cls in AnswerCard.__args__:
        type_value = _card_type_of(card_cls)
        if type_value in withheld:
            continue
        doc = card_description(card_cls).strip().split("\n")[0]
        lines.append(f'  - "{type_value}": {doc}')

    return "Card types:\n" + "\n".join(lines) + _interactive_note()


def card_index_entries(
    *, include_model_backed: bool = False, exclude: frozenset[str] = frozenset()
) -> list[tuple[str, str]]:
    from agent.cards.models import AnswerCard

    withheld = SYSTEM_CARD_TYPES | exclude
    if not include_model_backed:
        withheld |= MODEL_BACKED_CARD_TYPES
    entries: list[tuple[str, str]] = []
    for card_cls in AnswerCard.__args__:
        type_value = _card_type_of(card_cls)
        if type_value in withheld:
            continue
        entries.append((type_value, card_description(card_cls).strip().split("\n")[0]))
    return entries


def render_card_details(card_types: Iterable[str]) -> str:
    from agent.cards.models import AnswerCard

    by_type = {_card_type_of(c): c for c in AnswerCard.__args__}
    withheld = SYSTEM_CARD_TYPES
    wanted = [t for t in dict.fromkeys(card_types) if t in by_type and t not in withheld]
    compose = ""
    if "surface" in wanted:
        from agent.cards.envelope import compose_rule  # envelope imports this module

        wanted.remove("surface")
        compose = compose_rule()
    if not wanted:
        return compose

    nested: list[type] = []
    card_lines = [f'  - "{t}"\n      shape: {_card_shape(by_type[t], nested)}' for t in wanted]

    seen: set[type] = set()
    block_lines: list[str] = []
    i = 0
    while i < len(nested):
        model_cls = nested[i]
        i += 1
        if model_cls in seen:
            continue
        seen.add(model_cls)
        block_lines.append(f"  {model_cls.__name__} = {_shape(model_cls, nested, with_desc=True)}")

    examples = "\n".join(
        f"  {t}:\n    {json.dumps(CARD_EXAMPLES[t], ensure_ascii=False)}" for t in wanted if t in CARD_EXAMPLES
    )

    out = ""
    if block_lines:
        out += "Building blocks (reused object shapes):\n" + "\n".join(block_lines) + "\n\n"
    out += "Card types:\n" + "\n".join(card_lines)
    if any("DimensionCheck" in line for line in block_lines + card_lines):
        out += _measured_note()
    out += _plain_text_note()
    if examples:
        out += "\n\nWorked examples (copy the nesting exactly):\n" + examples
    if compose:
        out += "\n\nA surface's `Text` leaf is the one exception to plain text: it holds Markdown.\n\n" + compose
    return out
