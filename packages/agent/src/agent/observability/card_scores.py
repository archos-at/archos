"""Envelope cards as scores: a formula card's sourced defaults, a card's schema miss.

Split out of ``langfuse_scores`` (which declares every score in
``SCORE_DEFINITIONS``, posts them, and re-exports these builders) so that
module stops growing (``docs/contributing/code-conventions.md#size-limits``).
``RuntimeScore`` is imported where it is built: ``langfuse_scores`` imports
this module, so a module-level import back would be a cycle.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from typing import Any

if TYPE_CHECKING:
    from .langfuse_scores import RuntimeScore


def formula_provenance_score(card: dict[str, Any], *, index: int) -> RuntimeScore | None:
    """How many of a formula card's given defaults say where they are written; ``None`` for any other card.

    An input with no value is not counted against the card: it is shown as
    unknown, which is the honest outcome, and counted in the metadata instead.
    A card whose inputs are all unknown scores 1 — nothing on it is untraced.
    """
    if card.get("type") != "formula":
        return None
    from agent.cards.formula_card import formula_inputs

    from .langfuse_scores import RuntimeScore

    inputs = formula_inputs(card)
    given = [item for item in inputs if item.get("value") is not None]
    sourced = [item for item in given if (item.get("source") or "").strip() or item.get("reference")]
    share = round(len(sourced) / len(given), 4) if given else 1.0
    name = str((card.get("formula") or {}).get("name"))
    return RuntimeScore(
        "formula-input-provenance",
        share,
        comment=f"{len(sourced)} of {len(given)} given inputs sourced",
        item=str(index),
        metadata={
            "formula": name,
            "inputs": len(inputs),
            "given": len(given),
            "sourced": len(sourced),
            "unknown": len(inputs) - len(given),
        },
    )


def card_validity_score(*, outcome: str, card_type: str, index: int, fields: int | None = None) -> RuntimeScore:
    """One envelope card's schema miss: repaired, dropped, or `stripped` of ``fields`` it may not state."""
    from .langfuse_scores import RuntimeScore

    metadata: dict[str, Any] = {"card_type": card_type}
    comment = card_type
    if fields is not None:
        metadata["fields"] = fields
        comment = f"{card_type}: {fields} stated field(s) removed"
    return RuntimeScore("card-validity", outcome, comment=comment, item=str(index), metadata=metadata)
