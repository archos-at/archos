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
    pieces: list[str] = []
    cursor = 0
    for match in matches:
        pieces.append(content[cursor : match.start()])
        cursor = match.end()
    pieces.append(content[cursor:])
    return "".join(pieces)


def detect_and_strip_escalation_marker(content: Any) -> tuple[Any, bool]:
    if not isinstance(content, str):
        return content, False

    tail_start = _tail_region_start(content)
    matches = [m for m in _ESCALATION_MARKER_RE.finditer(content) if m.start() >= tail_start]
    if not matches:
        return content, False

    stripped = _strip_matches(content, matches).rstrip()
    return stripped, True


def _parse_confidence_payload(payload: str) -> tuple[ConfidenceLevel | None, str | None]:
    level_token, _, raw_reason = payload.partition("|")
    candidate = level_token.strip().lower()
    if candidate not in _VALID_CONFIDENCE_VALUES:
        return None, None
    reason = raw_reason.strip()[:_CONFIDENCE_REASON_MAX_CHARS] or None
    return candidate, reason  # type: ignore[return-value]


def detect_and_strip_confidence_marker(content: Any) -> tuple[Any, ConfidenceLevel | None, str | None]:
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
    return level if _CONFIDENCE_ORDER.index(level) <= _CONFIDENCE_ORDER.index(ceiling) else ceiling


def surface_answer_confidence(
    self_reported: ConfidenceLevel | None,
    citation_grounded: bool,
    quotes_verified: bool = True,
) -> ConfidenceLevel | None:
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
    if self_reported is None or surface_answer_confidence(self_reported, citation_grounded, quotes_verified) in (
        self_reported,
        None,
    ):
        return None
    return "quote_unverified" if citation_grounded else "ungrounded"


def _quote_cap(quotes_verified: bool, citation_grounded: bool) -> ConfidenceLevel:
    if quotes_verified:
        return "high"
    return MEASUREMENT_CONFIDENCE_CEILING if citation_grounded else "low"


def answer_ceiling(open_points: Sequence[str], self_reported: ConfidenceLevel | None) -> ConfidenceLevel:
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
