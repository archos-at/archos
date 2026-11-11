#!/usr/bin/env python3
"""The website's country claims come from coverage, and claim no more (design §1.3, ADR-0173).

Coverage is a reviewed claim on a territory record (`coverageLevel`), proposed in
the country packs under `configs/knowledge-packs/` and released through a change
request. This script reads the level each pack states for its country, writes the
building-law page's country lines from it (`--write`), and fails when:

- the generated module (`apps/website/src/i18n/pages/coverage.generated.ts`)
  is not what the packs give, or
- the page's hand-written copy (`building-law.ts`) names a market country outside
  the generated lines, where a claim about it could slip past this check.

A country is "covered" at `open` or better; until a pack states one, its law is
not claimed. Run from the repository root:

    python3 scripts/check_coverage_copy.py           # check (pre-commit, CI)
    python3 scripts/check_coverage_copy.py --write   # regenerate
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKS = ROOT / "configs" / "knowledge-packs"
GENERATED = ROOT / "apps" / "website" / "src" / "i18n" / "pages" / "coverage.generated.ts"
PAGE = ROOT / "apps" / "website" / "src" / "i18n" / "pages" / "building-law.ts"

#: The markets the website speaks to, in the order its copy names them, with each locale's name.
MARKETS: dict[str, dict[str, str]] = {
    "AT": {"de": "Österreich", "en": "Austria", "de_in": "Österreich", "en_in": "Austria"},
    "DE": {"de": "Deutschland", "en": "Germany", "de_in": "Deutschland", "en_in": "Germany"},
    "CH": {"de": "Schweiz", "en": "Switzerland", "de_in": "der Schweiz", "en_in": "Switzerland"},
}

#: Levels that let the website claim a country's law, weakest first.
CLAIMING_LEVELS = ("open", "core", "full")


def pack_coverage() -> dict[str, str]:
    """The coverage level each pack states for its own country's territory record; none for a pack that states none."""
    levels: dict[str, str] = {}
    for path in sorted(PACKS.glob("*.json")):
        pack = json.loads(path.read_text(encoding="utf-8"))
        country = pack.get("countryId")
        for record in pack.get("records", []):
            if record.get("type") == "territory" and record.get("id") == country and record.get("coverageLevel"):
                levels[country] = record["coverageLevel"]
    return levels


def _join(names: list[str], word: str) -> str:
    return names[0] if len(names) == 1 else f"{', '.join(names[:-1])} {word} {names[-1]}"


def _quote(text: str) -> str:
    return "'" + text.replace("\\", "\\\\").replace("'", "\\'") + "'"


def render(levels: dict[str, str]) -> str:
    """The generated module: the country lines of the building-law page in both locales."""
    covered = [code for code in MARKETS if levels.get(code) in CLAIMING_LEVELS]
    elsewhere = [code for code in MARKETS if code not in covered]
    de_covered = _join([MARKETS[c]["de"] for c in covered], "und") if covered else "noch kein Land"
    en_covered = _join([MARKETS[c]["en"] for c in covered], "and") if covered else "no country yet"
    lines = {
        "de": {
            "itemKey": _join([MARKETS[c]["de"] for c in elsewhere], "und"),
            "itemValue": (
                "Die Rechtstexte noch nicht. "
                "Pläne, Modelle, Unterlagen und Bürowissen nutzt {name} unabhängig vom Land."
            ),
            "faqQ": f"Gilt das auch für Projekte in {_join([MARKETS[c]['de_in'] for c in elsewhere], 'oder')}?",
            "faqA": (
                f"Die Rechtstexte decken heute {de_covered} ab. "
                "Projektunterlagen, Pläne, Modelle und Bürowissen nutzt {name} in jedem Land."
            ),
        },
        "en": {
            "itemKey": _join([MARKETS[c]["en"] for c in elsewhere], "and"),
            "itemValue": (
                "Not the legal texts yet. "
                "{name} works with plans, models, documents and office knowledge in any country."
            ),
            "faqQ": f"Does this work for projects in {_join([MARKETS[c]['en_in'] for c in elsewhere], 'or')}?",
            "faqA": (
                f"The legal texts cover {en_covered} today. "
                "{name} works with project documents, plans, models and office knowledge in any country."
            ),
        },
    }
    out = [
        "/**",
        " * The building-law page's country lines, generated from the coverage the country packs state",
        " * (configs/knowledge-packs/, ADR-0173) by scripts/check_coverage_copy.py --write. Do not edit:",
        " * the check fails copy that claims a country's law before its pack states a coverage.",
        " */",
        "",
        "export const coverageCopy = {",
    ]
    for locale, strings in lines.items():
        out.append(f"  {locale}: {{")
        out.extend(f"    {key}: {_quote(value)}," for key, value in strings.items())
        out.append("  },")
    out.append("}")
    out.append("")
    out.append("// A dictionary like every page module, so scripts/check_brand_rules.mjs reads these lines too.")
    out.append("export default coverageCopy")
    return "\n".join(out) + "\n"


def hand_written_claims(page: str) -> list[str]:
    """Lines of the page's copy, outside its header comment, that name a market country the packs do not cover."""
    body = page.split("*/", 1)[1] if "*/" in page else page
    names = [name for code in MARKETS for name in (MARKETS[code]["de"], MARKETS[code]["en"]) if code != "AT"]
    pattern = re.compile(r"\b(" + "|".join(re.escape(name) for name in names) + r")\b")
    return [line.strip() for line in body.splitlines() if pattern.search(line)]


def main(argv: list[str]) -> int:
    expected = render(pack_coverage())
    if "--write" in argv:
        GENERATED.write_text(expected, encoding="utf-8")
        return 0
    problems: list[str] = []
    if not GENERATED.exists() or GENERATED.read_text(encoding="utf-8") != expected:
        problems.append(f"{GENERATED.relative_to(ROOT)} is not what the packs' coverage gives; run with --write")
    problems += [
        f"{PAGE.relative_to(ROOT)} names a country outside the generated lines: {line}"
        for line in hand_written_claims(PAGE.read_text(encoding="utf-8"))
    ]
    for problem in problems:
        print(f"coverage copy: {problem}", file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
