from __future__ import annotations

import functools
import logging
import re
from collections.abc import Iterable
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING
from typing import Literal

import yaml
from pydantic import BaseModel
from pydantic import ConfigDict

from agent.citations.references import INLINE_CITATION_RE
from agent.citations.references import REFERENCE_SECTION_RE
from agent.common.web_sources import HeldWork
from agent.common.web_sources import assess
from agent.common.web_sources import contains_run
from agent.common.web_sources import held_works
from agent.common.web_sources import is_own_source
from agent.common.web_sources import named_work
from agent.common.web_sources import tokens

if TYPE_CHECKING:
    from agent.citations.entries import SourceEntry

logger = logging.getLogger(__name__)

CLAIM_TERMS_FILE = "claim_terms.yml"

Run = tuple[str, ...]
Reason = Literal["web_only", "gate_may_not_bind"]

_SENTENCE_END_RE = re.compile(r"(?<=[.!?])\s+(?=\S)")
_DAY_BEFORE_RE = re.compile(r"\b\d{1,2}\.$")
_MONTH_YEAR_AFTER_RE = re.compile(r"[^\W\d_]+\s+\d{4}\b")


class _LocaleTerms(BaseModel):
    model_config = ConfigDict(extra="forbid")

    binding: list[str] = []
    requirement: list[str] = []
    edition: list[str] = []
    negation: list[str] = []


class _ClaimTermsFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    locales: dict[str, _LocaleTerms] = {}


@dataclass(frozen=True)
class ClaimTerms:
    binding: tuple[Run, ...] = ()
    requirement: tuple[Run, ...] = ()
    edition: tuple[Run, ...] = ()
    negation: tuple[Run, ...] = ()


@dataclass(frozen=True)
class BindingClaim:
    sentence: str
    reason: Reason


def _runs(words: Iterable[str]) -> tuple[Run, ...]:
    return tuple(dict.fromkeys(run for run in map(tokens, words) if run))


_FIELDS = ("binding", "requirement", "edition", "negation")


def _file_words(path: str) -> dict[str, list[str]]:
    try:
        parsed = _ClaimTermsFile.model_validate(yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {})
    except Exception:  # noqa: BLE001 - a broken word list switches its words off, never the answer
        logger.warning("binding_claims: %s could not be read; its words are not used", path, exc_info=True)
        return {}
    locales = parsed.locales.values()
    return {field: [word for locale in locales for word in getattr(locale, field)] for field in _FIELDS}


@functools.cache
def _terms_from(files: tuple[tuple[str, int], ...]) -> ClaimTerms:
    read = [_file_words(path) for path, _mtime in files]
    return ClaimTerms(**{field: _runs(word for words in read for word in words.get(field, ())) for field in _FIELDS})


def load_claim_terms(norms_dir: str | None = None) -> ClaimTerms:
    from agent.common.norm_registry import registry_yaml_files

    files: list[tuple[str, int]] = []
    for registry in registry_yaml_files(norms_dir):
        path = registry.with_name(CLAIM_TERMS_FILE)
        if path.is_file():
            files.append((str(path), path.stat().st_mtime_ns))
    return _terms_from(tuple(files))


def sentences(content: str) -> list[str]:
    section = REFERENCE_SECTION_RE.search(content)
    body = content[: section.start()] if section else content
    found: list[str] = []
    for line in body.splitlines():
        found.extend(part.strip() for part in _split_line(line) if part.strip())
    return found


def _split_line(line: str) -> list[str]:
    parts: list[str] = []
    start = 0
    for end in _SENTENCE_END_RE.finditer(line):
        if _DAY_BEFORE_RE.search(line, 0, end.start()) and _MONTH_YEAR_AFTER_RE.match(line, end.end()):
            continue
        parts.append(line[start : end.start()])
        start = end.end()
    return [*parts, line[start:]]


def is_web_source(entry: SourceEntry) -> bool:
    return bool(entry.url) and not is_own_source(entry.url)


def _is_building_law(entry: SourceEntry) -> bool:
    from agent.citations.source_identity import source_lane
    from agent.common.source_kinds import kind_for_lane

    return kind_for_lane(source_lane(entry)[0]) == "building_law"


