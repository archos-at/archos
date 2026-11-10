"""Licensed text reaches a model only inside the call, and leaves it only as short quotes.

An office may hold text it licensed rather than owns: its copy of an ÖNORM or a
DIN, a paid commentary. The office carries the licence and we promised it zero
retention for that text (feld72, "zero retention for norms"): no licensed body
rests in a trace, a log, a cache, a checkpoint, a job payload, an analytics event
or an export. Only a quote of at most the licence's ``quote_max_chars`` may
persist, and only with the answer that quotes it.

The mark is the point's (or the document row's) ``licence_class``, one of
:data:`LICENCE_CLASSES`; the office layer writes it at upload (design 4.7), and
:func:`licence_from_metadata` reads it, failing closed on a value it does not
know. This module is everything that follows from the mark, in four moves:

1. **A reference, not the text.** When a grounding block renders a licensed hit
   (``common/grounding_block.py``), the body becomes one reference token
   (:func:`licensed_body`) and the text is filed in this turn's
   :class:`LicensedCapture`, an in-memory map that lives as long as the turn and
   is never serialised. So the ``ToolMessage``, the checkpoint, the agent runtime's
   span of the tool call, the Herleitung and the next turn's history all hold the
   token. A turn whose capture does not allow text (the ``licensed-seam`` flag is
   off, or the caller opened none: deep research, intake, a job) gets the hit's
   place and no text, which is what "gelistet, kein Text" means for a model.
2. **Expanded inside the call.** The chat-request contract (``llm_factory``)
   calls :func:`expand_messages` on the messages it is about to send. LangChain has
   already reported them to every callback, Langfuse's included, so the trace
   logs the token and only the provider sees the text: whole, never cut, and only on a request pinned
   to zero-retention endpoints, whose terms cover the provider's short-lived prompt cache (identical
   bytes on every call of a turn, so the later calls read the norm from it). A token from an earlier
   turn finds nothing to expand and says so (:data:`EXPIRED_NOTE`): licensed text
   is not carried between turns.
3. **Capped on the way out.** A call that expanded anything returns through
   :class:`QuoteCap`, a shingle matcher that lets a run of licensed text through
   up to the passage's ``quote_max_chars`` and drops the rest, in the answer, the
   reasoning and every tool call's arguments, before LangChain hands a token or a
   result to a callback.
4. **Redacted where it is traced directly.** A generation recorded outside the
   agent runtime (``observability.direct_trace``) passes its payloads through
   :func:`trace_payload`: capped against this turn's licensed text, and replaced
   by metadata (length and sha256) inside :func:`licensed_ingest`, the scope an
   ingest of a licensed document runs in, since the page reads ARE the text.

The cap is a floor, not a judgement: it bounds how much of a passage a single
quote can carry, it does not decide whether a quote is fair.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import secrets
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

#: The licence classes a manifestation, a search-index point or a document row may carry (design 3.4).
PUBLIC_OPEN = "public_open"
PUBLIC_RESTRICTED = "public_restricted"
LICENSED = "licensed"
LICENCE_CLASSES = (PUBLIC_OPEN, PUBLIC_RESTRICTED, LICENSED)

#: The payload keys the mark is read from (``licence_class``) and the licence's quote cap (``quote_max_chars``).
LICENCE_CLASS_KEY = "licence_class"
QUOTE_MAX_CHARS_KEY = "quote_max_chars"
#: The office edition a point belongs to (S1, ``knowledge_layer.vector_store.KNOWLEDGE_EDITION_FIELD``).
EDITION_KEY = "knowledge_edition_id"
#: Whether the office attested that its licence covers processing by the hosted AI services (indexing, model
#: reads, quotation; design 4.7). Office-wide use alone is not enough, so only ``True`` counts: a licensed
#: passage without it is usable by no model call at all.
AI_PROCESSING_KEY = "ai_processing_attested"

#: The quote cap a licensed passage gets when its terms state none: what we told feld72.
DEFAULT_QUOTE_MAX_CHARS = 500

#: Characters per shingle. Long enough that ordinary phrasing ("gemäß ÖNORM B 1600") does not
#: match by accident, short enough that a quote is caught within a line.
SHINGLE_CHARS = 24

#: How many licensed passages one turn may hold, a memory bound far above what a turn reads (its rounds are
#: bounded); past it the oldest goes first. It never cuts a passage: the model reads each one whole.
MAX_PASSAGES_PER_TURN = 2048

#: How many quote caps one reply may carry in all, every quote and channel together (the door holds the same
#: three per person and day).
ANSWER_QUOTE_FACTOR = 3

#: Written where a capped quote was cut. Plain text, safe inside a JSON string; no leading space, which would
#: extend the quote it closes by one character.
CAP_MARKER = "[…]"

_REF_RE = re.compile(r"⟦licensed:(lp_[0-9a-f]{16})⟧")

#: The ``Licence:`` header line's text, under which the passage follows as a reference.
LICENSED_LINE = (
    "licensed — the office's own licensed copy. Quote at most {cap} characters of it per quote, in the "
    "language it is written in: a translation of it is no quote and no source; answering in another language, "
    "say which language the quote is in. Where a value, above all in a table, cannot be read reliably, do not "
    "state it: name the page and the clause or table where it stands."
)

#: Added to the ``Licence:`` line of a hit that names its office edition (S1's ``knowledge_edition_id``): the
#: answer labels the copy with what the office base knowledge block states for that edition.
EDITION_LABEL = (
    " Label it in the answer as the office's copy with its edition and last check, as the office base knowledge "
    "states them for edition {edition}, e.g. „Norm, Büroexemplar Ausgabe 2017, zuletzt geprüft am 12.09.2026“."
)

#: The trace tag of a turn that read licensed text. The answer judges skip such a turn: their input would be
#: the references, not the text the answer was grounded in (``observability.langfuse_catalog``).
LICENSED_TRACE_TAG = "licensed-text"

#: The score a turn that read licensed text carries: the quotes of it a reply had cut (``SCORE_DEFINITIONS``).
LICENSED_QUOTE_CAPPED_SCORE = "licensed-quote-capped"

#: The ``Licence:`` line of a licensed hit no model may read.
UNATTESTED_LINE = "licensed — the office's own copy, not confirmed for AI processing: listed only, never quoted."

#: The body of a licensed hit on a turn that may not read licensed text.
WITHHELD_NOTE = (
    "[Licensed text: listed, not readable in this conversation. Cite the document, page and clause; "
    "state no value from it.]"
)

#: The body of a licensed hit whose licence the office has not attested for AI processing: no turn may read it.
UNATTESTED_NOTE = (
    "[Licensed text: listed only. The office has not confirmed that its licence covers processing by AI "
    "services, so no text of it is available. Name the document, its edition and the clause; quote nothing and "
    "state no value from it.]"
)

#: What a reference expands to on a request that is not pinned to zero-retention endpoints.
NOT_ZERO_RETENTION_NOTE = (
    "[Licensed text: not sent, because this model call is not limited to zero-data-retention providers. "
    "Name the document, its page and clause; quote nothing from it.]"
)

#: What a reference from an earlier turn expands to: the text is not carried between turns.
EXPIRED_NOTE = "[Licensed text from an earlier turn, not carried over. Search or read it again to quote it.]"


class LicenceTerms(BaseModel):
    """What a passage's licence allows: its class, and the longest quote of it an answer may carry."""

    model_config = ConfigDict(frozen=True)

    licence_class: str
    quote_max_chars: int = DEFAULT_QUOTE_MAX_CHARS
    #: The office attested that its licence covers processing by the hosted AI services (:data:`AI_PROCESSING_KEY`).
    ai_processing: bool = False
    #: The office edition the passage belongs to, for the answer's label; ``None`` when no edition is known.
    edition_id: str | None = None

    @property
    def licensed(self) -> bool:
        return self.licence_class == LICENSED

    @property
    def model_readable(self) -> bool:
        """Whether any model call may read this text: always for a public class, for a licensed one only attested."""
        return not self.licensed or self.ai_processing


