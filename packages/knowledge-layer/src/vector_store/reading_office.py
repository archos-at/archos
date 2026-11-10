"""The office a search reads as: what ``vector_store.scope.ScopeRead`` needs beside the scopes.

Every Qdrant search over an office's own scopes (its shelf, a project, a
session) carries the office it is made for, and is refused without one
(``ScopeRead``). The retriever asks :func:`office_for`, which answers, in order:

1. the office a caller named for this context (:func:`reading_as`): a plain
   FastAPI route of ``agent_host``, where the agent runtime's context headers are
   never populated, names the organization of its own signed request;
2. the organization of the request context (its organization header, or the
   signed envelope's), which a chat turn, a background run and the internal
   tool door carry;
3. for office-shelf scopes, the organization the shelf's name holds, when all
   of them name the same one.

Anything else is None, and a tenant read with no office is never built.

The third rule can only ever name the office that owns the shelf being read,
so it reaches nothing the scope list does not already; a read with it still
carries the office condition, which drops a point another office wrote there.

:func:`office_read` is the one-scope form the structural reads use: the
office condition for a scroll, raising for a tenant scope no office is named for.
"""

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
    """Searches inside the block read as ``office_id``; None leaves the request context to say."""
    token = _OFFICE.set((office_id or "").strip() or None)
    try:
        yield
    finally:
        _OFFICE.reset(token)


def office_for(scopes: Sequence[str]) -> str | None:
    """The office a search over ``scopes`` reads as, or None when nothing names one."""
    named = _OFFICE.get() or project_context.get_organization_id_from_context()
    if named:
        return named
    shelves = {office_shelf_organization_id(scope) for scope in scopes}
    if None in shelves or len(shelves) != 1:
        return None
    return shelves.pop()


@contextmanager
def reading_for_maintenance() -> Iterator[None]:
    """Structural reads inside the block are the platform's own sweep and carry no office condition.

    For a job that reads every office's collections on the platform's behalf
    and writes back only into the collection it read (the summary
    reconciliation). Never for a read whose result reaches a person or a turn.
    """
    token = _MAINTENANCE.set(True)
    try:
        yield
    finally:
        _MAINTENANCE.reset(token)


def office_read(scope: str) -> list[models.Filter]:
    """The office condition for a scroll of ``scope`` (none for the corpus); a tenant scope with no office raises."""
    if _MAINTENANCE.get():
        return []
    return ScopeRead((scope,), office_for([scope])).office()
