from __future__ import annotations

import re
from dataclasses import dataclass

from knowledge_layer.search.grounding_hits import _CHUNK_TRUNCATE_CHARS as PASSAGE_MAX_CHARS

SECTION_MAX_CHARS = 8000

MAX_HEADINGS = 120

SECTION_LINE_RE = re.compile(r"^\s*(?:(§)+\s*|(Art)(?:ikel)?\.?\s*)(\d+[a-z]?)\s*(?:\.|$)", re.IGNORECASE)
SUBSECTION_LINE_RE = re.compile(r"(?m)^\(\s*(\d+[a-z]?)\s*\)")
SUBSECTION_INLINE_RE = re.compile(r"^\s*(?:§|Art(?:ikel)?\.?)\s*\d+[a-z]?\s*\.?\s*\(\s*(\d+[a-z]?)\s*\)")
_HEADING_MAX_CHARS = 120


@dataclass(frozen=True)
class Section:

    kind: str
    number: str
    heading: str
    body: str

    @property
    def label(self) -> str:
        return f"{self.kind} {self.number}" if self.kind and self.number else ""


def split_sections(text: str) -> list[Section]:
    lines = text.splitlines()
    starts = [(index, match) for index, line in enumerate(lines) if (match := SECTION_LINE_RE.match(line))]
    sections = [
        Section(
            kind="§" if match.group(1) else "Art",
            number=match.group(3),
            heading=_heading_below(lines, index, match) or _heading_above(lines, index),
            body="\n".join(lines[index : _end_of(starts, position, len(lines))]).strip(),
        )
        for position, (index, match) in enumerate(starts)
    ]
    return _one_section_per_label([section for section in sections if _has_text(section)])


def _one_section_per_label(sections: list[Section]) -> list[Section]:
    kept: dict[str, Section] = {}
    for section in sections:
        best = kept.get(section.label)
        if section.label and (best is None or _provision_rank(section) > _provision_rank(best)):
            kept[section.label] = section
    return [section for section in sections if not section.label or kept[section.label] is section]


def _provision_rank(section: Section) -> tuple[bool, int]:
    marker = SECTION_LINE_RE.match(section.body)
    return bool(marker and marker.group(0).rstrip().endswith(".")), len(section.body)


def _end_of(starts: list[tuple[int, object]], position: int, total: int) -> int:
    return starts[position + 1][0] if position + 1 < len(starts) else total


def _heading_above(lines: list[str], index: int) -> str:
    previous = lines[index - 1].strip() if index > 0 else ""
    return previous if _is_heading(previous) else ""


def _heading_below(lines: list[str], index: int, marker: re.Match[str]) -> str:
    if lines[index][marker.end() :].strip():
        return ""
    below = lines[index + 1].strip() if index + 1 < len(lines) else ""
    return below if _is_heading(below) and not SUBSECTION_LINE_RE.match(below) else ""


def _has_text(section: Section) -> bool:
    return bool(SECTION_LINE_RE.sub("", section.body, count=1).strip())


def _is_heading(line: str) -> bool:
    if not line or len(line) > _HEADING_MAX_CHARS:
        return False
    return not line.endswith((".", ":", ",", ";")) and not SECTION_LINE_RE.match(line)


def subsection_body(section: Section, subsection: str) -> tuple[str, str]:
    if not subsection or not section.number:
        return section.body, ""
    marks = _subsection_marks(section.body)
    for position, (number, start) in enumerate(marks):
        if number.lower() != subsection.lower():
            continue
        end = marks[position + 1][1] if position + 1 < len(marks) else len(section.body)
        return section.body[start:end].strip(), number
    return section.body, ""


def _subsection_marks(body: str) -> list[tuple[str, int]]:
    marks = [(match.group(1), match.start()) for match in SUBSECTION_LINE_RE.finditer(body)]
    inline = SUBSECTION_INLINE_RE.match(body)
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


def headings_index(sections: list[Section]) -> str:
    shown = sections[:MAX_HEADINGS]
    lines = [f"{section.label}{f' — {section.heading}' if section.heading else ''}" for section in shown]
    if len(sections) > len(shown):
        lines.append(f"… and {len(sections) - len(shown)} more §§ (index truncated)")
    return "\n".join(lines)
