from __future__ import annotations

import json
import re
from dataclasses import dataclass
from dataclasses import field

from agent.citations.references import _GROUPED_CITATION_RE
from agent.citations.references import REFERENCE_HEADING_LINE_RE
from agent.citations.references import expand_grouped_citations

_ANSWER_KEY_WITHIN = 1600
_ANSWER_KEY_RE = re.compile(r'"answer"\s*:\s*"')
_CARDS_KEY_RE = re.compile(r'"cards"\s*:\s*\[')
_ANSWER_KEY_PREFIX_RE = re.compile(r'"(?:a(?:n(?:s(?:w(?:e(?:r(?:"\s*(?::\s*)?)?)?)?)?)?)?)?$')

_LINE_HOLD = 30
_SHORT_LINE_RE = re.compile(rf"[^\S\n]*(?:\S[^\S\n]*){{0,{_LINE_HOLD}}}\Z")

_MARKER_PREFIX_RE = re.compile(r"\[(?:\d[\d,\s–-]*|\[(?:c(?:a(?:r(?:d(?::\s*\d*\s*\]?)?)?)?)?)?)?$")

_HEX_PREFIX_RE = re.compile(r"[0-9A-Fa-f]{0,4}")

_ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


class AnswerProseStream:
    def __init__(self) -> None:
        self._raw = ""  # reply text not yet consumed by the state machine
        self._state = "detect"  # detect -> seek -> prose -> sources | off
        self._pending = ""  # decoded prose not yet shown
        self._line_start = True  # whether ``_pending`` begins a line
        self._scanned = 0
        self._ticks = 0
        self._code_held = False
        self._code_parts: list[str] = []
        self._emitted: list[str] = []
        self._sources: list[str] = []
        self.closed = False
        self.masthead: dict | None = None
        self._head = ""  # reply text before the ``answer`` key, for the masthead
        self._tail = ""
        self._in_cards = False
        self._cards: list[dict] = []
        self._card: _ObjectScan | None = None

    @property
    def emitted(self) -> str:
        return _joined(self._emitted)

    @property
    def sources_text(self) -> str:
        return _joined(self._sources)

    def feed(self, text: str) -> str:
        if self._state == "off" or not text:
            return ""
        if self.closed:
            self._tail += text
            self._scan_cards()
            return ""
        self._raw += text
        if self._state == "detect":
            self._detect()
        if self._state == "seek":
            self._seek()
        if self._state not in {"prose", "sources"}:
            return ""
        decoded = self._decode()
        if self._state == "sources":
            self._sources.append(decoded)  # ``_pending`` went to the sources when the state turned
            return ""
        return self._release(decoded)

    def _detect(self) -> None:
        stripped = self._raw.lstrip()
        if not stripped:
            return
        self._state = "seek" if stripped[0] in "`{" else "off"

    def _seek(self) -> None:
        match = _ANSWER_KEY_RE.search(self._raw)
        if match is None:
            partial = _ANSWER_KEY_PREFIX_RE.search(self._raw)
            cut = partial.start() if partial else len(self._raw)
            self._head += self._raw[:cut]
            self._raw = self._raw[cut:]
            if len(self._head) + len(self._raw) > _ANSWER_KEY_WITHIN:
                self._state = "off"
            return
        self.masthead = _object_prefix(self._head + self._raw[: match.start()])
        self._head = ""
        self._raw = self._raw[match.end() :]
        self._state = "prose"

    def _decode(self) -> str:
        out: list[str] = []
        raw, i = self._raw, 0
        while i < len(raw):
            char = raw[i]
            if char == '"':
                self.closed = True
                self._tail = raw[i + 1 :]
                i = len(raw)
                break
            if char != "\\":
                out.append(char)
                i += 1
                continue
            decoded, width = _escape(raw, i)
            if width == 0:
                break  # an escape split across chunks: wait for the rest
            out.append(decoded)
            i += width
        self._raw = raw[i:]
        if self.closed:
            self._scan_cards()
        return "".join(out)

    def take_cards(self) -> list[dict]:
        taken, self._cards = self._cards, []
        return taken

    def _scan_cards(self) -> None:
        if not self._in_cards:
            match = _CARDS_KEY_RE.search(self._tail)
            if match is None:
                return
            self._tail, self._in_cards = self._tail[match.end() :], True
        while True:
            self._card = self._card or self._next_card()
            if self._card is None:
                return  # the array ended, or its next element is not here yet
            end = self._card.read(self._tail)
            if end is None:
                self._tail = ""  # the card holds it
                return
            try:
                card = json.loads(self._card.text())
            except ValueError:
                card = None
            if isinstance(card, dict):
                self._cards.append(card)
            self._tail, self._card = self._tail[end:], None

    def _next_card(self) -> _ObjectScan | None:
        start = self._tail.find("{")
        if start < 0 or self._tail[:start].strip(" \n\t,"):
            return None
        self._tail = self._tail[start:]
        return _ObjectScan()

    def _release(self, decoded: str) -> str:
        if self._code_held and not self.closed and "\n" not in decoded and "`" not in decoded:
            self._code_parts.append(decoded)  # the span stays open; nothing to show
            return ""
        self._pending = "".join([self._pending, *self._code_parts, decoded])
        self._code_parts.clear()
        shown, rest, hold_line = self._through_lines(self._pending)
        if shown:
            self._scanned = self._ticks = 0  # what was read is split off
        self._ticks += rest.count("`", self._scanned)
        self._scanned = len(rest)
        if self._state == "sources":
            self._sources.append(rest)
            rest = ""
        elif self.closed:
            shown += rest
            rest = ""
        elif not hold_line:
            held = self._held(rest)
            if held < len(rest):
                shown += rest[: len(rest) - held]
                rest = rest[len(rest) - held :]
                self._scanned = self._ticks = 0
        self._pending = rest
        self._code_held = self._state == "prose" and not self.closed and not hold_line and self._ticks % 2 == 1
        shown = _expanded_after(self._emitted, shown)
        if shown:
            self._line_start = shown.endswith("\n")
            self._emitted.append(shown)
        return shown

    def _through_lines(self, text: str) -> tuple[str, str, bool]:
        shown = ""
        line_start = self._line_start
        skip = self._scanned  # no newline before this in the text kept last time
        while True:
            newline = text.find("\n", skip)
            line = text if newline < 0 else text[:newline]
            ended = newline >= 0 or self.closed
            if line_start and ended and REFERENCE_HEADING_LINE_RE.fullmatch(line.rstrip()):
                self._state = "sources"
                return shown, text, False
            if newline < 0:
                return shown, text, line_start and _is_short(line)
            shown += text[: newline + 1]
            text = text[newline + 1 :]
            line_start, skip = True, 0

    def _held(self, line: str) -> int:
        code = 0 if self._ticks % 2 == 0 else len(line) - line.index("`")
        if code == len(line):
            return code  # the whole line waits; no marker can hold more
        return max(code, _held_tail(line))


