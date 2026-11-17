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

The 2019, 2025 and 2015 names are listed one by one in :data:`PUBLISHED_EDITIONS`.

This mapping ties a passage to its edition by its file's name, and is the bridge
until retrieval reads the edition from the chunk itself (its ``edition_id``).
"""

from __future__ import annotations

import re

#: Anchored at the start and bound to the ``oib-`` stem, so only a name that
#: already says it is an OIB-Richtlinie is rewritten.
_PUBLISHED_STEM_RE = re.compile(r"^(?:(erlaeuterungen|aenderungen)(?:_|-zu-))?oib-(?:rl|richtlinie)_")
#: The Richtlinien of the editions published under other spellings, each by its exact name (lower-cased,
#: without ``.pdf``) and the canonical name it reads as. A table, not a pattern: every item page also
#: publishes ``oib-rl-<n>-aenderungen-gegenueber-version-2015.pdf``, a diff a pattern over
#: ``oib-rl-<n>-…-<year>`` read as the 2015 Richtlinie itself. The names were read off
#: https://www.oib.or.at/richtlinien/oib-richtlinien-<year>/oib-richtlinie-<n> on 2026-11-10, the months
#: off the Austria pack's edition labels (``configs/knowledge-packs/at.json``).
PUBLISHED_EDITIONS = {
    "richtlinie_1_12.04.19_0": "oib-rl_1_ausgabe_april_2019",
    "oib-rl-2-brandschutz-2019": "oib-rl_2_ausgabe_april_2019",
    "oib-rl-2.1-brandschutz-bei-betriebsbauten-2019": "oib-rl_2.1_ausgabe_april_2019",
    "oib-rl-2.2-brandschutz-bei-garagen-ueberdachten-stellplaetzen-und-parkdecks-2019": "oib-rl_2.2_ausgabe_april_2019",
    "oib-rl-2.3-brandschutz-bei-gebaeuden-mit-einem-fluchtniveau-von-mehr-als-22-m-2019": (
        "oib-rl_2.3_ausgabe_april_2019"
    ),
    "oib-rl-3-hygiene-gesundheit-und-umweltschutz-2019": "oib-rl_3_ausgabe_april_2019",
    "oib-rl-4-nutzungssicherheit-und-barrierefreiheit-2019": "oib-rl_4_ausgabe_april_2019",
    "oib-rl-5-schallschutz-2019": "oib-rl_5_ausgabe_april_2019",
    "oib-rl-6-energieeinsparung-und-waermeschutz-2019": "oib-rl_6_ausgabe_april_2019",
    "oib-rl_6_september_2025": "oib-rl_6_ausgabe_september_2025",
    "oib-rl-6-energieeinsparung-und-waermeschutz-2015": "oib-rl_6_ausgabe_maerz_2015",
}


#: Files published under the ``oib-rl_<n>_`` stem that are no Richtlinie, each by its exact name and a
#: name no OIB reader parses: the RL 6 temperature table on the 2025 item page.
PUBLISHED_COMPANIONS = {"oib-rl_6_normaussentemperaturen": "normaussentemperaturen-zu-oib-rl-6"}


def canonical_oib_file_name(file_name: str) -> str:
    """Lower-cased ``file_name`` with a published OIB spelling rewritten to the canonical form.

    ``oib-richtlinie_2.2_ausgabe_mai_2023.pdf`` -> ``oib-rl_2.2_ausgabe_mai_2023.pdf``;
    ``erlaeuterungen-zu-oib-richtlinie_2.2_…`` -> ``erlaeuterungen_oib-rl_2.2_…``;
    ``oib-rl-5-schallschutz-2019.pdf`` -> ``oib-rl_5_ausgabe_april_2019.pdf`` (a name in
    :data:`PUBLISHED_EDITIONS`). Any other name comes back lower-cased and otherwise unchanged.
    """
    low = file_name.lower()
    stem, suffix = (low[: -len(".pdf")], ".pdf") if low.endswith(".pdf") else (low, "")
    if stem in PUBLISHED_EDITIONS:
        return PUBLISHED_EDITIONS[stem] + suffix
    if stem in PUBLISHED_COMPANIONS:
        return PUBLISHED_COMPANIONS[stem] + suffix
    match = _PUBLISHED_STEM_RE.match(low)
    if not match:
        return low
    role = f"{match.group(1)}_" if match.group(1) else ""
    return f"{role}oib-rl_{low[match.end() :]}"
