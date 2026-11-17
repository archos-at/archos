from __future__ import annotations

import hashlib
import json
import logging
import re
from collections.abc import Iterable
from collections.abc import Iterator
from collections.abc import Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from contextvars import Token
from dataclasses import dataclass
from dataclasses import field
from typing import Any

from pydantic import BaseModel
from pydantic import ConfigDict

from agent.common.passage_fence import neutralise_tags

logger = logging.getLogger(__name__)

PUBLIC_OPEN = "public_open"
PUBLIC_RESTRICTED = "public_restricted"
LICENSED = "licensed"
LICENCE_CLASSES = (PUBLIC_OPEN, PUBLIC_RESTRICTED, LICENSED)

LICENCE_CLASS_KEY = "licence_class"
QUOTE_MAX_CHARS_KEY = "quote_max_chars"
EDITION_KEY = "knowledge_edition_id"
AI_PROCESSING_KEY = "ai_processing_attested"

DEFAULT_QUOTE_MAX_CHARS = 500

SHINGLE_CHARS = 24

MAX_PASSAGES_PER_TURN = 2048

ANSWER_QUOTE_FACTOR = 3

CAP_MARKER = "[…]"

REFERENCE_RE = re.compile(r"⟦licensed:(lp_[0-9a-f]{16})(?:\.([A-Za-z0-9_-]+))?⟧")

LICENSED_LINE = (
    "licensed — the office's own licensed copy. Quote at most {cap} characters of it per quote, in the "
    "language it is written in: a translation of it is no quote and no source; answering in another language, "
    "say which language the quote is in. Where a value, above all in a table, cannot be read reliably, do not "
    "state it: name the page and the clause or table where it stands."
)

EDITION_LABEL = (
    " Label it in the answer as the office's copy with its edition and last check, as the office base knowledge "
    "states them for edition {edition}, e.g. „Norm, Büroexemplar Ausgabe 2017, zuletzt geprüft am 12.09.2026“."
)

LICENSED_TRACE_TAG = "licensed-text"

LICENSED_QUOTE_CAPPED_SCORE = "licensed-quote-capped"

UNATTESTED_LINE = "licensed — the office's own copy, not confirmed for AI processing: listed only, never quoted."

WITHHELD_NOTE = (
    "[Licensed text: listed, not readable in this conversation. Cite the document, page and clause; "
    "state no value from it.]"
)

UNATTESTED_NOTE = (
    "[Licensed text: listed only. The office has not confirmed that its licence covers processing by AI "
    "services, so no text of it is available. Name the document, its edition and the clause; quote nothing and "
    "state no value from it.]"
)

NOT_ZERO_RETENTION_NOTE = (
    "[Licensed text: not sent, because this model call is not limited to zero-data-retention providers. "
    "Name the document, its page and clause; quote nothing from it.]"
)

EXPIRED_NOTE = "[Licensed text from an earlier turn, not carried over. Search or read it again to quote it.]"


def passage_digest(text: str) -> str:
    return "lp_" + hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


class LicenceTerms(BaseModel):
    model_config = ConfigDict(frozen=True)

    licence_class: str
    quote_max_chars: int = DEFAULT_QUOTE_MAX_CHARS
    ai_processing: bool = False
    edition_id: str | None = None

    @property
    def licensed(self) -> bool:
        return self.licence_class == LICENSED

    @property
    def model_readable(self) -> bool:
        return not self.licensed or self.ai_processing


def licence_from_metadata(metadata: Mapping[str, Any] | None) -> LicenceTerms | None:
    raw = (metadata or {}).get(LICENCE_CLASS_KEY)
    if not raw:
        return None
    licence_class = str(raw) if str(raw) in LICENCE_CLASSES else LICENSED
    cap = (metadata or {}).get(QUOTE_MAX_CHARS_KEY)
    quote_max_chars = int(cap) if isinstance(cap, int | float | str) and str(cap).isdigit() and int(cap) > 0 else None
    return LicenceTerms(
        licence_class=licence_class,
        quote_max_chars=quote_max_chars or DEFAULT_QUOTE_MAX_CHARS,
        ai_processing=(metadata or {}).get(AI_PROCESSING_KEY) is True,
        edition_id=str((metadata or {}).get(EDITION_KEY) or "") or None,
    )


@dataclass
class LicensedCapture:
    text_allowed: bool
    passages: dict[str, tuple[str, int]] = field(default_factory=dict)
    read_any: bool = False
    capped_quotes: int = 0
    _cap: QuoteCap | None = None

    def file(self, text: str, quote_max_chars: int) -> str:
        ref = passage_digest(text)
        self.read_any = True
        held = self.passages.pop(ref, None)
        self.passages[ref] = (text, min(quote_max_chars, held[1]) if held else quote_max_chars)
        while len(self.passages) > MAX_PASSAGES_PER_TURN:
            del self.passages[next(iter(self.passages))]
        self._cap = None
        return ref

    def quote_cap(self) -> QuoteCap | None:
        if not self.passages:
            return None
        if self._cap is None:
            self._cap = QuoteCap(self.passages.values())
        return self._cap