def _is_short(line: str) -> bool:
    return len(line) <= _LINE_HOLD or _SHORT_LINE_RE.match(line) is not None


def _object_prefix(text: str) -> dict | None:
    start = text.find("{")
    if start < 0:
        return None
    body = text[start:].rstrip().rstrip(",").rstrip()
    if body == "{":
        return None
    try:
        parsed = json.loads(body + "}")
    except ValueError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _joined(parts: list[str]) -> str:
    if len(parts) > 1:
        parts[:] = ["".join(parts)]
    return parts[0] if parts else ""


@dataclass
class _ObjectScan:
    parts: list[str] = field(default_factory=list)  # the object's text read so far
    depth: int = 0
    in_string: bool = False
    escaped: bool = False

    def read(self, text: str) -> int | None:
        for index, char in enumerate(text):
            if self._closes_on(char):
                self.parts.append(text[: index + 1])
                return index + 1
        self.parts.append(text)
        return None

    def text(self) -> str:
        return "".join(self.parts)

    def _closes_on(self, char: str) -> bool:
        if self.in_string:
            self._string_char(char)
        elif char == '"':
            self.in_string = True
        elif char == "{":
            self.depth += 1
        elif char == "}":
            self.depth -= 1
            return self.depth == 0
        return False

    def _string_char(self, char: str) -> None:
        if self.escaped:
            self.escaped = False
        elif char == "\\":
            self.escaped = True
        elif char == '"':
            self.in_string = False


def _expanded_after(shown_parts: list[str], pending: str) -> str:
    if _GROUPED_CITATION_RE.search(pending) is None:
        return pending
    shown = _joined(shown_parts)
    whole = expand_grouped_citations(shown + pending, unterminated_fence_is_code=True)
    if whole.startswith(shown):
        return whole[len(shown) :]
    return expand_grouped_citations(pending, unterminated_fence_is_code=True)


def _held_tail(text: str) -> int:
    match = _MARKER_PREFIX_RE.search(text)
    if match is None:
        return 0
    return len(text) - match.start()


def _escape(raw: str, i: int) -> tuple[str, int]:
    if i + 1 >= len(raw):
        return "", 0
    code = raw[i + 1]
    if code in _ESCAPES:
        return _ESCAPES[code], 2
    if code != "u":
        return raw[i : i + 2], 2  # not JSON; show it as written rather than stall
    if not _HEX_PREFIX_RE.fullmatch(raw[i + 2 : i + 6]):
        return raw[i : i + 2], 2  # ``\u`` not followed by four hex digits
    if i + 6 > len(raw):
        return "", 0
    point = int(raw[i + 2 : i + 6], 16)
    if 0xDC00 <= point < 0xE000:
        return raw[i : i + 6], 6  # a low surrogate with no high one
    if not 0xD800 <= point < 0xDC00:
        return chr(point), 6
    return _surrogate_pair(raw, i, point)


def _surrogate_pair(raw: str, i: int, high: int) -> tuple[str, int]:
    if i + 8 > len(raw):
        return "", 0
    if raw[i + 6 : i + 8] != "\\u":
        return raw[i : i + 6], 6
    if i + 12 > len(raw):
        return "", 0
    digits = raw[i + 8 : i + 12]
    low = int(digits, 16) if _HEX_PREFIX_RE.fullmatch(digits) else 0
    if not 0xDC00 <= low < 0xE000:
        return raw[i : i + 6], 6  # the next escape is decoded on its own
    return chr(0x10000 + ((high - 0xD800) << 10) + (low - 0xDC00)), 12
