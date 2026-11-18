from __future__ import annotations

import re
from dataclasses import dataclass

from public_sources.lookup import Locus
from public_sources.lookup import LocusUnit

_NUMBER = r"\d+[a-z]?"
DASHES = ("–", "-")


def _form(form: str, *, dot: bool) -> str:
    stem = form[:-1] if form.endswith(".") else form
    if form.endswith("."):
        tail = r"\.?" if len(stem) > 1 else r"\."
    else:
        tail = r"\.?" if dot else ""
    lead = r"\b" if re.match(r"\w", stem) else ""
    return lead + re.escape(stem) + tail


def _word(form: str) -> str:
    pattern = _form(form, dot=False)
    return pattern + r"\b" if re.search(r"\w$", form) else pattern


def _longest_first(forms) -> list[str]:
    return sorted(forms, key=len, reverse=True)


def _part(forms: tuple[str, ...]) -> str:
    longest = max(len(form) for form in forms)
    alternatives = [_form(f, dot=len(forms) == 1 or len(f) < longest) for f in _longest_first(forms)]
    return "(?:" + "|".join(alternatives) + ")"


def unit_pattern(unit: LocusUnit, *, repeat: bool = True) -> str:
    body = "(?:" + "|".join(_form(f, dot=unit.dot) for f in _longest_first(unit.forms)) + ")"
    return body + "+" if repeat and unit.repeatable else body


def _flags(unit: LocusUnit) -> int:
    return re.IGNORECASE if unit.word else 0


@dataclass(frozen=True)
class Grammar:
    units: tuple[LocusUnit, ...]
    first: dict[str, re.Pattern[str]]
    signed: dict[str, re.Pattern[str]]
    subsection: re.Pattern[str]
    join: re.Pattern[str]
    range_joins: frozenset[str]
    qualifier: re.Pattern[str]
    subsection_list: re.Pattern[str]
    trailing_reference: re.Pattern[str]
    section_line: re.Pattern[str]
    subsection_inline: re.Pattern[str]
    subsection_label: str
    range_word: str

    def unit_index(self, match: re.Match[str]) -> int:
        return next(i for i in range(len(self.units)) if match.group(f"u{i}"))


def compile_grammar(locus: Locus) -> Grammar:
    units = locus.units
    joins = [*_longest_first(locus.conjunctions), *_longest_first(locus.range_words)]
    join_words = "|".join([",", *(_word(w) for w in joins), *(re.escape(d) for d in DASHES)])
    qualifier_join = rf"\s*(?:{join_words})\s*"
    return Grammar(
        units=units,
        first={
            u.sign: re.compile(unit_pattern(u) + rf"\s*({_NUMBER})" + (r"\b" if u.word else ""), _flags(u))
            for u in units
        },
        signed={u.sign: re.compile(r"\s*" + unit_pattern(u) + r"\s*(\d+)([a-z]?)\b", re.IGNORECASE) for u in units},
        subsection=re.compile(_part(locus.subsection) + rf"\s*({_NUMBER})\b", re.IGNORECASE),
        join=re.compile(rf"\s*({join_words})", re.IGNORECASE),
        range_joins=frozenset({w.lower() for w in locus.range_words} | set(DASHES)),
        qualifier=re.compile(_qualifier(locus, qualifier_join), re.IGNORECASE),
        subsection_list=re.compile(
            _part(locus.subsection) + rf"\s*{_NUMBER}(?:{qualifier_join}{_NUMBER})*", re.IGNORECASE
        ),
        trailing_reference=_trailing_reference(locus),
        section_line=re.compile(
            r"^\s*(?:" + "|".join(rf"(?P<u{i}>{unit_pattern(u)})\s*" for i, u in enumerate(units)) + ")"
            rf"(?P<number>{_NUMBER})\s*(?:\.|$)",
            re.IGNORECASE,
        ),
        subsection_inline=re.compile(
            r"^\s*(?:" + "|".join(unit_pattern(u, repeat=False) for u in units) + ")"
            rf"\s*{_NUMBER}\s*\.?\s*\(\s*({_NUMBER})\s*\)"
        ),
        subsection_label=locus.subsection[0],
        range_word=locus.range_words[0] if locus.range_words else DASHES[0],
    )


def _qualifier(locus: Locus, join: str) -> str:
    numbered = "(?:" + "|".join(_part(p) for p in (locus.subsection, locus.item) if p) + ")"
    branches = [rf"{numbered}\s*{_NUMBER}\b(?:{join}(?:{numbered}\s*)?{_NUMBER}\b(?!\.\s*\w))*"]
    if locus.letter:
        letter = _part(locus.letter)
        branches.append(rf"{letter}\s*(?-i:[a-z])\b(?:{join}(?:{letter}\s*)?(?-i:[a-z])\b(?!\.\s*\w))*")
    if locus.sentence:
        branches.append(rf",?\s*\d+\.\s*{re.escape(locus.sentence)}\b")
    return r"\s*(?:" + "|".join(branches) + ")"


def _trailing_reference(locus: Locus) -> re.Pattern[str]:
    if not locus.see_also:
        return re.compile(r"(?!)")
    words = "(?:" + "|".join(_form(w, dot=False) for w in _longest_first(locus.see_also)) + ")"
    return re.compile(rf"(?:[\s,;]+{words}|\s*\(\s*{words}(?:\s*\))?)+$", re.IGNORECASE)
