from __future__ import annotations

import re
from dataclasses import dataclass

from knowledge_layer.search import PASSAGE_MAX_CHARS

from agent.knowledge.law_lookup.locus import Grammar

SECTION_MAX_CHARS = 8000

MAX_HEADINGS = 120

SUBSECTION_LINE_RE = re.compile(r"(?m)^\(\s*(\d+[a-z]?)\s*\)")
_HEADING_MAX_CHARS = 120

__all__ = [
    "MAX_HEADINGS",
    "PASSAGE_MAX_CHARS",
    "SECTION_MAX_CHARS",
    "Section",
    "cut_on_subsection",
    "headings_index",
    "split_sections",
    "subsection_body",
]


@dataclass(frozen=True)
class Section:

    kind: str
    number: str
    heading: str
    body: str

    @property
    def label(self) -> str:
        return f"{self.kind} {self.number}" if self.kind and self.number else ""


def split_sections(text: str, grammar: Grammar) -> list[Section]:
    lines = text.splitlines()
    starts = [(index, match) for index, line in enumerate(lines) if (match := grammar.section_line.match(line))]
    sections = [
        Section(
            kind=grammar.units[grammar.unit_index(match)].sign,
            number=match.group("number"),
            heading=_heading_below(lines, index, match, grammar) or _heading_above(lines, index, grammar),
            body="\n".join(lines[index : _end_of(starts, position, len(lines))]).strip(),
        )
        for position, (index, match) in enumerate(starts)
    ]
    return _one_section_per_label([s for s in sections if _has_text(s, grammar)], grammar)


def _one_section_per_label(sections: list[Section], grammar: Grammar) -> list[Section]:
    kept: dict[str, Section] = {}
    for section in sections:
        best = kept.get(section.label)
        if section.label and (best is None or _provision_rank(section, grammar) > _provision_rank(best, grammar)):
            kept[section.label] = section
    return [section for section in sections if not section.label or kept[section.label] is section]


def _provision_rank(section: Section, grammar: Grammar) -> tuple[bool, int]:
    marker = grammar.section_line.match(section.body)
    return bool(marker and marker.group(0).rstrip().endswith(".")), len(section.body)


def _end_of(starts: list[tuple[int, object]], position: int, total: int) -> int:
    return starts[position + 1][0] if position + 1 < len(starts) else total


def _heading_above(lines: list[str], index: int, grammar: Grammar) -> str:
    previous = lines[index - 1].strip() if index > 0 else ""
    return previous if _is_heading(previous, grammar) else ""


def _heading_below(lines: list[str], index: int, marker: re.Match[str], grammar: Grammar) -> str:
    if lines[index][marker.end() :].strip():
        return ""
    below = lines[index + 1].strip() if index + 1 < len(lines) else ""
    return below if _is_heading(below, grammar) and not SUBSECTION_LINE_RE.match(below) else ""


def _has_text(section: Section, grammar: Grammar) -> bool:
    return bool(grammar.section_line.sub("", section.body, count=1).strip())


def _is_heading(line: str, grammar: Grammar) -> bool:
    if not line or len(line) > _HEADING_MAX_CHARS:
        return False
    return not line.endswith((".", ":", ",", ";")) and not grammar.section_line.match(line)


def subsection_body(section: Section, subsection: str, grammar: Grammar) -> tuple[str, str]:
    if not subsection or not section.number:
        return section.body, ""
    marks = _subsection_marks(section.body, grammar)
    for position, (number, start) in enumerate(marks):
        if number.lower() != subsection.lower():
            continue
        end = marks[position + 1][1] if position + 1 < len(marks) else len(section.body)
        return section.body[start:end].strip(), number
    return section.body, ""


def _subsection_marks(body: str, grammar: Grammar) -> list[tuple[str, int]]:
    marks = [(match.group(1), match.start()) for match in SUBSECTION_LINE_RE.finditer(body)]
    inline = grammar.subsection_inline.match(body)
    if inline:
        marks.insert(0, (inline.group(1), 0))
    return marks


def cut_on_subsection(text: str, limit: int = PASSAGE_MAX_CHARS) -> str:
    if len(text) <= limit:
        return text
    window = text[:limit]
    marks = [match.start() for match in SUBSECTION_LINE_RE.finditer(window)]
    cut = marks[-1] if marks and marks[-1] > limit // 2 else window.rfind("\n")
    return text[: cut if cut > 0 else limit].rstrip() + "... [truncated]"


def headings_index(sections: list[Section], plural: str) -> str:
    shown = sections[:MAX_HEADINGS]
    lines = [f"{section.label}{f' — {section.heading}' if section.heading else ''}" for section in shown]
    if len(sections) > len(shown):
        lines.append(f"… and {len(sections) - len(shown)} more {plural} (index truncated)")
    return "\n".join(lines)