def _has(words: tuple[str, ...], runs: tuple[Run, ...]) -> bool:
    return any(contains_run(words, run) for run in runs)


@dataclass(frozen=True)
class _Reading:
    by_number: dict[int, SourceEntry]
    works: tuple[HeldWork, ...]
    terms: ClaimTerms
    may_bind: bool


def _reason(sentence: str, turn: _Reading) -> Reason | None:
    words = tokens(sentence)
    cited = [turn.by_number[n] for n in map(int, INLINE_CITATION_RE.findall(sentence)) if n in turn.by_number]
    names_law = named_work("", sentence, turn.works) is not None or _has(words, turn.terms.edition)
    if cited and all(is_web_source(entry) for entry in cited):
        copies = any(assess(entry.url or "", entry.title, turn.works).work for entry in cited)
        return "web_only" if names_law or copies else None
    if turn.may_bind:
        return None
    binding = _has(words, turn.terms.binding)
    if binding and _has(words, turn.terms.negation):
        return None  # "which edition binds is not recorded": the honest sentence
    states = binding or _has(words, turn.terms.requirement)
    if states and (names_law or any(_is_building_law(entry) for entry in cited)):
        return "gate_may_not_bind"
    return None


def binding_claims(
    content: str,
    cited: Iterable[tuple[SourceEntry, int | None]],
    *,
    may_bind: bool,
    works: Sequence[HeldWork] | None = None,
    terms: ClaimTerms | None = None,
) -> list[BindingClaim]:
    turn = _Reading(
        by_number={number: entry for entry, number in cited if number is not None},
        works=tuple(held_works() if works is None else works),
        terms=load_claim_terms() if terms is None else terms,
        may_bind=may_bind,
    )
    found: list[BindingClaim] = []
    for sentence in sentences(content):
        reason = _reason(sentence, turn)
        if reason is not None:
            found.append(BindingClaim(sentence=sentence, reason=reason))
    return found


def turn_binding_claims(content: str | None, cited: Iterable[tuple[SourceEntry, int | None]]) -> list[BindingClaim]:
    if not content:
        return []
    from agent.common.knowledge_context import turn_knowledge_context

    try:
        return binding_claims(content, cited, may_bind=not turn_knowledge_context().withholds_law)
    except Exception:  # noqa: BLE001 - a check that cannot run leaves the answer as it is, and says so in the log
        logger.warning("binding_claims: the check could not run for this answer", exc_info=True)
        return []


def law_cited_from_web(
    content: str | None,
    cited: Iterable[tuple[SourceEntry, int | None]],
    *,
    works: Sequence[HeldWork] | None = None,
) -> list[str]:
    from agent.common.web_sources import copied_work

    pairs = list(cited)
    copies = (copied_work(entry.url, entry.title) for entry, _ in pairs if entry.url and is_web_source(entry))
    web = {number for entry, number in pairs if number is not None and is_web_source(entry)}
    held = tuple(held_works() if works is None else works)
    named = (
        named_work("", sentence, held)
        for sentence in sentences(content or "")
        if web & set(map(int, INLINE_CITATION_RE.findall(sentence)))
    )
    designations = [*copies, *(work.designation for work in named if work is not None)]
    return list(dict.fromkeys(work for work in designations if work))


def score_answer(claims: Sequence[BindingClaim], web_law: Sequence[str]) -> None:
    from agent.observability.langfuse_scores import RuntimeScore
    from agent.observability.langfuse_scores import emit_scores

    reasons = [claim.reason for claim in claims]
    counted = ", ".join(f"{reasons.count(reason)} {reason}" for reason in dict.fromkeys(reasons))
    emit_scores(
        [
            RuntimeScore("binding-claim-without-records", 1.0 if claims else 0.0, comment=counted or None),
            RuntimeScore(
                "law-cited-from-web", 1.0 if web_law else 0.0, comment=f"{len(web_law)} work(s)" if web_law else None
            ),
        ],
        writer="binding-claims",
    )
