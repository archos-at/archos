"""Sentences that state law the turn's records do not carry: found by rule, capped and recorded (ADR-0175).

"No binding claim before the records are published" and "the web is information" were held by the prompt
alone (``knowledge_context.gate_note``, ``WEB_IS_INFORMATION``), and dev answers of 2026-11-10 broke both: a
binding edition named from a web page, a requirement stated as the site's before publication, a paragraph
of state law cited from two mirror sites. This is the deterministic half of the check; the answer check's
judge (``claim_judge``) stays the second.

A sentence of the final answer is a claim without records when either holds:

- **web only**: every source it cites came from the web (an address off every configured source's hosts),
  and it names law: a work the turn holds, a word for an edition, or a cited page that is itself a copy of
  a held work (``web_sources.copied_work``). Law is cited from its own source, so this holds under any gate.
- **the gate may not bind** (``KnowledgeContext.withholds_law``): it says something binds or is required
  and names law (a held work, a word for an edition, or a building-law citation). A sentence that says the
  binding edition is *not* known is the honest answer and is left alone.

Nothing here is a country's: the works come from the turn's records (``web_sources.held_works``), the gate
from the knowledge context, and the words from locale data beside the norm registry
(``configs/norms/<country>/claim_terms.yml``), one block per language. Without that data only the parts
that need no words run (a web-only sentence that names a held work or cites a copy).

The cap is the law gate's own: ``answer_law_unsettled`` (``markers``, at most medium), so the reader sees
one reason, not two. The record is two Langfuse scores, ``binding-claim-without-records`` and
``law-cited-from-web``.
"""

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

#: The file beside a country's ``registry.yml`` that holds the words.
CLAIM_TERMS_FILE = "claim_terms.yml"

Run = tuple[str, ...]
Reason = Literal["web_only", "gate_may_not_bind"]

_SENTENCE_END_RE = re.compile(r"(?<=[.!?])\s+(?=\S)")


class _LocaleTerms(BaseModel):
    """One language's words (``claim_terms.yml``): each a word or a short phrase, matched as whole tokens."""

    model_config = ConfigDict(extra="forbid")

    #: Says a text applies: "verbindlich", "in Kraft", "binding".
    binding: list[str] = []
    #: States a requirement: "muss", "mindestens", "must".
    requirement: list[str] = []
    #: Names an edition of a text: "Ausgabe", "Fassung", "edition".
    edition: list[str] = []
    #: Turns a statement into its denial or into an open question: "nicht", "unklar", "not".
    negation: list[str] = []


class _ClaimTermsFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    locales: dict[str, _LocaleTerms] = {}


@dataclass(frozen=True)
class ClaimTerms:
    """The words of every loaded language, as token runs."""

    binding: tuple[Run, ...] = ()
    requirement: tuple[Run, ...] = ()
    edition: tuple[Run, ...] = ()
    negation: tuple[Run, ...] = ()


@dataclass(frozen=True)
class BindingClaim:
    """One sentence that states law without the records, and which rule found it."""

    sentence: str
    reason: Reason


def _runs(words: Iterable[str]) -> tuple[Run, ...]:
    return tuple(dict.fromkeys(run for run in map(tokens, words) if run))


_FIELDS = ("binding", "requirement", "edition", "negation")


def _file_words(path: str) -> dict[str, list[str]]:
    """One file's words per field, every language together; none when the file cannot be read (logged)."""
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
    """The claim words of every country directory under the norms seed; empty when there are none."""
    from agent.common.norm_registry import registry_yaml_files

    files: list[tuple[str, int]] = []
    for registry in registry_yaml_files(norms_dir):
        path = registry.with_name(CLAIM_TERMS_FILE)
        if path.is_file():
            files.append((str(path), path.stat().st_mtime_ns))
    return _terms_from(tuple(files))


def sentences(content: str) -> list[str]:
    """The answer's body as sentences: its lines (a table row, a list item), each split at sentence ends."""
    section = REFERENCE_SECTION_RE.search(content)
    body = content[: section.start()] if section else content
    found: list[str] = []
    for line in body.splitlines():
        found.extend(part.strip() for part in _SENTENCE_END_RE.split(line) if part.strip())
    return found


def is_web_source(entry: SourceEntry) -> bool:
    """Whether a cited source came from the web: it has an address, off every host a work's own text is read from."""
    return bool(entry.url) and not is_own_source(entry.url)


def _is_building_law(entry: SourceEntry) -> bool:
    from agent.citations.source_identity import source_lane
    from agent.common.source_kinds import kind_for_lane

    return kind_for_lane(source_lane(entry)[0]) == "building_law"


def _has(words: tuple[str, ...], runs: tuple[Run, ...]) -> bool:
    return any(contains_run(words, run) for run in runs)


@dataclass(frozen=True)
class _Reading:
    """What the rules need to know about the turn, read once per answer."""

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
    """The sentences of ``content`` that state law without the records (module docstring).

    ``cited`` pairs each cited source with the ``[N]`` the text shows. ``works`` and ``terms`` default to the
    turn's records and the loaded words.
    """
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
    """:func:`binding_claims` for the turn's own gate; nothing for an empty answer. Never raises."""
    if not content:
        return []
    from agent.common.knowledge_context import turn_knowledge_context

    try:
        return binding_claims(content, cited, may_bind=not turn_knowledge_context().withholds_law)
    except Exception:  # noqa: BLE001 - a check that cannot run leaves the answer as it is, and says so in the log
        logger.warning("binding_claims: the check could not run for this answer", exc_info=True)
        return []


def law_cited_from_web(cited: Iterable[SourceEntry]) -> list[str]:
    """The works the answer cites from a web page that is a copy of them or only names them, each once."""
    from agent.common.web_sources import copied_work

    works = (copied_work(entry.url, entry.title) for entry in cited if entry.url and is_web_source(entry))
    return list(dict.fromkeys(work for work in works if work))


def score_answer(claims: Sequence[BindingClaim], web_law: Sequence[str]) -> None:
    """Write ``binding-claim-without-records`` and ``law-cited-from-web`` for an answered turn."""
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
