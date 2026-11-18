from __future__ import annotations

import re

_PUBLISHED_STEM_RE = re.compile(r"^(?:(erlaeuterungen|aenderungen)(?:_|-zu-))?oib-(?:rl|richtlinie)_")
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


PUBLISHED_COMPANIONS = {"oib-rl_6_normaussentemperaturen": "normaussentemperaturen-zu-oib-rl-6"}


def canonical_oib_file_name(file_name: str) -> str:
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