_capture: ContextVar[LicensedCapture | None] = ContextVar("licensed_capture", default=None)


def begin_licensed_capture(*, text_allowed: bool) -> Token:
    return _capture.set(LicensedCapture(text_allowed=text_allowed))


def end_licensed_capture(token: Token) -> None:
    capture = _capture.get()
    if capture is not None:
        capture.passages.clear()
        if capture.read_any:
            _emit_capped_score(capture.capped_quotes)
    _capture.reset(token)


def _emit_capped_score(capped: int) -> None:
    try:
        from agent.observability.langfuse_scores import RuntimeScore
        from agent.observability.langfuse_scores import emit_scores

        emit_scores([RuntimeScore(LICENSED_QUOTE_CAPPED_SCORE, float(capped))], writer="licensed-seam")
    except Exception:  # noqa: BLE001 - a score must never fail the turn that earned it
        logger.debug("licensed-quote-capped not emitted", exc_info=True)


def current_capture() -> LicensedCapture | None:
    return _capture.get()


def licensed_body(body: str, terms: LicenceTerms | None, *, anchor: str | None = None) -> str:
    if terms is None or not terms.licensed:
        return body
    if not terms.ai_processing:
        return UNATTESTED_NOTE
    capture = _capture.get()
    if capture is None or not capture.text_allowed:
        return WITHHELD_NOTE
    if not capture.read_any:
        mark_licensed_turn()
    ref = capture.file(body, terms.quote_max_chars)
    return f"⟦licensed:{ref}.{anchor}⟧" if anchor else f"⟦licensed:{ref}⟧"


def mark_licensed_turn() -> None:
    from agent.common.turn_status import emit_technical
    from agent.observability.langfuse_trace_attributes import add_trace_tag
    from agent.observability.turn_outcome import record_turn_tag

    add_trace_tag(LICENSED_TRACE_TAG)
    record_turn_tag(LICENSED_TRACE_TAG)
    emit_technical(LICENSED_TRACE_TAG)


def licence_line(terms: LicenceTerms | None) -> str | None:
    if terms is None or not terms.licensed:
        return None
    if not terms.ai_processing:
        return UNATTESTED_LINE
    label = EDITION_LABEL.format(edition=terms.edition_id) if terms.edition_id else ""
    return LICENSED_LINE.format(cap=terms.quote_max_chars) + label


def quotable(body: str, terms: LicenceTerms | None) -> str | None:
    if terms is None or not terms.licensed:
        return body or None
    return (body[: terms.quote_max_chars] or None) if terms.ai_processing else None


def _expand_text(
    text: str, passages: Mapping[str, tuple[str, int]], used: dict[str, tuple[str, int]], send: bool
) -> str:
    def replace(match: re.Match[str]) -> str:
        found = passages.get(match.group(1))
        if found is None:
            return EXPIRED_NOTE
        if not send:
            return NOT_ZERO_RETENTION_NOTE
        used[match.group(1)] = found
        return neutralise_tags(found[0])

    return REFERENCE_RE.sub(replace, text)


def _expand_content(
    content: Any, passages: Mapping[str, tuple[str, int]], used: dict[str, tuple[str, int]], send: bool
) -> Any:
    if isinstance(content, str):
        return _expand_text(content, passages, used, send) if "⟦licensed:" in content else content
    if isinstance(content, list):
        expanded = [_expand_content(part, passages, used, send) for part in content]
        return content if all(a is b for a, b in zip(expanded, content, strict=True)) else expanded
    if isinstance(content, dict) and isinstance(content.get("text"), str):
        text = _expand_content(content["text"], passages, used, send)
        return content if text is content["text"] else {**content, "text": text}
    return content


def expand_messages(messages: Any, *, zero_retention: bool) -> tuple[Any, QuoteCap | None]:
    if not isinstance(messages, list):
        return messages, None
    capture = _capture.get()
    passages = capture.passages if capture is not None else {}
    used: dict[str, tuple[str, int]] = {}
    out: list[Any] = []
    for message in messages:
        content = message.get("content") if isinstance(message, dict) else getattr(message, "content", None)
        expanded = _expand_content(content, passages, used, zero_retention)
        if expanded is content:
            out.append(message)
        elif isinstance(message, dict):
            out.append({**message, "content": expanded})
        else:
            out.append(message.model_copy(update={"content": expanded}))
    if all(a is b for a, b in zip(out, messages, strict=True)):
        return messages, None
    return out, QuoteCap(used.values(), capture) if used else None


def _normalised(char: str) -> str:
    return " " if char.isspace() else char.lower()


def _normalised_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).lower()


_ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f"}


