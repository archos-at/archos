from __future__ import annotations

import threading
import time

from agent.stages.flags import fetch_turn_flags

TTL_SECONDS = 60
_MAX_ORGANIZATIONS = 1000

_lock = threading.Lock()
_answers: dict[str, tuple[bool, float]] = {}


def _fetch(organization_id: str) -> bool:
    return fetch_turn_flags(organization_id=organization_id).folder_cards_allowed


def check(organization_id: str | None) -> bool:
    if not organization_id:
        return False
    now = time.monotonic()
    with _lock:
        held = _answers.get(organization_id)
    if held is not None and now - held[1] < TTL_SECONDS:
        return held[0]
    answer = _fetch(organization_id)
    with _lock:
        _answers.pop(organization_id, None)
        _answers[organization_id] = (answer, now)
        if len(_answers) > _MAX_ORGANIZATIONS:
            del _answers[next(iter(_answers))]
    return answer


def enabled_for(organization_id: str | None) -> bool:
    try:
        return check(organization_id)
    except Exception:  # noqa: BLE001 - off is the safe answer for an entitlement
        return False


def forget() -> None:
    with _lock:
        _answers.clear()
