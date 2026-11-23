from __future__ import annotations

from typing import TYPE_CHECKING
from typing import Any

if TYPE_CHECKING:
    from .langfuse_scores import RuntimeScore


def formula_provenance_score(card: dict[str, Any], *, index: int) -> RuntimeScore | None:
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
    from .langfuse_scores import RuntimeScore

    metadata: dict[str, Any] = {"card_type": card_type}
    comment = card_type
    if fields is not None:
        metadata["fields"] = fields
        comment = f"{card_type}: {fields} stated field(s) removed"
    return RuntimeScore("card-validity", outcome, comment=comment, item=str(index), metadata=metadata)