def licence_from_metadata(metadata: Mapping[str, Any] | None) -> LicenceTerms | None:
    """The terms a point's payload (or a document row's fields) states, or ``None`` for an unmarked one.

    Fails CLOSED: a class this module does not know is read as ``licensed``, since a
    writer that marked a passage meant something by it, and a cap that is not a
    positive number is the default.
    """
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


# ---------------------------------------------------------------------------
# The turn's capture
# ---------------------------------------------------------------------------


@dataclass
class LicensedCapture:
    """One turn's licensed passages, by reference. In memory only; never serialised."""

    #: Whether this turn may send licensed text to the model at all (the ``licensed-seam`` flag).
    text_allowed: bool
    passages: dict[str, tuple[str, int]] = field(default_factory=dict)
    #: Whether any licensed passage was filed this turn, and how many quotes of it a reply had cut.
    read_any: bool = False
    capped_quotes: int = 0
    _cap: QuoteCap | None = None

    def file(self, text: str, quote_max_chars: int) -> str:
        ref = f"lp_{secrets.token_hex(8)}"
        self.read_any = True
        self.passages[ref] = (text, quote_max_chars)
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
    """Open this turn's capture. LangGraph copies the context per node, so the container is set once and mutated."""
    return _capture.set(LicensedCapture(text_allowed=text_allowed))


