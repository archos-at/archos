from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

_stated: ContextVar[frozenset[str] | None] = ContextVar("turn_project_models", default=None)


def set_stated(kinds: frozenset[str] | None) -> None:
    _stated.set(kinds)


def stated() -> frozenset[str] | None:
    return _stated.get()


def turn_states(kind: str) -> bool:
    return kind in (_stated.get() or ())


@contextmanager
def stating(kinds: frozenset[str]) -> Iterator[None]:
    token = _stated.set(kinds)
    try:
        yield
    finally:
        _stated.reset(token)
