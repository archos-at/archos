from __future__ import annotations

from collections.abc import Iterator
from collections.abc import Sequence
from contextlib import contextmanager
from contextvars import ContextVar

from qdrant_client import models

from agent import project_context
from agent.common.source_kinds import office_shelf_organization_id

from .scope import ScopeRead

_OFFICE: ContextVar[str | None] = ContextVar("reading_office", default=None)
_MAINTENANCE: ContextVar[bool] = ContextVar("reading_for_maintenance", default=False)


@contextmanager
def reading_as(office_id: str | None) -> Iterator[None]:
    token = _OFFICE.set((office_id or "").strip() or None)
    try:
        yield
    finally:
        _OFFICE.reset(token)


def office_for(scopes: Sequence[str]) -> str | None:
    named = _OFFICE.get() or project_context.get_organization_id_from_context()
    if named:
        return named
    shelves = {office_shelf_organization_id(scope) for scope in scopes}
    if None in shelves or len(shelves) != 1:
        return None
    return shelves.pop()


@contextmanager
def reading_for_maintenance() -> Iterator[None]:
    token = _MAINTENANCE.set(True)
    try:
        yield
    finally:
        _MAINTENANCE.reset(token)


def office_read(scope: str) -> list[models.Filter]:
    if _MAINTENANCE.get():
        return []
    return ScopeRead((scope,), office_for([scope])).office()
