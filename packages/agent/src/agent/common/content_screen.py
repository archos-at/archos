from __future__ import annotations

import logging
import re
from collections.abc import Iterable
from collections.abc import Mapping
from dataclasses import dataclass
from dataclasses import field
from typing import Literal

from agent.common.screen_numbers import _DETECTOR_SPANS
from agent.common.screen_reading import _read
from agent.common.screen_reading import _split_words
from agent.common.screen_reading import _term_words
from agent.common.screen_reading import fold
from agent.common.screen_spans import Span
from agent.common.screen_spans import _in_original
from agent.common.screen_spans import _outside_ibans
from agent.common.screen_spans import _overlaps_any
from agent.common.screen_terms import _term_spans

logger = logging.getLogger(__name__)

Detector = Literal["iban", "at_svnr", "credit_card", "de_svnr", "de_tax_id"]
DETECTORS: tuple[str, ...] = ("iban", "at_svnr", "credit_card", "de_svnr", "de_tax_id")

MAX_TERMS = 200
MIN_TERM_CHARS = 2
MAX_TERM_CHARS = 80

PLACEHOLDERS: dict[str, str] = {
    "iban": "[IBAN entfernt]",
    "at_svnr": "[SV-Nummer entfernt]",
    "credit_card": "[Kartennummer entfernt]",
    "de_svnr": "[RV-Nummer entfernt]",
    "de_tax_id": "[Steuer-ID entfernt]",
    "term": "[Begriff entfernt]",
}

_PLACEHOLDER_RE = re.compile("|".join(re.escape(placeholder) for placeholder in PLACEHOLDERS.values()))


@dataclass(frozen=True)
class ScreeningRules:
    terms: tuple[str, ...] = ()
    detectors: tuple[str, ...] = ()
    patterns: tuple[tuple[str, ...], ...] = field(default=(), repr=False, compare=False)

    @classmethod
    def build(cls, terms: Iterable[str], detectors: Iterable[str]) -> ScreeningRules | None:
        kept_terms = _normalised_terms(terms)
        wanted = set(detectors)
        kept_detectors = tuple(name for name in DETECTORS if name in wanted)
        if not kept_terms and not kept_detectors:
            return None
        patterns = tuple(_term_words(term) for term in kept_terms)
        return cls(terms=kept_terms, detectors=kept_detectors, patterns=patterns)

    @classmethod
    def from_config(cls, raw: object) -> ScreeningRules | None:
        if raw is None:
            return None
        if not isinstance(raw, Mapping):
            logger.warning("Ignoring screening config of type %s", type(raw).__name__)
            return None
        if not is_screening_config(raw):
            logger.warning("Ignoring screening config: content_terms and detectors must be lists of strings")
            return None
        terms = raw.get("content_terms") or []
        detectors = raw.get("detectors") or []
        unknown = sorted(set(detectors) - set(DETECTORS))
        if unknown:
            logger.warning("Ignoring unknown screening detector(s): %s", unknown)
        return cls.build(terms, detectors)


DETECTORS_ONLY: ScreeningRules = ScreeningRules(detectors=DETECTORS)


def screening_config_unusable(raw: object) -> bool:
    if raw is None or (isinstance(raw, Mapping) and not raw.get("content_terms") and not raw.get("detectors")):
        return False
    return not is_screening_config(raw) or ScreeningRules.from_config(raw) is None


def is_screening_config(raw: object) -> bool:
    if not isinstance(raw, Mapping):
        return False
    terms = raw.get("content_terms") or []
    detectors = raw.get("detectors") or []
    return _is_str_list(terms) and _is_str_list(detectors)


def _is_str_list(value: object) -> bool:
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def _normalised_terms(terms: Iterable[str]) -> tuple[str, ...]:
    kept: dict[str, str] = {}
    for term in terms:
        stripped = " ".join(_split_words(term))
        if MIN_TERM_CHARS <= len(stripped) <= MAX_TERM_CHARS:
            kept.setdefault(fold(stripped), stripped)
    return tuple(kept.values())[:MAX_TERMS]


def find_spans(text: str, rules: ScreeningRules) -> list[Span]:
    if not text:
        return []
    protected = [(match.start(), match.end()) for match in _PLACEHOLDER_RE.finditer(text)]
    reading = _read(text)
    spans = list(_term_spans(reading.text, rules))
    for name in rules.detectors:
        spans.extend(_DETECTOR_SPANS[name](reading.text, reading.soft))
    original = [_in_original(span, reading) for span in _outside_ibans(spans)]
    return [span for span in original if not _overlaps_any(span, protected)]


@dataclass(frozen=True)
class Finding:
    kind: str
    count: int
    term: str | None = None
    sample: str | None = None

    def as_json(self) -> dict[str, object]:
        out: dict[str, object] = {"kind": self.kind}
        if self.term is not None:
            out["term"] = self.term
        out["count"] = self.count
        if self.sample is not None:
            out["sample"] = self.sample
        return out


@dataclass(frozen=True)
class MaskedText:
    text: str
    findings: tuple[Finding, ...] = ()

    @property
    def masked(self) -> bool:
        return bool(self.findings)


def _merged(spans: list[Span]) -> list[Span]:
    out: list[Span] = []
    for span in sorted(spans, key=lambda s: (s.start, -s.end)):
        if out and span.start < out[-1].end:
            last = out[-1]
            out[-1] = Span(last.kind, last.start, max(last.end, span.end), last.term, last.sample)
        else:
            out.append(span)
    return out


def _replaced(text: str, spans: list[Span]) -> str:
    parts: list[str] = []
    cursor = 0
    for span in _merged(spans):
        parts.append(text[cursor : span.start])
        parts.append(PLACEHOLDERS[span.kind])
        cursor = span.end
    parts.append(text[cursor:])
    return "".join(parts)


def _findings(spans: list[Span], rules: ScreeningRules) -> tuple[Finding, ...]:
    by_rule: dict[tuple[str, str | None], list[Span]] = {}
    for span in spans:
        by_rule.setdefault((span.kind, span.term), []).append(span)
    order = [("term", term) for term in rules.terms] + [(name, None) for name in rules.detectors]
    findings: list[Finding] = []
    for kind, term in order:
        matched = by_rule.get((kind, term))
        if matched:
            findings.append(Finding(kind=kind, count=len(matched), term=term, sample=matched[0].sample))
    return tuple(findings)


def mask_text(text: str, rules: ScreeningRules | None) -> MaskedText:
    if rules is None or not text:
        return MaskedText(text)
    found: list[Span] = []
    current = text
    spans = find_spans(current, rules)
    while spans:
        found.extend(spans)
        current = _replaced(current, spans)
        spans = find_spans(current, rules)
    return MaskedText(current, _findings(found, rules))


def findings_summary(findings: Iterable[Finding]) -> str:
    return ", ".join(f"{finding.kind}={finding.count}" for finding in findings)
