from __future__ import annotations

import logging
import os
import re
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

VOCABULARY_PATH = Path(os.environ.get("VOCABULARY_PATH", "configs/norms/at/vocabulary.yml"))

_ENGLISH_MARKERS = frozenset(
    {"the", "what", "which", "how", "are", "is", "for", "of", "in", "must", "required", "do", "does", "can", "and"}
)

_GERMAN_MARKERS = frozenset(
    {"welche", "welcher", "wie", "was", "muss", "müssen", "gilt", "gelten", "für", "der", "die", "das", "und", "bei"}
)

_GERMAN_CHARS = frozenset("äöüßÄÖÜ")

_WORD_RE = re.compile(r"[^\W\d_]+", re.UNICODE)

# Measured: "fire-brigade access road" expanded to nothing against a spaced glossary form and ranked its answer 119th.
_PUNCTUATION_RE = re.compile(r"[^\w]+", re.UNICODE)

_lock = threading.Lock()
_concepts: list[tuple[tuple[str, ...], tuple[str, ...]]] | None = None


def _matchable(text: str) -> str:
    return _PUNCTUATION_RE.sub(" ", text).strip().lower()


def _load_concepts() -> list[tuple[str, re.Pattern[str], tuple[str, ...]]]:
    global _concepts
    with _lock:
        if _concepts is not None:
            return _concepts
        forms: list[tuple[str, re.Pattern[str], tuple[str, ...]]] = []
        try:
            import yaml

            data = yaml.safe_load(VOCABULARY_PATH.read_text(encoding="utf-8")) or {}
            for concept in data.get("concepts") or []:
                english = [_matchable(str(form)) for form in concept.get("en") or [] if str(form).strip()]
                german = tuple(str(term).strip() for term in concept.get("de") or [] if str(term).strip())
                if not german:
                    continue
                for form in english:
                    if form:
                        forms.append((form, re.compile(rf"(?<!\w){re.escape(form)}(?:e?s)?(?!\w)"), german))
        except Exception as e:
            logger.warning("Query-expansion vocabulary unavailable (%s: %s); expansion disabled", type(e).__name__, e)
            forms = []
        forms.sort(key=lambda entry: -len(entry[0]))
        _concepts = forms
        return _concepts


def reset_vocabulary_cache() -> None:
    global _concepts
    with _lock:
        _concepts = None


def detect_language(query: str | None) -> str:
    if not query or not query.strip():
        return "unknown"
    if any(character in _GERMAN_CHARS for character in query):
        return "de"
    words = {word.lower() for word in _WORD_RE.findall(query)}
    german = len(words & _GERMAN_MARKERS)
    english = len(words & _ENGLISH_MARKERS)
    if german > english:
        return "de"
    if english > german:
        return "en"
    return "unknown"


def expansion_terms(query: str | None) -> list[str]:
    if not query:
        return []
    haystack = _matchable(query)
    terms: list[str] = []
    consumed: list[str] = []
    for form, matcher, german_terms in _load_concepts():
        if not matcher.search(haystack):
            continue
        if any(form in previous for previous in consumed):
            continue
        consumed.append(form)
        for term in german_terms:
            if term not in terms:
                terms.append(term)
    return terms


def augmented_query(query: str | None, *, log_miss: bool = True) -> str:
    if not query or not query.strip():
        return query or ""
    if detect_language(query) == "de":
        return query
    terms = expansion_terms(query)
    if not terms:
        if log_miss and detect_language(query) == "en":
            logger.info("Query expansion found no glossary concept for English query: %r", query[:120])
        return query
    return f"{' '.join(terms)} {query}"
