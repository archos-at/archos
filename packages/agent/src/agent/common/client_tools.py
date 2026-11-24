from __future__ import annotations

from collections.abc import Iterable
from contextvars import ContextVar
from dataclasses import dataclass
from dataclasses import field

KNOWN_CLIENT_TOOLS: frozenset[str] = frozenset({"show_in_viewer"})


@dataclass
class _TurnClientTools:
    declared: frozenset[str]
    claimed: set[str] = field(default_factory=set)


_TURN: ContextVar[_TurnClientTools | None] = ContextVar("turn_client_tools", default=None)


def set_turn_client_tools(names: Iterable[str] | None) -> None:
    declared = frozenset(name for name in (names or ()) if name in KNOWN_CLIENT_TOOLS)
    _TURN.set(_TurnClientTools(declared))


def client_tool_declared(name: str) -> bool:
    turn = _TURN.get()
    return turn is not None and name in turn.declared


def claim_once(name: str) -> bool:
    turn = _TURN.get()
    if turn is None or name in turn.claimed:
        return False
    turn.claimed.add(name)
    return True
