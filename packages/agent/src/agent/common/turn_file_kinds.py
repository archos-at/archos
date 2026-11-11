"""Which kinds of model file the turn's project holds, as the BFF stated them. Per turn (a ``ContextVar``).

The chat agent (``turn_tools``) binds a measuring tool from it. A tool behind an
entitlement asks again when it is CALLED (:func:`turn_states`): a run that
binds the boot set without a turn's scope (a job's chat agent, the internal
tools route) carries no statement, and no statement is a refusal.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

_stated: ContextVar[frozenset[str] | None] = ContextVar("turn_project_models", default=None)


def set_stated(kinds: frozenset[str] | None) -> None:
    """Bind the kinds for this turn; None where the BFF said nothing."""
    _stated.set(kinds)


def stated() -> frozenset[str] | None:
    """The kinds the BFF stated, or None where it stated nothing."""
    return _stated.get()


def turn_states(kind: str) -> bool:
    """Whether the BFF stated this kind for the turn. False where nothing was stated at all."""
    return kind in (_stated.get() or ())


@contextmanager
def stating(kinds: frozenset[str]) -> Iterator[None]:
    """Bind the kinds for one call the BFF made for a person, then put back what stood.

    For a call that is no turn (the review view's tape, ``agent_host.routes.drawing_tape``): the BFF
    checked the entitlement and says so in the request, as it says a turn's kinds in the turn context.
    """
    token = _stated.set(kinds)
    try:
        yield
    finally:
        _stated.reset(token)
