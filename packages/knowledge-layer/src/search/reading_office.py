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
"""

from __future__ import annotations

from collections.abc import Iterator
from collections.abc import Sequence
from contextlib import contextmanager
from contextvars import ContextVar

from agent import project_context
from agent.common.source_kinds import office_shelf_organization_id

_OFFICE: ContextVar[str | None] = ContextVar("reading_office", default=None)


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
