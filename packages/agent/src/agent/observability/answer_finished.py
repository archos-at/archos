from __future__ import annotations

import logging
import time
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any
from typing import Final

from agent.observability import posthog_client

logger = logging.getLogger(__name__)

OUTCOME_OF_FINISHED: Final = {
    "answered": "ok",
    "cancelled": "aborted",
    "refused": "refused",
    "handed_off": "handed_off",
}

DOOR_HEADER: Final = "x-turn-door"
SESSION_SOURCE_HEADER: Final = "x-turn-session-source"
ASK_DOORS: Final = frozenset({"mcp", "a2a"})
ASK_SESSION_SOURCES: Final = frozenset({"mcp", "script"})
WAKES: Final = frozenset({"thread_mention", "thread_reply", "assigned"})


@dataclass(frozen=True)
class TurnOrigin:
    door: str | None
    session_source: str | None
    trigger: str | None


TYPED_IN_CHAT: Final = TurnOrigin(door="chat", session_source="ui", trigger=None)
UNKNOWN: Final = TurnOrigin(door=None, session_source=None, trigger=None)


def turn_origin(
    *, headless: bool, trigger: str | None, door: str | None = None, session_source: str | None = None
) -> TurnOrigin:
    if trigger is None:
        return UNKNOWN if headless else TYPED_IN_CHAT
    if trigger == "agent_consult":
        known_door = door if door in ASK_DOORS else None
        known_source = session_source if session_source in ASK_SESSION_SOURCES else None
        return TurnOrigin(door=known_door, session_source=known_source, trigger=trigger)
    return TurnOrigin(door="event", session_source="ui" if trigger in WAKES else "system", trigger=trigger)


def _header(headers: Iterable[tuple[bytes, bytes]], wanted: str) -> str | None:
    for name, value in headers:
        if name.decode("latin-1").lower() == wanted:
            return value.decode("latin-1").strip()
    return None


def origin_of(trigger: Any, headers: Iterable[tuple[bytes, bytes]], *, headless: bool) -> TurnOrigin:
    pairs = list(headers) if headless else []
    return turn_origin(
        headless=headless,
        trigger=getattr(trigger, "kind", None),
        door=_header(pairs, DOOR_HEADER),
        session_source=_header(pairs, SESSION_SOURCE_HEADER),
    )


def answer_finished_properties(
    *, terminal: Any, message_id: str, conversation_id: str, duration_ms: int, origin: TurnOrigin, effort: str | None
) -> dict[str, Any]:
    failed = getattr(terminal, "type", None) == "RUN_ERROR"
    result = getattr(terminal, "result", None)
    properties = {
        "outcome": "error" if failed else OUTCOME_OF_FINISHED.get(getattr(terminal, "outcome", None), "error"),
        "duration_ms": max(0, duration_ms),
        "message_id": message_id,
        "conversation_id": conversation_id,
        "effort": effort or getattr(result, "reasoning_effort", None),
        "route": getattr(result, "routing_decision", None),
        "error_code": getattr(terminal, "code", None) if failed else None,
        "door": origin.door,
        "session_source": origin.session_source,
        "trigger": origin.trigger,
    }
    return {key: value for key, value in properties.items() if value is not None}


def report_turn_finished(turn: Any) -> None:
    try:
        properties = answer_finished_properties(
            terminal=turn.wire.terminal,
            message_id=turn.message_id,
            conversation_id=turn.wire.conversation_id,
            duration_ms=round((time.monotonic() - turn.started_at) * 1000),
            origin=turn.origin,
            effort=turn.reasoning_effort,
        )
        posthog_client.capture(
            "answer_finished",
            distinct_id=turn.asker_subject,
            properties=properties,
            organization_id=turn.organization_id,
        )
    except Exception:  # noqa: BLE001 - analytics never holds up what follows the answer
        logger.warning("answer_finished for turn %s was not sent", turn.wire.turn_id, exc_info=True)
