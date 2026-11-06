"""Which OIB-Richtlinien edition each Land has declared binding: the table the OIB block reads.

The corpus holds one edition (May 2023, ADR-0111), and the Länder have not all
adopted it: three still bind the 2019 edition, and two have put OIB-RL 6:2025
in force. Presenting the corpus edition as binding in every Land is the defect
this table closes (design ``docs/design/international/design.md`` 2.2, defect 7).

Data, not doctrine, and dated: ``CHECKED_ON`` is the day it was last compared
with the OIB's own table of in-force dates
(https://www.oib.or.at/kernaufgaben/oib-richtlinien/#inkrafttreten), which is
the source for every edition below. The LGBl. numbers come from RIS and
secondary consolidations and were not each read in full; re-check them on RIS
before quoting one. When a Land adopts a new edition, change its row and the
date. The country-pack work replaces this table with adoption relations per
Land (build split S8); until then this is the one copy.

``None`` for a Richtlinie means no adoption is known: say so, never assume one.
"""

from __future__ import annotations

from dataclasses import dataclass

#: The edition the knowledge base holds.
CORPUS_EDITION = "2023"

#: The day the table below was last compared with the OIB's adoption table.
CHECKED_ON = "2026-11-06"

_RL = ("1", "2", "3", "4", "5", "6")


@dataclass(frozen=True)
class LandAdoption:
    """The OIB edition each Richtlinie is binding in, for one Land, and the instrument."""

    land: str
    editions: dict[str, str | None]  # Richtlinie number -> edition ("2019", "2023", "2025") or None
    instrument: str


def _same(edition: str | None) -> dict[str, str | None]:
    return dict.fromkeys(_RL, edition)


def _with(base: str | None, **overrides: str | None) -> dict[str, str | None]:
    editions = _same(base)
    editions.update({key.removeprefix("rl"): value for key, value in overrides.items()})
    return editions


#: By intake token (``federal_state``).
OIB_ADOPTION: dict[str, LandAdoption] = {
    "vienna": LandAdoption("Wien", _with("2023", rl6="2025"), "WBTV 2023 (LGBl. 14/2024), RL 6 by LGBl. 26/2026"),
    "lower_austria": LandAdoption("Niederösterreich", _same("2023"), "NÖ BTV 2014 as amended by LGBl. 41/2025"),
    "upper_austria": LandAdoption(
        "Oberösterreich", _with("2023", rl6="2019"), "Oö. BauTV-Novelle 2025 (LGBl. 70/2025)"
    ),
    "styria": LandAdoption("Steiermark", _same("2019"), "StBTV 2020"),
    "carinthia": LandAdoption("Kärnten", _same("2023"), "K-BTV 2024 (LGBl. 105/2024)"),
    "salzburg": LandAdoption("Salzburg", _with("2023", rl6=None), "Bautechnikverordnung LGBl. 83/2026"),
    "tyrol": LandAdoption(
        "Tirol", _with("2023", rl6="2025"), "TBV 2026 § 43 (LGBl. 59/2026), RL 6 without Pkt 2.2 and 2.3.1"
    ),
    "vorarlberg": LandAdoption("Vorarlberg", _same("2019"), "BTV as amended by LGBl. 67/2021"),
    "burgenland": LandAdoption("Burgenland", _same("2019"), "Bgld. BauVO 2008 as amended by LGBl. 22/2021"),
}


def _editions_text(editions: dict[str, str | None]) -> str:
    """``RL 1–5: 2023, RL 6: 2025`` — consecutive Richtlinien with one edition joined. Pure."""
    parts: list[str] = []
    run: list[str] = []
    for number in _RL:
        if run and editions[number] != editions[run[0]]:
            parts.append(_run_text(run, editions[run[0]]))
            run = []
        run.append(number)
    parts.append(_run_text(run, editions[run[0]]))
    return ", ".join(parts)


def _run_text(run: list[str], edition: str | None) -> str:
    numbers = run[0] if len(run) == 1 else f"{run[0]}–{run[-1]}"
    return f"RL {numbers}: {edition or 'no adoption known'}"


def adoption_line(federal_state: str | None) -> str:
    """The prompt line on the binding OIB edition for the project's Land, or for every Land when none is known."""
    adoption = OIB_ADOPTION.get(federal_state or "")
    caveat = (
        f"The knowledge base holds the {CORPUS_EDITION} edition: where the binding edition differs, cite the "
        "passage as that edition, say which edition binds here, and flag that the binding wording was not checked."
    )
    if adoption is None:
        per_land = "; ".join(f"{a.land} {_editions_text(a.editions)}" for a in OIB_ADOPTION.values())
        return (
            f"- OIB edition: the Land is not stated, and the binding edition differs by Land ({per_land}; "
            f"OIB adoption table, checked {CHECKED_ON}). {caveat}"
        )
    line = (
        f"- OIB edition binding in {adoption.land}: {_editions_text(adoption.editions)} "
        f"({adoption.instrument}; OIB adoption table, checked {CHECKED_ON})."
    )
    if all(edition == CORPUS_EDITION for edition in adoption.editions.values()):
        return line
    return f"{line} {caveat}"
