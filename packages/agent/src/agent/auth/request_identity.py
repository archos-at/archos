from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any

_current_user: ContextVar[dict[str, Any]] = ContextVar(
    "_current_user",
    default={"type": "internal", "skip_clarifier": False},
)


def get_current_user() -> dict[str, Any]:
    return _current_user.get()


@contextmanager
def user_context(user: dict[str, Any]) -> Iterator[None]:
    token = _current_user.set(user)
    try:
        yield
    finally:
        _current_user.reset(token)


def skip_clarifier_requested() -> bool:
    return bool(get_current_user().get("skip_clarifier"))


def headless_turn_requested() -> bool:
    return bool(get_current_user().get("headless"))
