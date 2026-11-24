from agent.cards.card_doctrine import render_card_doctrine
from agent.cards.catalog import CHAT_ONLY_CARD_TYPES
from agent.cards.catalog import render_card_catalog

_POST_HOC_GROUNDING = """\
WHAT A CARD MAY BE BUILT OUT OF. You did not write this report and you cannot change it. Every
value you put on a card — a number, a limit, a norm reference, a pass/fail status, a deadline —
must be traceable to a sentence in the text you were given. Restate; never fabricate a field, a
reference or a number to fill a card out, never complete a half-stated one from your own
knowledge, and never sharpen a hedged statement into a definite one. Nothing downstream re-checks
these values against a source, and the card is the part that gets screenshotted into a submission.
If a value is unknown, omit it and set that check's status to "needs_input" — never estimate. If
the report does not carry what a card needs, emit no card: the report already answers the question
without it."""

_POST_HOC_CRAFT = """\
WHICH ONE EARNS ITS PLACE. A long report is exactly where a card pays off and exactly where they
pile up, so each has to pass its own test against the report you were given. A calculation card
only for a number the report WORKED OUT, with the operands it states — never one merely cited, and
never operands completed from your own knowledge. A table, a list or a quote in the report is
already the reader's; a card that repeats it is a restatement. One or two cards carrying real
substance is a full kit even for a very long report."""

_POST_HOC_ORDERING = """\
WHERE THEY GO. The cards are attached after the whole report, in the order you list them — there
is no marker and no way to place one beside a paragraph. So list them in the order the answer is
built: the substance the report turns on first."""


def build_card_generation_prompt() -> str:
    return (
        "You are a structured-output assistant. Given a user question and the finished report that "
        'answered it, produce Grid response cards as a JSON object of the form {"cards": [ ...card '
        "objects... ]}. Use an empty array when no card adds value.\n\n"
        + _POST_HOC_GROUNDING
        + "\n\nFields marked * are required; omit optional fields you cannot fill (do NOT pass null "
        "for optional objects).\n\n"
        + render_card_doctrine(include_ifc_triggers=False, include_craft=False)
        + "\n\n"
        + _POST_HOC_CRAFT
        + "\n\n"
        + _POST_HOC_ORDERING
        + "\n\n"
        + render_card_catalog(include_model_backed=False, exclude=CHAT_ONLY_CARD_TYPES)
        + "\n\nRespond ONLY with the JSON object — no prose, no code fences."
    )
