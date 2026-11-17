import re
from pathlib import Path

from agent.cards.catalog import INTERACTIVE_CARD_TYPES
from agent.cards.models import AnswerCard

REPO_ROOT = Path(__file__).resolve().parents[4]
TS_CARD_DECISION = REPO_ROOT / "apps" / "workspace" / "ui" / "features" / "cards" / "card-decision.ts"


def _card_types() -> set[str]:
    return {
        getattr(card_cls.model_fields["type"].annotation, "__args__", ("?",))[0] for card_cls in AnswerCard.__args__
    }


def _ts_interactive_types() -> set[str]:
    source = TS_CARD_DECISION.read_text(encoding="utf-8")
    match = re.search(
        r"export const CARD_INTERACTIVITY: Record<AnswerCard\['type'\], CardInteractivity> = \{(.*?)^\}",
        source,
        re.DOTALL | re.MULTILINE,
    )
    assert match, f"CARD_INTERACTIVITY not found in {TS_CARD_DECISION}"
    return set(re.findall(r"^\s*(\w+):\s*'(?:interactive|live)'", match.group(1), re.MULTILINE))


def test_interactive_types_are_real_card_types():
    assert INTERACTIVE_CARD_TYPES <= _card_types()


def test_backend_and_frontend_agree_on_which_cards_are_interactive():
    assert _ts_interactive_types() == set(INTERACTIVE_CARD_TYPES)


def test_every_card_type_is_classified_in_the_frontend():
    source = TS_CARD_DECISION.read_text(encoding="utf-8")
    match = re.search(
        r"export const CARD_INTERACTIVITY: Record<AnswerCard\['type'\], CardInteractivity> = \{(.*?)^\}",
        source,
        re.DOTALL | re.MULTILINE,
    )
    assert match, f"CARD_INTERACTIVITY not found in {TS_CARD_DECISION}"
    classified = set(re.findall(r"^\s*(\w+):\s*'(?:interactive|live|presentational)'", match.group(1), re.MULTILINE))
    missing = _card_types() - classified
    assert not missing, (
        f"Card type(s) {sorted(missing)} are not classified in CARD_INTERACTIVITY "
        f"({TS_CARD_DECISION}). Decide whether each one asks the user to commit to "
        "something; if it does, its answer must be persisted on the message."
    )


TS_ANSWER_CARDS = REPO_ROOT / "apps" / "workspace" / "ui" / "features" / "cards" / "components" / "AnswerCards.tsx"


def _ts_rendered_types() -> set[str]:
    source = TS_ANSWER_CARDS.read_text(encoding="utf-8")
    return set(re.findall(r"card\.type === '(\w+)'", source))


def test_every_card_type_has_a_renderer():
    missing = _card_types() - _ts_rendered_types()
    assert not missing, (
        f"Card type(s) {sorted(missing)} have no renderer branch in {TS_ANSWER_CARDS}. "
        "AnswerCardItem falls through to `return null`, so a card of that type reaches "
        "the user as an empty gap in the answer — no warning, no dropped card. Add the "
        "branch (and a preview fixture) before the type ships."
    )


def test_renderer_branches_are_real_card_types():
    orphaned = _ts_rendered_types() - _card_types()
    assert not orphaned, f"{TS_ANSWER_CARDS} dispatches on {sorted(orphaned)}, which the card union no longer has."
