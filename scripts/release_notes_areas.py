from __future__ import annotations

import re

AREAS: dict[str, str] = {
    "projects": "Projects and setup",
    "documents": "Files and the office shelf",
    "answers": "Questions and answers",
    "search": "Search",
    "building-law": "Building law and norms",
    "bim": "Building models",
    "collaboration": "Working as a team",
    "tasks": "Tasks and research",
    "office-knowledge": "What the office knows",
    "administration": "Administration",
    "agents": "Your own agents",
    "general": "General",
}

AREA_LINE = re.compile(r"^#\s*area\s*:\s*(?P<value>.*?)\s*$", re.MULTILINE | re.IGNORECASE)
TEMPLATE_AREA = "choose one"


def area_line(raw: str) -> str | None:
    match = AREA_LINE.search(raw)
    return match.group("value").strip().lower() if match else None


def note_area(filename: str, raw: str | None) -> str:
    declared = area_line(raw) if raw else None
    if declared not in AREAS:
        raise ValueError(f"{filename}: no known `# area:` line. Fix: run `task release:lint`, which names the areas.")
    return declared


def lint_area(filename: str, raw: str) -> list[str]:
    lines = AREA_LINE.findall(raw)
    known = ", ".join(AREAS)
    if not lines:
        return [
            f"{filename}: no `# area:` line. Fix: put `# area: <one of {known}>` under the `---`, "
            "naming where the reader meets the change (docs/contributing/release-notes.md, „The product area“)."
        ]
    if len(lines) > 1:
        return [f"{filename}: {len(lines)} `# area:` lines. Fix: keep one; a note belongs to one area."]
    value = lines[0].strip().lower()
    if TEMPLATE_AREA in value:
        return [f"{filename}: the `# area:` line still holds the template text. Fix: write one of {known}."]
    if value not in AREAS:
        return [f"{filename}: unknown area `{value}`. Fix: write one of {known}."]
    return []
