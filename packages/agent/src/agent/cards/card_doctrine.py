import textwrap

_MARKDOWN_FIRST = """\
MARKDOWN FIRST. The answer's own Markdown carries rows of values, cases and options (a table; a
Status column renders its words as marks, and `trifft zu` marks the row that holds for this
project), a Verfahren or a run of Fristen (a numbered list, or a ```mermaid flowchart TD when it
forks), and the wording an answer turns on (a cited blockquote > „…“ [N]). A card is only for what
Markdown cannot carry: an interaction, geometry drawn to scale from measurements, a number the card
computes (calculation), or a live binding to the building model."""

_MARKDOWN_FIRST_CHAT = """\
MARKDOWN FIRST. The answer's own Markdown carries what the retired cards carried, in the blocks
RICH BLOCKS teaches: criteria each with a status (`:::check`), the cases of one project factor
(`:::cases`), a few figures against their limits (`:::metrics`), variants side by side
(`:::compare`), a Verfahren or a run of Fristen (`:::procedure`, or a ```mermaid flowchart TD when it
forks), what is still to do (`:::actions`), and the wording an answer turns on (a quote line
> „…“ [N]). A card is only for what Markdown cannot carry: an interaction, geometry drawn to scale
from measurements, a number the card computes (calculation), a live binding to the building model,
or variants in tabs (surface)."""

_CARD_TRIGGER_HEAD = """\
WHEN TO EMIT ONE. A row that matches your answer is a reason to reach for that card — a stair, a
clear width or an escape route written out as prose makes the reader rebuild in their head the
drawing the card would have shown them. Emit it where the match is clear and the card
carries more than the sentence beside it. Naming the card IS the decision: once you can say which
card this answer is, emitting it is the step that follows, not a second judgement."""

_MODEL_PICKER_NOTE = """\
The ifc_model_picker is the answer to "zeig mir das Modell" / "welches Modell soll ich öffnen":
emit it INSTEAD of writing the file names as a prose bullet list. It renders the project's models
as tiles the user clicks to open the viewer directly — you supply only the heading, never the file
names, so there is nothing to get wrong. You do not need to call ifc_query first to list them."""

_CARD_TRIGGERS: tuple[tuple[str, str, str], ...] = (
    ("a riser, tread or stair width", "stair_diagram", ""),
    ("a clear width, ramp or turning circle", "dimension_diagram", ""),
    ("an escape route with segments", "egress_diagram", ""),
    ("a fall height, railing or opening", "guardrail_check", ""),
    (
        "a distance to a parcel edge, or Bebauungsgrad, Bebauungsdichte or GFZ",
        "setback_plan",
        "For coverage and GFZ, give `coverage` / `density` with the Bebauungsplan's limit in `required` "
        "and leave `value` empty: the card derives it from the areas (`parcel_area_m2`, "
        "`footprint_area_m2` where the plot is not the drawn rectangle, `gross_floor_area_m2` for the "
        "GFZ). A pure density question leaves `sides` empty; a limit the Bebauungsplan did not give "
        "you stays out.",
    ),
    (
        "a barrier-free lift: cabin width, cabin depth, door",
        "dimension_diagram",
        "shape `lift_cabin`, with Kabinenbreite, Kabinentiefe and lichte Türbreite as its dimensions. "
        "Whether a lift is required at all is a sentence with its Fundstelle, not a field.",
    ),
    (
        "a number the answer WORKED OUT rather than looked up, other than the four rules of the row below",
        "calculation",
        "Supply the operands (label, value, unit) and the rule's limit; the card computes, rounds "
        "and judges, and there is no result field, on purpose. The rule's multiplier is a "
        "`factor`, never a second operand, and an operand you do not have stays empty — the card "
        'renders „nicht berechenbar". Never for a number merely cited: one operand is the '
        "sentence beside it, typeset twice.",
    ),
    (
        "a U-value from its layers, the Schrittmaßregel, an escape route's Gehweglänge, or a "
        "Lichteintrittsfläche against the Bodenfläche",
        "formula",
        "Name the rule and its case (`stair_type`, `component` and `measure`, `start`) and fill each input from a "
        "source, with `source` saying where it is written; an input you do not have stays null. The card "
        "owns the bounds: it reads them from the Richtlinie's table for that case, so you write no limit "
        "and no figure in the title, a label or the note. It computes, judges and lets the reader change "
        "the inputs for a what-if, so the prose names the verdict and points at the card instead of "
        "restating the computed number.",
    ),
)

_MODEL_PICKER_ROW = (
    "the user wants to SEE or OPEN the building and the project may hold several models",
    "ifc_model_picker",
    _MODEL_PICKER_NOTE,
)

_CARD_HONESTY = """\
WHAT MAY GO ON ONE. Never fabricate a field, a reference or a number to fill a card out — a card
with an invented limit in it is worse than the prose alone, because it is the part that gets
screenshotted into a submission. A value you do not have is left out or marked "needs_input", never
estimated to make the card look finished. This rule outranks every trigger above."""

_CARD_RESTRAINT = """\
WHEN NOT TO. One card is usually the right number, two the ceiling, none the normal case. A
one-line factual answer earns none: the card would only repeat the sentence above it. A card that
shows what a table or a sentence in the prose already shows is a restatement: keep the prose, cut
the card."""


def _render_trigger_table(*, include_ifc_triggers: bool, include_craft: bool) -> str:
    rows = (*_CARD_TRIGGERS, _MODEL_PICKER_ROW) if include_ifc_triggers else _CARD_TRIGGERS
    lead = (
        "The trigger, the card, and under it what fills that card well:"
        if include_craft
        else "The trigger, then the card:"
    )

    lines = [_CARD_TRIGGER_HEAD, lead]
    for trigger, card, craft in rows:
        lines.append(f"  {trigger.ljust(40)} -> {card}")
        if craft and include_craft:
            lines.append(textwrap.fill(craft, width=99, initial_indent=" " * 6, subsequent_indent=" " * 6))

    return "\n".join(lines)


def render_card_doctrine(*, include_ifc_triggers: bool = True, include_craft: bool = True, chat: bool = False) -> str:
    table = _render_trigger_table(include_ifc_triggers=include_ifc_triggers, include_craft=include_craft)
    lead = _MARKDOWN_FIRST_CHAT if chat else _MARKDOWN_FIRST
    return "\n\n".join((lead, table, _CARD_HONESTY, _CARD_RESTRAINT))