def end_licensed_capture(token: Token) -> None:
    """Close the capture and drop every passage it held."""
    capture = _capture.get()
    if capture is not None:
        capture.passages.clear()
        if capture.read_any:
            _emit_capped_score(capture.capped_quotes)
    _capture.reset(token)


def _emit_capped_score(capped: int) -> None:
    """``licensed-quote-capped`` for a turn that read licensed text: how many quotes of it a reply had cut."""
    try:
        from agent.observability.langfuse_scores import RuntimeScore
        from agent.observability.langfuse_scores import emit_scores

        emit_scores([RuntimeScore(LICENSED_QUOTE_CAPPED_SCORE, float(capped))], writer="licensed-seam")
    except Exception:  # noqa: BLE001 - a score must never fail the turn that earned it
        logger.debug("licensed-quote-capped not emitted", exc_info=True)


def licensed_body(body: str, terms: LicenceTerms | None) -> str:
    """What a hit's fence holds: ``body``, or for a licensed one a reference to its filed text or the withheld note."""
    if terms is None or not terms.licensed:
        return body
    if not terms.ai_processing:
        return UNATTESTED_NOTE
    capture = _capture.get()
    if capture is None or not capture.text_allowed:
        return WITHHELD_NOTE
    if not capture.read_any:
        _mark_turn()
    return f"⟦licensed:{capture.file(body, terms.quote_max_chars)}⟧"


def _mark_turn() -> None:
    """Mark the turn that read licensed text, once: a trace tag (the judges skip it) and a technical step.

    The step rests with the answer (``messages.metadata``, slot :data:`LICENSED_TRACE_TAG`): the lessons distiller
    reads it to take no vote on such an answer (design E44). Ids and nothing else: no text, no file name.
    """
    from agent.common.turn_status import emit_technical
    from agent.observability.langfuse_trace_attributes import add_trace_tag

    add_trace_tag(LICENSED_TRACE_TAG)
    emit_technical(LICENSED_TRACE_TAG)


def licence_line(terms: LicenceTerms | None) -> str | None:
    """The ``Licence:`` header value of a licensed hit; ``None`` for any other."""
    if terms is None or not terms.licensed:
        return None
    if not terms.ai_processing:
        return UNATTESTED_LINE
    label = EDITION_LABEL.format(edition=terms.edition_id) if terms.edition_id else ""
    return LICENSED_LINE.format(cap=terms.quote_max_chars) + label


