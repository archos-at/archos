from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
from typing import Any

UNFILED = "unfiled"
FILED = "filed"

DRAFTING_ANSWER_KINDS: frozenset[str | None] = frozenset({None, "direct", "walkthrough"})

SUBMITTING = "file_draft(submit=true)"


def traced_tool_name(name: str, args: Any) -> str:
    if name == "file_draft" and isinstance(args, dict) and str(args.get("submit")).strip().lower() == "true":
        return SUBMITTING
    return name


@dataclass(frozen=True)
class DraftingCase:
    id: str
    prompt: str
    required_tools: tuple[str, ...]
    forbidden_tools: tuple[str, ...] = ()
    seed: dict[str, str] = field(default_factory=dict)
    card: str = UNFILED


_FILE_NOTE = "/drafts/aktenvermerk-ma37-fluchtweg.md"

_SEEDED_DRAFT = (
    "# Aktenvermerk – Besprechung MA 37\n\n"
    "## 1. Anlass\nBesprechung mit der MA 37 am 3. September.\n\n"
    "## 2. Teilnehmer\nBauwerberin, Entwurfsverfasser, MA 37.\n\n"
    "## 3. Fluchtweg\nDer zweite Fluchtweg über das Stiegenhaus Ost wurde besprochen. "
    "Die Behörde hält die Länge des Fluchtwegs für klärungsbedürftig und erwartet eine "
    "Darstellung im Einreichplan, aus der die Gehweglänge bis ins Freie hervorgeht.\n\n"
    "## 4. Vereinbartes\nDer Einreichplan wird ergänzt.\n"
)

COMMISSION = DraftingCase(
    id="commission",
    prompt="Schreib mir einen Aktenvermerk zur Besprechung mit der MA 37 über den Fluchtweg",
    required_tools=("write_file",),
    forbidden_tools=("file_draft", SUBMITTING),
    card=UNFILED,
)

REVISE = DraftingCase(
    id="revise",
    prompt="Kürze Punkt 3 des Aktenvermerks",
    required_tools=("edit_file",),
    forbidden_tools=("write_file", "file_draft", SUBMITTING),
    seed={_FILE_NOTE: _SEEDED_DRAFT},
    card=UNFILED,
)

FILE = DraftingCase(
    id="file",
    prompt="Leg den Aktenvermerk ins Projekt ab",
    required_tools=("file_draft",),
    forbidden_tools=(SUBMITTING,),
    seed={_FILE_NOTE: _SEEDED_DRAFT},
    card=FILED,
)

DRAFTING_CASES: tuple[DraftingCase, ...] = (COMMISSION, REVISE, FILE)

SEEDED_DRAFT_PATH = _FILE_NOTE


def draft_cards(cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [card for card in cards if card.get("type") == "document_draft"]


def assert_turn_shape(
    case: DraftingCase,
    *,
    called_tools: list[str],
    cards: list[dict[str, Any]],
    answer_meta: dict[str, Any] | None,
    escalated: bool,
) -> None:
    for name in case.required_tools:
        assert name in called_tools, f"{case.id}: {name} was never called; trace was {called_tools}"
    for name in case.forbidden_tools:
        assert name not in called_tools, f"{case.id}: {name} was called uninvited; trace was {called_tools}"

    drafts = draft_cards(cards)
    assert drafts, f"{case.id}: the reader was shown no document_draft card"
    latest = drafts[-1]
    filed = latest.get("document_id") is not None
    assert filed is (case.card == FILED), f"{case.id}: card filed={filed}, expected {case.card}: {latest}"
    if case.card == FILED:
        assert latest.get("version_id") and latest.get("version_state"), latest

    assert escalated is False, f"{case.id}: a drafting turn handed itself to deep research"
    meta = answer_meta or {}
    assert meta.get("kind") in DRAFTING_ANSWER_KINDS, f"{case.id}: answer kind {meta.get('kind')!r}"
    assert "verdict" not in meta, f"{case.id}: a drafting turn grew a verdict masthead: {meta.get('verdict')}"
