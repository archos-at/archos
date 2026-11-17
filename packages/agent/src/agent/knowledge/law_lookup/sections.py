"""The provision grammar of a consolidated text: provisions, their parts, their headings.

A source's plain text is positional, so this is: a line beginning with a
provision's marker (``§ 63.``) opens a provision and everything up to the next
such line is its body; a part marker ``(1)`` opens a part, either on its own
line or run into the provision's head. Which signs mark a provision is the
source's citation grammar (``locus.py``). Nothing here knows about questions,
LLMs or the tool: it splits text and cuts text, which is why every extraction
test can be written against it directly.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from knowledge_layer.search import PASSAGE_MAX_CHARS

from agent.knowledge.law_lookup.locus import Grammar

#: The bound for a provision the caller NAMED. A provision is what a lawyer
#: cites and what the agent asked for; cut at the corpus chunk bound above, a
#: named one arrived as its first fifth and the agent spent three more lookups
#: asking for the rest. 8000 characters (about 2k tokens) holds nearly every
#: provision of a building code whole; a ranked pick the agent did not name
#: keeps the chunk bound.
SECTION_MAX_CHARS = 8000

#: Headings listed per document, for the picker and for a miss.
MAX_HEADINGS = 120

#: A part marker at the start of a line: the boundary a passage is cut on.
SUBSECTION_LINE_RE = re.compile(r"(?m)^\(\s*(\d+[a-z]?)\s*\)")
#: A line that can serve as a provision's heading: short, and not a sentence.
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
    """One provision of a consolidated text, as the document states it."""

    kind: str
    number: str
    heading: str
    body: str

    @property
    def label(self) -> str:
        """``§ 63``; empty for a document with no provision grammar (a court decision)."""
        return f"{self.kind} {self.number}" if self.kind and self.number else ""


def split_sections(text: str, grammar: Grammar) -> list[Section]:
    """Split a consolidated text into its provisions, in document order.

    The short line under a bare marker, or else the one above it, when it
    reads as a heading, is recorded as the provision's heading. One above is
    left in the previous body too, because guessing wrong about a heading must
    not DELETE text a citation rests on.
    """
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
    # A bare marker line ABOVE the provision it names matches this grammar too,
    # and would otherwise contribute a section with no text in it.
    return _one_section_per_label([s for s in sections if _has_text(s, grammar)], grammar)


def _one_section_per_label(sections: list[Section], grammar: Grammar) -> list[Section]:
    """One section per provision: the one that carries it.

    A source states a provision more than once: a header block before every
    provision, or a table of contents far from the provision itself. Each stub
    matches the grammar, so a lookup returned it as a passage of its own and
    registered the same citation key twice. The provision is the one whose
    marker ends in a full stop (``§ 8.``), the form a provision has and a stub
    never does; between equals, the longest body. Length alone lost a repealed
    ``§ 8.`` / ``(entfällt)`` to its longer table of contents entry.
    """
    kept: dict[str, Section] = {}
    for section in sections:
        best = kept.get(section.label)
        if section.label and (best is None or _provision_rank(section, grammar) > _provision_rank(best, grammar)):
            kept[section.label] = section
    return [section for section in sections if not section.label or kept[section.label] is section]


def _provision_rank(section: Section, grammar: Grammar) -> tuple[bool, int]:
    """How much a section reads as the provision: a marker with a full stop first, then length."""
    marker = grammar.section_line.match(section.body)
    return bool(marker and marker.group(0).rstrip().endswith(".")), len(section.body)


def _end_of(starts: list[tuple[int, object]], position: int, total: int) -> int:
    """Where one section's body stops: at the next section, or at the end."""
    return starts[position + 1][0] if position + 1 < len(starts) else total


def _heading_above(lines: list[str], index: int, grammar: Grammar) -> str:
    """The heading on the line above a provision start, when there is one."""
    previous = lines[index - 1].strip() if index > 0 else ""
    return previous if _is_heading(previous, grammar) else ""


def _heading_below(lines: list[str], index: int, marker: re.Match[str], grammar: Grammar) -> str:
    """The heading on the line after a bare marker, where a text puts it there.

    Some codes write ``§ 8`` / its heading / ``(1)``; read only above, their
    index was bare numbers and the picker, which chooses by heading, chose
    blind. It is read before the line above: in such a text that line is the
    previous entry's title, or the chapter's. A marker with text run into it
    has no heading below.
    """
    if lines[index][marker.end() :].strip():
        return ""
    below = lines[index + 1].strip() if index + 1 < len(lines) else ""
    return below if _is_heading(below, grammar) and not SUBSECTION_LINE_RE.match(below) else ""


def _has_text(section: Section, grammar: Grammar) -> bool:
    """Whether a section carries anything beyond its own marker."""
    return bool(grammar.section_line.sub("", section.body, count=1).strip())


def _is_heading(line: str, grammar: Grammar) -> bool:
    """Whether a line reads as a heading rather than as a sentence."""
    if not line or len(line) > _HEADING_MAX_CHARS:
        return False
    return not line.endswith((".", ":", ",", ";")) and not grammar.section_line.match(line)


def subsection_body(section: Section, subsection: str, grammar: Grammar) -> tuple[str, str]:
    """``(body, subsection)`` narrowed to one part, or the whole provision.

    A part the document does not carry returns the provision unchanged: the
    honest answer to "part 9" of a provision with three is the provision, never
    an empty passage and never the wrong part.
    """
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
    """``(subsection, offset)`` for every part marker, the run-in one included."""
    marks = [(match.group(1), match.start()) for match in SUBSECTION_LINE_RE.finditer(body)]
    inline = grammar.subsection_inline.match(body)
    if inline:
        marks.insert(0, (inline.group(1), 0))
    return marks


def cut_on_subsection(text: str, limit: int = PASSAGE_MAX_CHARS) -> str:
    """Truncate a passage on a part boundary, never mid-part.

    The default bound is the knowledge layer's own ``_CHUNK_TRUNCATE_CHARS``
    (imported, never restated). The marker is the knowledge layer's own
    ``... [truncated]``, so the citation parser strips it back off exactly as it
    does for a corpus chunk.
    """
    if len(text) <= limit:
        return text
    window = text[:limit]
    marks = [match.start() for match in SUBSECTION_LINE_RE.finditer(window)]
    cut = marks[-1] if marks and marks[-1] > limit // 2 else window.rfind("\n")
    return text[: cut if cut > 0 else limit].rstrip() + "... [truncated]"


def headings_index(sections: list[Section], plural: str) -> str:
    """The headings of one document, as the picker (and a miss) sees them; ``plural`` names the provisions (``§§``)."""
    shown = sections[:MAX_HEADINGS]
    lines = [f"{section.label}{f' — {section.heading}' if section.heading else ''}" for section in shown]
    if len(sections) > len(shown):
        lines.append(f"… and {len(sections) - len(shown)} more {plural} (index truncated)")
    return "\n".join(lines)
