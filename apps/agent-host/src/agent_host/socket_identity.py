"""Who a chat socket's turn belongs to: the verified subject of the handshake, and the user its trace is filed under."""

from __future__ import annotations

import time
from collections.abc import Mapping
from typing import TYPE_CHECKING
from typing import Any

if TYPE_CHECKING:
    from agent_host.chat_socket import RunningTurn


def verified_subject(user: Mapping[str, Any]) -> str | None:
    """The stable identity of the human holding the socket, from VERIFIED claims.

    Internal and anonymous callers carry none; they are trusted by other means
    (a service token, not a user), see :func:`may_act_for`.
    """
    for key in ("sub", "user_id", "id"):
        value = user.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def verified_display_name(user: Mapping[str, Any]) -> str | None:
    """The display name from the verified claims, preferred over a client-supplied ``author_name``."""
    for key in ("name", "email"):
        value = user.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def token_expired(user: Mapping[str, Any]) -> bool:
    """Whether the handshake token has passed its ``exp``. Callers without one never expire."""
    exp = user.get("exp")
    return isinstance(exp, int | float) and time.time() >= exp


def may_act_for(asker: str | None, actor: str | None, *, internal: bool) -> bool:
    """Whether ``actor`` may stop, or answer a question of, a turn ``asker`` asked.

    An internal caller may. A turn with no verified asker (an internal or
    anonymous caller asked) has no identity to match. Everyone else must be the
    asker: in a shared conversation a colleague is a different subject, and the
    assistant asked one person.
    """
    return internal or asker is None or actor == asker


def trace_user_id(turn: RunningTurn, caller: Mapping[str, Any]) -> str | None:
    """The user a turn's trace is filed under: the verified subject, else the envelope's user, else the caller type.

    The BFF reaches the socket with a service token, so its caller has no
    subject and the trace used to read ``internal`` for a customer's chat.
    The envelope is signed, so its user is as verified as a subject.
    """
    return turn.asker_subject or turn.envelope_user_id or caller.get("type")
