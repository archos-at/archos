"""The citation grammar of one source, compiled from its record's ``lookup.locus``.

A legal text is cited by signs (``§``, ``Art``), the words for a provision's
parts (``Abs``, ``Z``, ``lit.``, ``Satz``) and the words joining a list
(``und``, ``bis``). Those are the source's, never this module's: it turns the
record's words into the regexes the reference reader (``address.py``) and the
text splitter (``sections.py``) run, and holds no word of any language.

Three spelling rules, so a record lists words and not regexes:

* a form ending in a full stop is an abbreviation; one longer than a letter
  may be written without its stop (``vgl`` for ``vgl.``), a one-letter one may
  not (``s.``, ``u.``);
* of a part's several forms the longest is the full word and takes no stop,
  the shorter ones may (``Abs.``, ``Z.``); a part with one form may too
  (``lit.``);
* a unit takes a stop after any form only when the record says ``dot``.

A dash is always a range, whatever the record's range words.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from public_sources.lookup import Locus
from public_sources.lookup import LocusUnit

#: A provision's number: digits and an optional letter (``63a``).
_NUMBER = r"\d+[a-z]?"
#: The dashes that make a range in every language.
DASHES = ("–", "-")


def _form(form: str, *, dot: bool) -> str:
    """One spelling as a regex; see the module docstring for the stop."""
    stem = form[:-1] if form.endswith(".") else form
    if form.endswith("."):
        tail = r"\.?" if len(stem) > 1 else r"\."
    else:
        tail = r"\.?" if dot else ""
    lead = r"\b" if re.match(r"\w", stem) else ""
    return lead + re.escape(stem) + tail


def _word(form: str) -> str:
    """A joining word, bounded on both sides where it ends in a letter (``\\bund\\b``, ``\\bu\\.``)."""
    pattern = _form(form, dot=False)
    return pattern + r"\b" if re.search(r"\w$", form) else pattern


def _longest_first(forms) -> list[str]:
    return sorted(forms, key=len, reverse=True)


def _part(forms: tuple[str, ...]) -> str:
    """A provision part's forms as one alternation: the full word bare, its abbreviations with a stop."""
    longest = max(len(form) for form in forms)
    alternatives = [_form(f, dot=len(forms) == 1 or len(f) < longest) for f in _longest_first(forms)]
    return "(?:" + "|".join(alternatives) + ")"


def unit_pattern(unit: LocusUnit, *, repeat: bool = True) -> str:
    """A unit's sign, every form, doubled where the record says it may be (``§§``)."""
    body = "(?:" + "|".join(_form(f, dot=unit.dot) for f in _longest_first(unit.forms)) + ")"
    return body + "+" if repeat and unit.repeatable else body


def _flags(unit: LocusUnit) -> int:
    """A word unit reads in any case (``artikel``); a symbol has none."""
    return re.IGNORECASE if unit.word else 0


@dataclass(frozen=True)
class Grammar:
    """The compiled regexes of one source's citation grammar."""

    #: Units in the record's order, the first preferred.
    units: tuple[LocusUnit, ...]
    #: Per unit sign: the first mention of it in a text, its number in group 1.
    first: dict[str, re.Pattern[str]]
    #: Per unit sign: an item at a position, ``(digits, letter)`` in groups 1 and 2.
    signed: dict[str, re.Pattern[str]]
    subsection: re.Pattern[str]
    join: re.Pattern[str]
    range_joins: frozenset[str]
    qualifier: re.Pattern[str]
    subsection_list: re.Pattern[str]
    trailing_reference: re.Pattern[str]
    #: A line that starts a provision of the source's texts; the unit in group ``u<i>``, the number in ``number``.
    section_line: re.Pattern[str]
    #: The first part's marker run into the provision's head: ``§ 63. (1) …``.
    subsection_inline: re.Pattern[str]
    #: The label of a provision's part (``Abs``), and the word between the two ends of a range (``bis``).
    subsection_label: str
    range_word: str

    def unit_index(self, match: re.Match[str]) -> int:
        """Which unit a :attr:`section_line` match is of."""
        return next(i for i in range(len(self.units)) if match.group(f"u{i}"))


def compile_grammar(locus: Locus) -> Grammar:
    """The regexes of ``locus``; see the module docstring for the spelling rules."""
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
    """What narrows one provision: numbered parts, lettered items, an ordinal sentence; each with its list."""
    numbered = "(?:" + "|".join(_part(p) for p in (locus.subsection, locus.item) if p) + ")"
    branches = [rf"{numbered}\s*{_NUMBER}\b(?:{join}(?:{numbered}\s*)?{_NUMBER}\b(?!\.\s*\w))*"]
    if locus.letter:
        letter = _part(locus.letter)
        branches.append(rf"{letter}\s*(?-i:[a-z])\b(?:{join}(?:{letter}\s*)?(?-i:[a-z])\b(?!\.\s*\w))*")
    if locus.sentence:
        branches.append(rf",?\s*\d+\.\s*{re.escape(locus.sentence)}\b")
    return r"\s*(?:" + "|".join(branches) + ")"


def _trailing_reference(locus: Locus) -> re.Pattern[str]:
    """The word that introduced a later reference, left dangling once the reference is cut out.

    The space before a closing parenthesis is taken only WITH the parenthesis: a
    bare ``\\s*\\)?`` lets two repetitions share the same spaces, which
    backtracks exponentially on "(s. (s. (s. …" (CodeQL py/redos).
    """
    if not locus.see_also:
        return re.compile(r"(?!)")
    words = "(?:" + "|".join(_form(w, dot=False) for w in _longest_first(locus.see_also)) + ")"
    return re.compile(rf"(?:[\s,;]+{words}|\s*\(\s*{words}(?:\s*\))?)+$", re.IGNORECASE)
