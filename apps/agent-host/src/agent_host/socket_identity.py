from __future__ import annotations

import time
from collections.abc import Mapping
from typing import TYPE_CHECKING
from typing import Any

if TYPE_CHECKING:
    from agent_host.chat_turn import RunningTurn


def verified_subject(user: Mapping[str, Any]) -> str | None:
    for key in ("sub", "user_id", "id"):
        value = user.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def verified_display_name(user: Mapping[str, Any]) -> str | None:
    for key in ("name", "email"):
        value = user.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def token_expired(user: Mapping[str, Any]) -> bool:
    exp = user.get("exp")
    return isinstance(exp, int | float) and time.time() >= exp


def may_act_for(asker: str | None, actor: str | None, *, internal: bool) -> bool:
    return internal or asker is None or actor == asker


def trace_user_id(turn: RunningTurn, caller: Mapping[str, Any]) -> str | None:
    return turn.asker_subject or turn.envelope_user_id or caller.get("type")
