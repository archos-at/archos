"""Which OIB files an answer cites, read through the corpus's canonical filename (``agent/common/oib_file_names``).

An answer's source lines name the file a passage came from. The 2023 files read
``oib-rl_<n>_ausgabe_mai_2023.pdf``; the 2019 and 2015 ones oib.or.at publishes as
``oib-rl-<n>-<title>-2019.pdf`` and ``richtlinie_1_12.04.19_0.pdf``, which a pattern over
``rl_<n>_`` does not see. Every name is rewritten to the canonical form first, so the
Richtlinie and the edition are read the same way whichever spelling the corpus holds.
"""

from __future__ import annotations

import re

_PDF = re.compile(r"[\w.\-]+\.pdf\b", re.IGNORECASE)
#: The Richtlinie number in a canonical name or in prose: ``rl_6_``, ``richtlinie_2.1_``.
_FAMILY = re.compile(r"(?:rl|richtlinie)_(\d+(?:\.\d+)?)_", re.IGNORECASE)
#: The edition year in a canonical name: ``ausgabe_april_2019``, ``ausgabe_2025``.
_EDITION_YEAR = re.compile(r"ausgabe_(?:[a-z]+_)?(\d{4})")


def cited_files(answer: str) -> list[str]:
    """Every PDF the answer names, in its canonical spelling, in order of first mention."""
    from agent.common.oib_file_names import canonical_oib_file_name  # stdlib-only, beside the agent

    seen: dict[str, None] = {}
    for name in _PDF.findall(answer):
        seen.setdefault(canonical_oib_file_name(name), None)
    return list(seen)


def cited_families(answer: str) -> list[str]:
    """The Richtlinien the answer cites, by number (``"2"``, ``"2.1"``), from its prose and its files."""
    found = set(_FAMILY.findall(answer))
    found |= {number for name in cited_files(answer) for number in _FAMILY.findall(name)}
    return sorted(found)


def cited_edition_years(answer: str, guideline: str) -> set[str]:
    """The editions (years) of OIB-RL ``guideline`` whose own text the answer cites by file."""
    own = re.compile(rf"^oib-rl_{re.escape(guideline)}_")
    return {year for name in cited_files(answer) if own.match(name) for year in _EDITION_YEAR.findall(name)}
