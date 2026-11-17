from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from agent.cards.models import answer_card_adapter
from agent.cards.registry import get_card_registry

logger = logging.getLogger(__name__)

CARD_TYPE = "operation_proposal"

PROPOSE_DECISION = "propose"


@dataclass(frozen=True)
class OperationProposal:

    proposal_id: str
    operation: str
    summary: str


def proposal_from(structured: object) -> OperationProposal | None:
    if not isinstance(structured, dict) or structured.get("decision") != PROPOSE_DECISION:
        return None
    proposal_id, operation, summary = (structured.get(key) for key in ("proposalId", "operation", "summary"))
    if not (isinstance(proposal_id, str) and isinstance(operation, str) and isinstance(summary, str)):
        return None
    try:
        proposal_id = str(uuid.UUID(proposal_id))
    except ValueError:
        return None
    if not operation.strip() or not summary.strip():
        return None
    return OperationProposal(proposal_id=proposal_id, operation=operation, summary=summary)


def emit_operation_proposal_card(proposal: OperationProposal, call_input: dict[str, Any] | None) -> bool:
    registry = get_card_registry()
    if registry is None:
        return False
    if any(card.get("proposal_id") == proposal.proposal_id for card in registry.snapshot()):
        return True
    try:
        card = answer_card_adapter.validate_python(
            {
                "type": CARD_TYPE,
                "title": proposal.summary,
                "operation": proposal.operation,
                "input": call_input or {},
                "proposal_id": proposal.proposal_id,
            }
        ).model_dump(exclude_none=True)
    except ValidationError:
        logger.exception("Failed to build operation_proposal card (operation=%s)", proposal.operation)
        return False
    registry.add(card)
    logger.info("Showed operation %s as proposal %s", proposal.operation, proposal.proposal_id)
    return True



REVISION_COMPARE_OPERATION = "document-revision-compare"
REVISION_COMPARE_CARD_TYPE = "revision_compare"


def _compare_changes(structured: dict[str, Any], page: int) -> list[dict[str, Any]]:
    from agent.tools.look.cards import clamp_region

    changes: list[dict[str, Any]] = []
    for item in structured.get("regions") or []:
        if not isinstance(item, dict) or item.get("page") != page:
            continue
        box = clamp_region([item.get("x"), item.get("y"), item.get("w"), item.get("h")])
        label = str(item.get("label") or "").strip()[:200]
        if box is not None and label:
            changes.append({"region": box, "label": label})
    return changes


def _compare_summary(structured: dict[str, Any]) -> list[str]:
    return [line.strip()[:400] for line in structured.get("summary") or [] if isinstance(line, str) and line.strip()]


def _compare_name(structured: dict[str, Any], key: str) -> str | None:
    value = structured.get(key)
    name = value.strip()[:255] if isinstance(value, str) else ""
    return name or None


def emit_revision_compare_card(structured: object, call_input: dict[str, Any] | None) -> int | None:
    registry = get_card_registry()
    if registry is None or not isinstance(structured, dict) or not isinstance(call_input, dict):
        return None
    params, body = call_input.get("params"), call_input.get("body")
    if not isinstance(params, dict) or not isinstance(body, dict):
        return None
    try:
        page = int(body.get("page") or 1)
    except TypeError, ValueError:
        return None
    summary = _compare_summary(structured)
    if not summary:
        return None
    try:
        card = answer_card_adapter.validate_python(
            {
                "type": REVISION_COMPARE_CARD_TYPE,
                "older_id": body.get("older"),
                "newer_id": params.get("id"),
                "older_name": _compare_name(structured, "older_name"),
                "newer_name": _compare_name(structured, "newer_name"),
                "page": page,
                "changes": _compare_changes(structured, page),
                "summary": summary,
            }
        ).model_dump(exclude_none=True)
    except ValidationError:
        logger.warning("The revision comparison could not be shown as a card", exc_info=True)
        return None
    pair = (card["older_id"], card["newer_id"], card["page"])
    for index, shown in enumerate(registry.snapshot()):
        if (
            shown.get("type") == REVISION_COMPARE_CARD_TYPE
            and (
                shown.get("older_id"),
                shown.get("newer_id"),
                shown.get("page"),
            )
            == pair
        ):
            return index + 1
    registry.add(card)
    return len(registry)
