from __future__ import annotations

import re
from typing import Any

from agent.common.wire_v2 import RunErrorBody
from agent.common.wire_v2 import RunFinishedBody

OUTCOME_OF_TERMINAL = {"answered": "answered", "refused": "refused", "handed_off": "handed_off", "cancelled": "stopped"}

OUTCOME_REASON_CHARS = 500

_TURN_ID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _outcome_reason(text: str) -> str | None:
    flat = " ".join((text or "").split())
    if not flat:
        return None
    return flat if len(flat) <= OUTCOME_REASON_CHARS else flat[: OUTCOME_REASON_CHARS - 1].rstrip() + "…"


def turn_outcome_report(
    conversation_id: str, turn_id: str, terminal: RunFinishedBody | RunErrorBody
) -> dict[str, Any] | None:
    if not _TURN_ID.match(turn_id):
        return None
    if isinstance(terminal, RunErrorBody):
        outcome, reason = "failed", _outcome_reason(terminal.message) or "failed"
    else:
        outcome = OUTCOME_OF_TERMINAL[terminal.outcome]
        reason = _outcome_reason(terminal.result.text) if outcome == "refused" else None
    return {"conversation_id": conversation_id, "turn_id": turn_id, "outcome": outcome, "reason": reason}