def quotable(body: str, terms: LicenceTerms | None) -> str | None:
    """What of ``body`` may persist as a quote (the citation registry): all of a public one, the cap of an
    attested licensed one, nothing of an unattested one."""
    if terms is None or not terms.licensed:
        return body or None
    return (body[: terms.quote_max_chars] or None) if terms.ai_processing else None


# ---------------------------------------------------------------------------
# Expansion, inside the call
# ---------------------------------------------------------------------------


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

    return _REF_RE.sub(replace, text)


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
    """``messages`` with each reference replaced by its text, and the cap for the reply; ``(messages, None)`` when none.

    The text is the passage whole, as its tool returned it: the model reads what the question needs, and
    only what the answer quotes back is capped. It goes only to a request pinned to zero-retention
    endpoints (``zero_retention``, ADR-0074), whose terms cover the provider's short-lived prompt cache; any
    other request (an organization that switched retention limits off, a BYOK endpoint) gets
    :data:`NOT_ZERO_RETENTION_NOTE` instead. Expansion is deterministic, so every call of a turn sends the
    same bytes and the provider's prompt cache serves the norm to the later calls.

    A message with no reference is returned as the same object, so a call that
    touches no licensed text sends exactly what it sent before.
    """
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


# ---------------------------------------------------------------------------
# The quote cap: a shingle matcher
# ---------------------------------------------------------------------------


def _normalised(char: str) -> str:
    return " " if char.isspace() else char.lower()


def _normalised_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).lower()


_ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f"}


class QuoteCap:
    """Caps every run of licensed text in a stream at its passage's ``quote_max_chars``.

    A run is a stretch of output whose every :data:`SHINGLE_CHARS`-character window
    (case and whitespace normalised) occurs in a licensed passage. Its first
    ``quote_max_chars`` characters pass; the rest are dropped and :data:`CAP_MARKER`
    is written once where the cut is. The window keeps following the model while
    it drops, so a run that goes on stays cut.
    """

    def __init__(self, passages: Iterable[tuple[str, int]], capture: LicensedCapture | None = None) -> None:
        #: The turn whose count of capped quotes this cap adds to (``licensed-quote-capped``).
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
        #: How much licensed text one reply may carry in all, over every quote and channel: a norm is not
        #: rebuilt from quotes each under the cap (:data:`ANSWER_QUOTE_FACTOR` times the smallest cap).
        self.budget = ANSWER_QUOTE_FACTOR * min(caps) if caps else 0
        self.quoted = 0
        #: How many runs any stream of this cap has cut; the call's count of capped quotes.
        self.capped_runs = 0
        #: The ``licensed_reply.ChunkCap`` a streamed reply's chunks share, set by the first chunk.
        self.chunk_capper: Any = None

    def stream(self, *, json_raw: bool = False) -> _Run:
        """A matcher for one channel (the answer, the reasoning, one tool call's arguments).

        ``json_raw``: the channel is JSON text (a tool call's argument fragments); escape
        sequences are read as the characters they stand for and never cut.
        """
        return _Run(self, json_raw=json_raw)

    def cap_text(self, text: str, *, json_raw: bool = False) -> str:
        """``text`` with every licensed run in it capped."""
        return self.stream(json_raw=json_raw).feed(text) if self._grams else text

    def gram_cap(self, gram: str) -> int | None:
        return self._grams.get(gram)

    def shares_shingle(self, text: str) -> bool:
        """Whether ``text`` holds any :data:`SHINGLE_CHARS`-character window of a licensed passage."""
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
        #: Inside a JSON escape: ``"\\"`` after a backslash, ``"u1234"``-style while reading its digits.
        self._escape = ""

    def _logical(self, char: str) -> tuple[str | None, bool]:
        """The character ``char`` stands for (None while an escape is still open), and whether it may be cut."""
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
        """What a dropped character leaves: the marker, once per run."""
        if self._marked:
            return ""
        self._marked = True
        self._owner.capped_runs += 1
        if self._owner._capture is not None:
            self._owner._capture.capped_quotes += 1
        return CAP_MARKER

    def _advance(self, logical: str) -> bool:
        """Move the window by one character; True when that character lies past its run's cap."""
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
        """Past this run's cap, or past what the whole reply may quote."""
        return self._length > self._cap or self._owner.quoted >= self._owner.budget


