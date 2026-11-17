"""Control-marker detection for Piloti's answer contract.

Piloti's prompt makes the model end research answers with two
control markers:

- ``[ESCALATE_TO_DEEP]`` — the model judged its own answer insufficient and
  asks to escalate to deep research.
- ``[CONFIDENCE:low|medium|high]`` (optionally ``[CONFIDENCE:low | Grund…]``)
  — the model's self-assessment of how well the answer is grounded in its
  sources, with an optional one-clause justification the UI surfaces so the
  reader can see WHY the level was chosen.

These helpers live in the Piloti package (the layer that OWNS the
marker contract) so both Piloti (which now extracts + strips them
before emitting/returning content) and the chat orchestrator (which consumes the
resulting structured signals, with string-detection as a back-compat fallback)
can share one implementation without a circular import.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any
from typing import Literal

ESCALATION_MARKER = "[ESCALATE_TO_DEEP]"
_ESCALATION_MARKER_RE = re.compile(re.escape(ESCALATION_MARKER))

CONFIDENCE_MARKER_RE = re.compile(r"\[CONFIDENCE:\s*([^\]]*)\]", re.IGNORECASE)
_VALID_CONFIDENCE_VALUES = frozenset({"low", "medium", "high"})

_CONFIDENCE_REASON_MAX_CHARS = 300

ConfidenceLevel = Literal["low", "medium", "high"]

_TAIL_REGION_LINES = 3


def _tail_region_start(content: str, lines: int = _TAIL_REGION_LINES) -> int:
    """Return the char offset where the tail region begins.

    The tail region is the contiguous span from the start of the earliest of the
    last ``lines`` non-empty lines through the end of ``content`` (any trailing
    or interspersed blank lines are included). A marker at or after this offset
    is a trailing signal; one before it is body text.
    """
    non_empty_seen = 0
    start = len(content)
    idx = len(content)
    for line in reversed(content.splitlines(keepends=True)):
        idx -= len(line)
        if not line.strip():
            continue
        non_empty_seen += 1
        start = idx
        if non_empty_seen == lines:
            break
    return start


def _strip_matches(content: str, matches: list[re.Match[str]]) -> str:
    """Remove the given (non-overlapping, ascending) match spans from content."""
    pieces: list[str] = []
    cursor = 0
    for match in matches:
        pieces.append(content[cursor : match.start()])
        cursor = match.end()
    pieces.append(content[cursor:])
    return "".join(pieces)


def detect_and_strip_escalation_marker(content: Any) -> tuple[Any, bool]:
    """Detect and remove Piloti's insufficiency marker from a message.

    If ``content`` is not a string it is returned unchanged with ``False``.
    Only occurrences of :data:`ESCALATION_MARKER` inside the TAIL REGION (the
    last :data:`_TAIL_REGION_LINES` non-empty lines) count as a signal and are
    stripped; a marker quoted earlier in the body is left intact and produces no
    signal. When a tail occurrence is removed the resulting trailing whitespace
    (including any dangling blank line the marker left behind) is collapsed, and
    ``(stripped, was_present)`` is returned.
    """
    if not isinstance(content, str):
        return content, False

    tail_start = _tail_region_start(content)
    matches = [m for m in _ESCALATION_MARKER_RE.finditer(content) if m.start() >= tail_start]
    if not matches:
        return content, False

    stripped = _strip_matches(content, matches).rstrip()
    return stripped, True


def _parse_confidence_payload(payload: str) -> tuple[ConfidenceLevel | None, str | None]:
    """Split a marker payload into its level and optional reason.

    The payload is everything between ``[CONFIDENCE:`` and ``]``: a level token,
    optionally followed by ``|`` and a one-clause justification
    (``"high | Direkt durch OIB-RL 2 belegt"``). The level is the text before
    the FIRST ``|`` (stripped, lowercased, enum-validated); the reason is the
    remainder, trimmed and capped at :data:`_CONFIDENCE_REASON_MAX_CHARS`. A
    payload without ``|`` yields no reason; a payload whose level token is not
    one of the three valid values yields ``(None, None)`` — an unknown level
    never invents a signal, and a reason without a valid level is meaningless.
    """
    level_token, _, raw_reason = payload.partition("|")
    candidate = level_token.strip().lower()
    if candidate not in _VALID_CONFIDENCE_VALUES:
        return None, None
    reason = raw_reason.strip()[:_CONFIDENCE_REASON_MAX_CHARS] or None
    return candidate, reason  # type: ignore[return-value]


def detect_and_strip_confidence_marker(content: Any) -> tuple[Any, ConfidenceLevel | None, str | None]:
    """Detect and remove the model's self-assessed confidence marker.

    Mirrors :func:`detect_and_strip_escalation_marker`: fail-open and
    tail-anchored. If ``content`` is not a string it is returned unchanged with
    ``(content, None, None)``. Only ``[CONFIDENCE:...]`` markers inside the TAIL
    REGION (the last :data:`_TAIL_REGION_LINES` non-empty lines, matched
    case-insensitively) are treated as signals and stripped so the user never
    sees them; a marker quoted earlier in the body is left intact and yields no
    signal. The parsed signal is returned as ``(stripped, level, reason)``:

    - ``level`` is the well-formed value ("low"/"medium"/"high") — the last
      valid one within the tail when several appear (the answer's final marker
      wins); ``reason`` is that marker's optional ``| …`` justification.
    - No tail marker, or a tail marker whose level is not one of the three,
      yields ``(stripped, None, None)`` (no signal). Malformed tail markers are
      still stripped.

    Order-insensitive with respect to the escalation marker: each marker is
    detected and removed independently, so both may co-occur in any order.
    """
    if not isinstance(content, str):
        return content, None, None

    tail_start = _tail_region_start(content)
    matches = [m for m in CONFIDENCE_MARKER_RE.finditer(content) if m.start() >= tail_start]
    if not matches:
        return content, None, None

    level: ConfidenceLevel | None = None
    reason: str | None = None
    for match in matches:
        candidate, candidate_reason = _parse_confidence_payload(match.group(1))
        if candidate is not None:
            level = candidate
            reason = candidate_reason

    stripped = _strip_matches(content, matches).rstrip()
    return stripped, level, reason



CONFIDENCE_RULE_VERSION = 2


CappedReason = Literal[
    "ungrounded",
    "quote_unverified",
    "law_unsettled",
    "open_point",
    "normative_claim_uncited",
    "measurement_only",
    "citation_fallback",
]

MEASUREMENT_CONFIDENCE_CEILING: ConfidenceLevel = "medium"

_CONFIDENCE_ORDER: tuple[ConfidenceLevel, ...] = ("low", "medium", "high")


def _at_most(level: ConfidenceLevel, ceiling: ConfidenceLevel) -> ConfidenceLevel:
    """``level`` clamped down to ``ceiling`` — never raises it."""
    return level if _CONFIDENCE_ORDER.index(level) <= _CONFIDENCE_ORDER.index(ceiling) else ceiling


def surface_answer_confidence(
    self_reported: ConfidenceLevel | None,
    citation_grounded: bool,
    quotes_verified: bool = True,
) -> ConfidenceLevel | None:
    """Rule 1: the answer-level floors, for a report the answer check does not grade (deep research).

    Returns ``None`` when there is no self-assessment to surface. Citation
    grounding is the only route off "low": an answer grounded in a verified
    citation with every quoted span verified surfaces the model's own level,
    one with an unverified quote at most "medium".
    """
    if self_reported is None:
        return None
    if not citation_grounded:
        return "low"
    return self_reported if quotes_verified else _at_most(self_reported, MEASUREMENT_CONFIDENCE_CEILING)


def answer_confidence_capped_reason(
    self_reported: ConfidenceLevel | None,
    citation_grounded: bool,
    quotes_verified: bool = True,
) -> CappedReason | None:
    """Why rule 1 capped the surfaced confidence, or ``None`` when no cap applied."""
    if self_reported is None or surface_answer_confidence(self_reported, citation_grounded, quotes_verified) in (
        self_reported,
        None,
    ):
        return None
    return "quote_unverified" if citation_grounded else "ungrounded"


def _quote_cap(quotes_verified: bool, citation_grounded: bool) -> ConfidenceLevel:
    """The hard quote gate: a quote no passage holds caps to medium under a citation, else low."""
    if quotes_verified:
        return "high"
    return MEASUREMENT_CONFIDENCE_CEILING if citation_grounded else "low"


def answer_ceiling(open_points: Sequence[str], self_reported: ConfidenceLevel | None) -> ConfidenceLevel:
    """The most the answer's own words allow: ``medium`` for an open point it names, never above its self-report.

    The check grades whether the evidence backs each statement, and „die Bindung ist nicht geprüft" is backed by a
    record that says so; what the answer itself says is open, or the level it gave itself (the prompt's ``medium``
    is „an inference or a named gap", its ``low`` missing or conflicting evidence), is the answer saying it is not
    settled. A check may lower that level, never raise it.
    """
    named = MEASUREMENT_CONFIDENCE_CEILING if open_points else "high"
    return _at_most(named, self_reported) if self_reported is not None else named


def surface_checked_confidence(
    checked: ConfidenceLevel | None,
    *,
    quotes_verified: bool = True,
    citation_grounded: bool = False,
    law_unsettled: bool = False,
    ceiling: ConfidenceLevel = "high",
) -> ConfidenceLevel | None:
    """The answer check's level under the quote gate, the law gate and the answer's own ceiling; ``None`` without one.

    The law gate is structural, like the quote gate: an answer that rests on building law the records do
    not settle (``law_unsettled``) is at most ``medium``, whatever the grader read (staging QC, F6). The
    answer's own ``ceiling`` (:func:`answer_ceiling`) holds the level to what the answer itself claims.
    """
    if checked is None:
        return None
    quoted = _at_most(checked, _quote_cap(quotes_verified, citation_grounded))
    gated = _at_most(quoted, MEASUREMENT_CONFIDENCE_CEILING) if law_unsettled else quoted
    return _at_most(gated, ceiling)


def checked_confidence_capped_reason(
    checked: ConfidenceLevel | None,
    *,
    quotes_verified: bool = True,
    citation_grounded: bool = False,
    law_unsettled: bool = False,
    ceiling: ConfidenceLevel = "high",
) -> CappedReason | None:
    """The gate that lowered the check's level: the quote gate, then the law gate, then the answer's own ceiling."""
    quoted = surface_checked_confidence(checked, quotes_verified=quotes_verified, citation_grounded=citation_grounded)
    if quoted != checked:
        return "quote_unverified"
    gated = surface_checked_confidence(
        checked, quotes_verified=quotes_verified, citation_grounded=citation_grounded, law_unsettled=law_unsettled
    )
    if gated != quoted:
        return "law_unsettled"
    surfaced = surface_checked_confidence(
        checked,
        quotes_verified=quotes_verified,
        citation_grounded=citation_grounded,
        law_unsettled=law_unsettled,
        ceiling=ceiling,
    )
    return "open_point" if surfaced != gated else None