class QuoteCap:
    def __init__(self, passages: Iterable[tuple[str, int]], capture: LicensedCapture | None = None) -> None:
        self._capture = capture
        self._grams: dict[str, int] = {}
        caps: list[int] = []
        for text, cap in passages:
            caps.append(cap)
            norm = _normalised_text(text)
            for start in range(max(0, len(norm) - SHINGLE_CHARS + 1)):
                gram = norm[start : start + SHINGLE_CHARS]
                held = self._grams.get(gram)
                self._grams[gram] = cap if held is None else min(held, cap)
        self.budget = ANSWER_QUOTE_FACTOR * min(caps) if caps else 0
        self.quoted = 0
        self.capped_runs = 0
        self.chunk_capper: Any = None

    def stream(self, *, json_raw: bool = False) -> _Run:
        return _Run(self, json_raw=json_raw)

    def cap_text(self, text: str, *, json_raw: bool = False) -> str:
        return self.stream(json_raw=json_raw).feed(text) if self._grams else text

    def gram_cap(self, gram: str) -> int | None:
        return self._grams.get(gram)

    def shares_shingle(self, text: str) -> bool:
        norm = _normalised_text(text)
        return any(norm[start : start + SHINGLE_CHARS] in self._grams for start in range(len(norm) - SHINGLE_CHARS + 1))


class _Run:
    __slots__ = ("_owner", "_json_raw", "_window", "_last", "_length", "_cap", "_marked", "_escape")

    def __init__(self, owner: QuoteCap, *, json_raw: bool) -> None:
        self._owner = owner
        self._json_raw = json_raw
        self._window = ""
        self._last = ""
        self._length = 0
        self._cap: int | None = None
        self._marked = False
        self._escape = ""

    def _logical(self, char: str) -> tuple[str | None, bool]:
        if not self._json_raw:
            return char, True
        if self._escape == "\\":
            if char == "u":
                self._escape = "u"
                return None, False
            self._escape = ""
            return _ESCAPES.get(char, char), False
        if self._escape.startswith("u"):
            self._escape += char
            if len(self._escape) < 5:
                return None, False
            digits, self._escape = self._escape[1:], ""
            try:
                return chr(int(digits, 16)), False
            except ValueError:
                return None, False
        if char == "\\":
            self._escape = "\\"
            return None, False
        return char, char != '"'

    def feed(self, piece: str) -> str:
        out: list[str] = []
        for char in piece:
            logical, cuttable = self._logical(char)
            past_cap = logical is not None and self._advance(logical) and cuttable
            out.append(self._cut() if past_cap else char)
        return "".join(out)

    def _cut(self) -> str:
        if self._marked:
            return ""
        self._marked = True
        self._owner.capped_runs += 1
        if self._owner._capture is not None:
            self._owner._capture.capped_quotes += 1
        return CAP_MARKER

    def _advance(self, logical: str) -> bool:
        norm = _normalised(logical)
        if norm == " " and self._last == " ":
            return self._length > 0 and self._cap is not None and self._past()
        self._last = norm
        self._window = (self._window + norm)[-SHINGLE_CHARS:]
        cap = self._owner.gram_cap(self._window) if len(self._window) == SHINGLE_CHARS else None
        if cap is None:
            self._length, self._cap, self._marked = 0, None, False
            return False
        starting = not self._length
        self._length = self._length + 1 if self._length else SHINGLE_CHARS
        self._cap = cap if self._cap is None else min(self._cap, cap)
        if self._past():
            return True
        self._owner.quoted += SHINGLE_CHARS if starting else 1
        return False

    def _past(self) -> bool:
        return self._length > self._cap or self._owner.quoted >= self._owner.budget


_metadata_only: ContextVar[bool] = ContextVar("licensed_ingest", default=False)
_reads_refused: ContextVar[bool] = ContextVar("licensed_reads_refused", default=False)


class UnattestedLicensedText(RuntimeError): ...


@contextmanager
def licensed_document_scope(terms: LicenceTerms | None) -> Iterator[None]:
    licensed = terms is not None and terms.licensed
    traced = _metadata_only.set(licensed or _metadata_only.get())
    refused = _reads_refused.set((licensed and not terms.ai_processing) or _reads_refused.get())
    try:
        yield
    finally:
        _reads_refused.reset(refused)
        _metadata_only.reset(traced)


licensed_ingest = licensed_document_scope


def licensed_scope_active() -> bool:
    return _metadata_only.get()


def refuse_unattested_model_read(url: str | None = None, *, openrouter: bool = True) -> None:
    if _reads_refused.get():
        raise UnattestedLicensedText(
            "this document is licensed and its licence is not attested for AI processing: no model may read it"
        )
    if _metadata_only.get() and not openrouter:
        raise UnattestedLicensedText(
            f"licensed text goes only to zero-retention endpoints through OpenRouter, not to {url or 'this endpoint'}"
        )


def trace_payload(text: str) -> str:
    if _metadata_only.get():
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        return json.dumps({"licensed": "metadata only", "chars": len(text), "sha256": digest})
    capture = _capture.get()
    cap = capture.quote_cap() if capture is not None else None
    return cap.cap_text(text, json_raw=True) if cap is not None else text


WEB_SEARCH_REFUSAL = (
    "Web search refused: the query repeats text from the office's licensed copy, and licensed text goes to no "
    "search provider. Search with your own words: the topic, the designation and the clause."
)


def refused_outbound_query(query: str) -> str | None:
    capture = _capture.get()
    cap = capture.quote_cap() if capture is not None else None
    return WEB_SEARCH_REFUSAL if cap is not None and cap.shares_shingle(query) else None