# ---------------------------------------------------------------------------
# Traces
# ---------------------------------------------------------------------------

_metadata_only: ContextVar[bool] = ContextVar("licensed_ingest", default=False)
_reads_refused: ContextVar[bool] = ContextVar("licensed_reads_refused", default=False)


class UnattestedLicensedText(RuntimeError):
    """A model call inside the ingest of a licensed document the office has not attested for AI processing."""


@contextmanager
def licensed_document_scope(terms: LicenceTerms | None) -> Iterator[None]:
    """The scope work on ONE document runs in (its ingest, a look at its page): what its model calls may do.

    For a licensed document, every model call in the scope:

    - goes to zero-retention endpoints, whatever the organization's setting: the OpenRouter transports pin it
      (``openrouter._pinned_request``) and the chat contract refuses an unpinned call (``llm_factory``);
    - reaches OpenRouter or nothing: a BYOK endpoint is outside our zero-retention terms and is refused;
    - is traced as metadata only (length, sha256): its prompt and reply ARE the licensed text. The generation,
      its model, usage and cost are still recorded.

    One the office has not attested for AI processing may reach no model at all (design 4.7): every call is
    refused, so it is never transcribed, embedded, summarised or looked at.
    """
    licensed = terms is not None and terms.licensed
    traced = _metadata_only.set(licensed or _metadata_only.get())
    refused = _reads_refused.set((licensed and not terms.ai_processing) or _reads_refused.get())
    try:
        yield
    finally:
        _reads_refused.reset(refused)
        _metadata_only.reset(traced)


#: The ingest's name for :func:`licensed_document_scope`.
licensed_ingest = licensed_document_scope


def licensed_scope_active() -> bool:
    """Whether the work in flight is on a licensed document (:func:`licensed_document_scope`)."""
    return _metadata_only.get()


def refuse_unattested_model_read(url: str | None = None, *, openrouter: bool = True) -> None:
    """Raise when a model request may not leave inside a licensed scope. Called by every OpenRouter transport.

    Refused: any request for an unattested licensed document, and one to an endpoint that is not OpenRouter
    (``openrouter`` False: a BYOK base URL) for an attested one.
    """
    if _reads_refused.get():
        raise UnattestedLicensedText(
            "this document is licensed and its licence is not attested for AI processing: no model may read it"
        )
    if _metadata_only.get() and not openrouter:
        raise UnattestedLicensedText(
            f"licensed text goes only to zero-retention endpoints through OpenRouter, not to {url or 'this endpoint'}"
        )


def trace_payload(text: str) -> str:
    """A payload as a direct trace may record it: metadata inside :func:`licensed_ingest`, else capped."""
    if _metadata_only.get():
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        return json.dumps({"licensed": "metadata only", "chars": len(text), "sha256": digest})
    capture = _capture.get()
    cap = capture.quote_cap() if capture is not None else None
    return cap.cap_text(text, json_raw=True) if cap is not None else text


# ---------------------------------------------------------------------------
# Outbound text that is not a model call
# ---------------------------------------------------------------------------

#: What a refused web search answers: the query carried licensed text, which must not reach a search provider.
WEB_SEARCH_REFUSAL = (
    "Web search refused: the query repeats text from the office's licensed copy, and licensed text goes to no "
    "search provider. Search with your own words: the topic, the designation and the clause."
)


def refused_outbound_query(query: str) -> str | None:
    """The refusal for an outbound query (a web search) that shares a shingle with this turn's licensed text."""
    capture = _capture.get()
    cap = capture.quote_cap() if capture is not None else None
    return WEB_SEARCH_REFUSAL if cap is not None and cap.shares_shingle(query) else None
