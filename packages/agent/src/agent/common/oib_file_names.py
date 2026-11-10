"""The OIB corpus's published filenames, rewritten to the one form every filename reader parses.

The OIB does not publish its corpus under one spelling, and the base corpus keeps
each file under the name oib.or.at publishes (``data/oib/README.md``). Every reader
in ``norm_registry`` (``oib_doc_class``, ``oib_family_member``, ``guess_display_title``)
parses the canonical form ``oib-rl_<n>_ausgabe_<month>_<year>``, so a spelling
variant is one rule here rather than a branch in each reader. The spellings:

- Ausgabe Mai 2023: most files are ``oib-rl_<n>_…``, ``erlaeuterungen_oib-rl_<n>_…``
  and ``aenderungen_oib-rl_<n>_…``, but OIB-RL 2.2 ships as ``oib-richtlinie_2.2_…``,
  ``erlaeuterungen-zu-oib-richtlinie_2.2_…`` and ``aenderungen_oib-richtlinie_2.2_…``.
- Ausgabe April 2019 and Ausgabe März 2015: ``oib-rl-<n>-<title words>-<year>.pdf``
  (``oib-rl-2.1-brandschutz-bei-betriebsbauten-2019.pdf``), with the year only;
  OIB-RL 1 of 2019 ships as ``richtlinie_1_12.04.19_0.pdf``, under its adoption date.
- Ausgabe September 2025: ``oib-rl_6_september_2025.pdf``, without ``ausgabe_``.

This mapping ties a passage to its edition by its file's name, and is the bridge
until retrieval reads the edition from the chunk itself (its ``edition_id``).
"""

from __future__ import annotations

import re

#: Anchored at the start and bound to the ``oib-`` stem, so only a name that
#: already says it is an OIB-Richtlinie is rewritten.
_PUBLISHED_STEM_RE = re.compile(r"^(?:(erlaeuterungen|aenderungen)(?:_|-zu-))?oib-(?:rl|richtlinie)_")
#: The month of each edition whose published names state only its year, as the
#: Austria pack labels them (``configs/knowledge-packs/at.json``: Ausgabe April 2019,
#: Ausgabe März 2015). A year not listed here is never rewritten.
EDITION_MONTH = {"2015": "maerz", "2019": "april"}
#: Month names as filenames spell them (umlauts as digraphs), January first.
_MONTHS = (
    "jaenner",
    "februar",
    "maerz",
    "april",
    "mai",
    "juni",
    "juli",
    "august",
    "september",
    "oktober",
    "november",
    "dezember",
)
_NUMBER = r"(\d+(?:\.\d+)?)"
_SUFFIX = r"(\.pdf)?$"
#: ``oib-rl-2.1-brandschutz-bei-betriebsbauten-2019``: the 2015 and 2019 Richtlinien.
_TITLED_RE = re.compile(rf"^oib-rl-{_NUMBER}-(?:[a-z0-9]+-)*(\d{{4}}){_SUFFIX}")
#: ``oib-rl_6_september_2025``: a month and year without ``ausgabe_``.
_MONTH_YEAR_RE = re.compile(rf"^oib-rl_{_NUMBER}_([a-z]+)_(\d{{4}}){_SUFFIX}")
#: ``richtlinie_1_12.04.19_0``: a Richtlinie published under its adoption date.
_DATED_RE = re.compile(rf"^richtlinie_{_NUMBER}_\d{{2}}\.(\d{{2}})\.(\d{{2}})(?:_\d+)?{_SUFFIX}")


def canonical_oib_file_name(file_name: str) -> str:
    """Lower-cased ``file_name`` with a published OIB spelling rewritten to the canonical form.

    ``oib-richtlinie_2.2_ausgabe_mai_2023.pdf`` -> ``oib-rl_2.2_ausgabe_mai_2023.pdf``;
    ``erlaeuterungen-zu-oib-richtlinie_2.2_…`` -> ``erlaeuterungen_oib-rl_2.2_…``;
    ``oib-rl-5-schallschutz-2019.pdf`` -> ``oib-rl_5_ausgabe_april_2019.pdf``;
    ``richtlinie_1_12.04.19_0.pdf`` -> ``oib-rl_1_ausgabe_april_2019.pdf``;
    ``oib-rl_6_september_2025.pdf`` -> ``oib-rl_6_ausgabe_september_2025.pdf``.
    Any other name comes back lower-cased and otherwise unchanged.
    """
    low = file_name.lower()
    if edition := _edition_spelling(low):
        return edition
    match = _PUBLISHED_STEM_RE.match(low)
    if not match:
        return low
    role = f"{match.group(1)}_" if match.group(1) else ""
    return f"{role}oib-rl_{low[match.end() :]}"


def _edition_spelling(low: str) -> str | None:
    """The canonical name of a Richtlinie published under a year, a month or a date, or None."""
    if "leitfaden" in low:
        return None  # a reading aid, not the Richtlinie: not one of the spellings above
    if match := _TITLED_RE.match(low):
        number, year, suffix = match.groups()
        month = EDITION_MONTH.get(year)
    elif match := _MONTH_YEAR_RE.match(low):
        number, month, year, suffix = match.groups()
        month = month if month in _MONTHS else None
    elif match := _DATED_RE.match(low):
        number, month_number, short_year, suffix = match.groups()
        year = f"20{short_year}"
        month = _MONTHS[int(month_number) - 1] if 1 <= int(month_number) <= 12 else None
        month = month if EDITION_MONTH.get(year) == month else None
    else:
        return None
    return f"oib-rl_{number}_ausgabe_{month}_{year}{suffix or ''}" if month else None
