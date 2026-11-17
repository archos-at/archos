from __future__ import annotations

import bisect
import re
from contextvars import ContextVar
from contextvars import Token
from dataclasses import dataclass
from typing import Literal

from agent.knowledge.project_experience import folded_for_quote

NOT_FOUND: Literal[False] = False
MAX_CLOSEST_CHARS = 200
MIN_CLOSEST_OVERLAP = 0.4

_WORD = re.compile(r"\w+")


@dataclass(frozen=True)
class Closest:

    page: int | None
    text: str


@dataclass(frozen=True)
class LoggedText:

    page: int | None
    text: str
    folded: str


def _name_key(file_name: str) -> str:
    return folded_for_quote(file_name)


class IntakeReadLog:

    def __init__(self) -> None:
        self._texts: dict[str, list[LoggedText]] = {}
        self._names: dict[str, str] = {}
        self._opened: dict[str, str] = {}

    def log(self, file_name: str, page: int | None, text: str) -> None:
        name = (file_name or "").strip()
        body = (text or "").strip()
        if not name or not body:
            return
        key = _name_key(name)
        self._names.setdefault(key, name)
        entries = self._texts.setdefault(key, [])
        folded = folded_for_quote(body)
        if any(entry.folded == folded and entry.page == page for entry in entries):
            return
        entries.append(LoggedText(page=page, text=body, folded=folded))

    def mark_opened(self, file_name: str) -> None:
        name = (file_name or "").strip()
        if name:
            key = _name_key(name)
            self._names.setdefault(key, name)
            self._opened.setdefault(key, self._names[key])

    def canonical_name(self, file_name: str) -> str | None:
        return self._names.get(_name_key(file_name or ""))

    def has_text(self, file_name: str) -> bool:
        return bool(self._texts.get(_name_key(file_name or "")))

    @property
    def documents_read(self) -> list[str]:
        return list(self._opened.values())

    @property
    def files_seen(self) -> list[str]:
        return [self._names[key] for key in self._texts]

    def contains(self, file_name: str, quote: str, page: int | None = None) -> int | None | Literal[False]:
        wanted = folded_for_quote(quote or "")
        entries = self._texts.get(_name_key(file_name or ""))
        if not wanted or not entries:
            return NOT_FOUND
        hits = [entry for entry in entries if wanted in entry.folded]
        if hits:
            named = next((entry for entry in hits if page is not None and entry.page == page), None)
            return (named or hits[0]).page
        return _across_pages(entries, wanted)

    def closest(self, file_name: str, quote: str, page: int | None = None) -> Closest | None:
        wanted = {word.casefold() for word in _WORD.findall(folded_for_quote(quote or ""))}
        entries = self._texts.get(_name_key(file_name or ""))
        if not wanted or not entries:
            return None
        best: tuple[float, bool, int | None, str] | None = None
        for entry in entries:
            found = _best_window(entry.text, wanted, len(_WORD.findall(quote or "")))
            if found is None:
                continue
            score, text = found
            candidate = (score, entry.page == page and page is not None, entry.page, text)
            if best is None or candidate[:2] > best[:2]:
                best = candidate
        if best is None or best[0] < MIN_CLOSEST_OVERLAP:
            return None
        return Closest(page=best[2], text=best[3])


def _across_pages(entries: list[LoggedText], wanted: str) -> int | None | Literal[False]:
    ordered = sorted(entries, key=lambda entry: (entry.page is None, entry.page or 0))
    starts: list[int] = []
    parts: list[str] = []
    offset = 0
    for entry in ordered:
        starts.append(offset)
        parts.append(entry.folded)
        offset += len(entry.folded) + 1
    found = " ".join(parts).find(wanted)
    if found < 0:
        return NOT_FOUND
    return ordered[bisect.bisect_right(starts, found) - 1].page


def _best_window(text: str, wanted: set[str], length: int) -> tuple[float, str] | None:
    words = text.split()
    if not words:
        return None
    size = max(1, min(length + max(2, length // 2), len(words)))
    keys = [{token.casefold() for token in _WORD.findall(word)} for word in words]
    best_score, best_start = -1.0, 0
    for start in range(0, len(words) - size + 1):
        held = set().union(*keys[start : start + size]) & wanted
        score = len(held) / len(wanted)
        if score > best_score:
            best_score, best_start = score, start
    passage = " ".join(words[best_start : best_start + size])
    return best_score, passage[:MAX_CLOSEST_CHARS].rstrip()


_READ_LOG: ContextVar[IntakeReadLog | None] = ContextVar("intake_read_log", default=None)


def bind_read_log(log: IntakeReadLog | None = None) -> tuple[IntakeReadLog, Token]:
    bound = log if log is not None else IntakeReadLog()
    return bound, _READ_LOG.set(bound)


def reset_read_log(token: Token) -> None:
    _READ_LOG.reset(token)


def current_read_log() -> IntakeReadLog | None:
    return _READ_LOG.get()
