"""Write the table that places a typed Austrian address in its Bundesland.

Reads GeoNames' Austrian postal-code file (``AT.txt`` from
https://download.geonames.org/export/zip/AT.zip, CC BY 4.0) and writes
``apps/workspace/bff/project-profile/austrian-postal-codes.json``: for every
Postleitzahl, one line ``code|state:place,place|state:place`` naming the place
and municipality names it serves under the ``federal_state`` token of their
Land. Lines, not an object, so TypeScript reads the import as ``string[]``.
A typed address is placed only when its postal code AND the place after it are
in the table, because a Swiss or a Liechtenstein code has four digits too
("8001 Zürich" is not in Styria). The attribution GeoNames asks for is in
``postal-place.ts`` and in ``docs/design/agentic-project-intake.md``.

    curl -sSO https://download.geonames.org/export/zip/AT.zip && unzip AT.zip
    python3 scripts/generate_austrian_postal_codes.py AT.txt

Run it again when the Post's directory moves; the table is data, not code.
"""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "apps/workspace/bff/project-profile/austrian-postal-codes.json"

# GeoNames' admin1 name -> the intake's federal_state token (A2_land).
STATES = {
    "Wien": "vienna",
    "Niederösterreich": "lower_austria",
    "Oberösterreich": "upper_austria",
    "Steiermark": "styria",
    "Kärnten": "carinthia",
    "Salzburg": "salzburg",
    "Tirol": "tyrol",
    "Vorarlberg": "vorarlberg",
    "Burgenland": "burgenland",
}


def place_key(name: str) -> str:
    """The form a place name is compared in; `postal-place.ts` normalises a typed one the same way."""
    head = name.split(",")[0].lower()
    head = re.sub(r"\bpostfach\b", "", head)
    head = re.sub(r"\bst\.\s*", "sankt ", head)
    head = re.sub(r"[^a-zäöüß ]+", " ", head)
    return " ".join(head.split())


def build(rows: list[list[str]]) -> list[str]:
    places: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for row in rows:
        code, place, state, municipality = row[1], row[2], row[3], row[7]
        for name in (place, municipality):
            key = place_key(name)
            if key:
                places[code][key].add(STATES[state])
    lines = []
    for code, names in sorted(places.items()):
        by_state: dict[str, list[str]] = defaultdict(list)
        for key, states in sorted(names.items()):
            # A name that sits in two Länder under one code says nothing; it is left out.
            if len(states) == 1:
                by_state[next(iter(states))].append(key)
        lines.append("|".join([code, *(f"{state}:{','.join(keys)}" for state, keys in sorted(by_state.items()))]))
    return lines


def main(source: str) -> None:
    rows = [line.rstrip("\n").split("\t") for line in Path(source).read_text(encoding="utf-8").splitlines()]
    lines = build([row for row in rows if len(row) > 7 and row[0] == "AT"])
    OUT.write_text(json.dumps(lines, ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
    print(f"{len(lines)} postal codes -> {OUT}")


if __name__ == "__main__":
    main(sys.argv[1])
