from __future__ import annotations

import asyncio
from contextvars import ContextVar
from contextvars import Token

from agent.common.plan_documents import PlanDocument


class _AddedDocuments:

    def __init__(self, queue: list[PlanDocument]) -> None:
        self.queue = queue
        self.taken = 0


_WRITE_NOW: ContextVar[asyncio.Event | None] = ContextVar("deep_research_write_now", default=None)
_WRITE_NOW_HONOURED: ContextVar[list[bool] | None] = ContextVar("deep_research_write_now_honoured", default=None)
_ADDED_DOCUMENTS: ContextVar[_AddedDocuments | None] = ContextVar("deep_research_added_documents", default=None)


def bind_write_now(signal: asyncio.Event | None) -> Token:
    return _WRITE_NOW.set(signal)


def reset_write_now(token: Token) -> None:
    _WRITE_NOW.reset(token)


def write_now_requested() -> bool:
    signal = _WRITE_NOW.get()
    return signal is not None and signal.is_set()


def begin_write_now_record() -> Token:
    return _WRITE_NOW_HONOURED.set([])


def end_write_now_record(token: Token) -> None:
    _WRITE_NOW_HONOURED.reset(token)


def note_write_now_honoured() -> None:
    record = _WRITE_NOW_HONOURED.get()
    if record is not None:
        record.append(True)


def write_now_honoured() -> bool:
    return bool(_WRITE_NOW_HONOURED.get())


def bind_added_documents(queue: list[PlanDocument] | None) -> Token:
    return _ADDED_DOCUMENTS.set(_AddedDocuments(queue) if queue is not None else None)


def reset_added_documents(token: Token) -> None:
    _ADDED_DOCUMENTS.reset(token)


def take_added_documents() -> list[PlanDocument]:
    added = _ADDED_DOCUMENTS.get()
    if added is None:
        return []
    taken = added.queue[added.taken :]
    added.taken = len(added.queue)
    return list(taken)


def all_added_documents() -> list[PlanDocument]:
    added = _ADDED_DOCUMENTS.get()
    return list(added.queue) if added is not None else []
