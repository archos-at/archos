from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "apps/workspace/bff/project-profile/austrian-postal-codes.json"

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
    head = name.split(",", maxsplit=1)[0].lower()
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
