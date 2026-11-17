from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

SLOT = "reference_fit"

MIN_LINES = 2

FIT_THRESHOLD = 0.6

LINE_CHARS = 400

_LINE = re.compile(r"^- (?P<name>.+?) \(id (?P<id>[0-9a-fA-F-]{36})\)(?P<rest>.*)$")

FITS_QUESTION = {
    "type": "noul",
    "instructions": (
        "The message was asked in a building project. The state names one earlier project of the same office. "
        "Could that earlier project hold a useful answer: did it likely face the same decision, building "
        "element, construction, deviation, Gutachten or authority demand the message is about?"
    ),
    "criteria": {
        "true": (
            "The earlier project's facts or summary concern what the message asks about (the same element, "
            "construction, use, authority or kind of decision), so its documents may show how it was solved."
        ),
        "false": (
            "The earlier project concerns other things than the message: another element, use or problem; "
            "sharing only the Land or the building class is not enough."
        ),
    },
}


@dataclass(frozen=True)
class CatalogLine:
    project_id: str
    text: str


@dataclass(frozen=True)
class ReferenceFit:

    ranked: tuple[tuple[str, float | None], ...]
    catalog: str

    @property
    def order(self) -> list[str]:
        return [project_id for project_id, _ in self.ranked]


def parse_catalog(catalog: str | None) -> tuple[list[CatalogLine], list[str]]:
    lines: list[CatalogLine] = []
    rest: list[str] = []
    for line in (catalog or "").splitlines():
        match = _LINE.match(line)
        if match:
            lines.append(CatalogLine(project_id=match["id"].lower(), text=line))
        elif line.strip():
            rest.append(line)
    return lines, rest


def line_state(question: str, line: CatalogLine) -> dict[str, Any]:
    match = _LINE.match(line.text)
    project = f"{match['name']}{match['rest']}" if match else line.text
    return {"message": question[:600], "earlier_project": project[:LINE_CHARS], "language": "de"}


def reorder(
    lines: list[CatalogLine], scores: list[float | None], threshold: float = FIT_THRESHOLD
) -> list[tuple[CatalogLine, float | None]]:
    pairs = list(zip(lines, scores, strict=True))
    fitting = [(line, p) for line, p in pairs if p is not None and p >= threshold]
    return [*fitting, *((line, p) for line, p in pairs if p is None or p < threshold)]


async def fit_references(
    question: str, catalog: str | None, *, organization_id: str | None = None
) -> ReferenceFit | None:
    from agent.common.decisions import decide_many

    lines, rest = parse_catalog(catalog)
    if len(lines) < MIN_LINES or not question.strip():
        return None
    decided = await decide_many(
        [line_state(question, line) for line in lines],
        {"fits": FITS_QUESTION},
        slot=SLOT,
        organization_id=organization_id,
    )
    scores = [decision.noul("fits") if decision is not None else None for decision in decided]
    if all(score is None for score in scores):
        return None
    ordered = reorder(lines, scores)
    logger.info(
        "Reference fit: %s",
        ", ".join(f"{line.project_id[:8]}={'-' if p is None else f'{p:.2f}'}" for line, p in ordered[:6]),
    )
    return ReferenceFit(
        ranked=tuple((line.project_id, p) for line, p in ordered),
        catalog="\n".join([*(line.text for line, _ in ordered), *rest]),
    )
