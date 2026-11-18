from __future__ import annotations

import hashlib
import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from agent.common.image_redaction import redact_inline_images

PROMPT_VERSION = 1

MAX_REGIONS = 12
MAX_SUMMARY_LINES = 8
MAX_LABEL_CHARS = 80
MAX_SUMMARY_LINE_CHARS = 240
MIN_SIDE = 0.004
EDGE_TOLERANCE = 0.02

NO_CHANGE_TEXT = "keine sichtbare Änderung"

CACHE_TTL_SECONDS = 30 * 86400

MAX_COMPLETION_TOKENS = 1500

COMPARE_PROMPT = "\n".join(
    (
        "You compare two Fassungen of the same page of a building drawing. "
        "The FIRST image is the OLDER Fassung, the SECOND image the NEWER Fassung.",
        "",
        "List the concrete visible changes from the older to the newer Fassung: moved, "
        "added or removed walls, openings (doors, windows), dimensions and elevation marks, labels "
        "and room names, and in the Plankopf the index, date and drawing number.",
        "",
        "Rules:",
        "- Name only what you actually see in the two images. Invent nothing. When in doubt, leave the change out.",
        "- Differences in the rendering are not changes: scan quality, noise, brightness, "
        "a different crop, a slightly shifted sheet.",
        f"- At most {MAX_REGIONS} changes. Merge related changes into one.",
        "- Each change has a box on the NEWER page (for a removed element: where it used to be). "
        "x and y are the top-left corner, w and h the width and height, each as a fraction of the "
        "page width or page height between 0 and 1; 0,0 is the top left.",
        '- label: at most six words, in German, e.g. "Wand nach Norden verschoben".',
        "- summary: one short German sentence per change, in words, with dimensions and values when you can read them.",
        f'- If you see no change: "changes" is [] and "summary" is ["{NO_CHANGE_TEXT}"].',
        "",
        "Answer with a JSON object only, with no explanation before or after it:",
        '{"changes": [{"label": "...", "x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0}], "summary": ["..."]}',
    )
)


@dataclass(frozen=True)
class CompareRegion:
    page: int
    x: float
    y: float
    w: float
    h: float
    label: str

    def as_dict(self) -> dict[str, Any]:
        return {"page": self.page, "x": self.x, "y": self.y, "w": self.w, "h": self.h, "label": self.label}


@dataclass(frozen=True)
class CompareResult:
    regions: tuple[CompareRegion, ...]
    summary: tuple[str, ...]

    def as_dict(self) -> dict[str, Any]:
        return {"regions": [region.as_dict() for region in self.regions], "summary": list(self.summary)}

    @classmethod
    def from_dict(cls, data: Any) -> CompareResult | None:
        if not isinstance(data, Mapping):
            return None
        raw_regions, raw_summary = data.get("regions"), data.get("summary")
        if not isinstance(raw_regions, list) or not isinstance(raw_summary, list):
            return None
        try:
            regions = tuple(CompareRegion(**item) for item in raw_regions)
        except TypeError:
            return None
        if not all(isinstance(line, str) for line in raw_summary):
            return None
        return cls(regions, tuple(raw_summary))


def build_messages(older_data_url: str, newer_data_url: str) -> list[dict[str, Any]]:
    return [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": COMPARE_PROMPT},
                {"type": "text", "text": "Ältere Fassung:"},
                {"type": "image_url", "image_url": {"url": older_data_url}},
                {"type": "text", "text": "Neuere Fassung:"},
                {"type": "image_url", "image_url": {"url": newer_data_url}},
            ],
        }
    ]


def traceable(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return redact_inline_images(messages)


def cache_key(model: str, collection: str, page: int, older_jpeg: bytes, newer_jpeg: bytes) -> str:
    older, newer = (hashlib.sha256(jpeg).hexdigest() for jpeg in (older_jpeg, newer_jpeg))
    return f"revision-compare:v{PROMPT_VERSION}:{model}:{collection}:p{page}:{older}:{newer}"


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value) if math.isfinite(value) else None


def _in_page(value: float) -> bool:
    return -EDGE_TOLERANCE <= value <= 1 + EDGE_TOLERANCE


def _box(item: Mapping[str, Any]) -> tuple[float, float, float, float] | None:
    raw = item.get("box")
    if isinstance(raw, list) and len(raw) == 4:
        values = [_number(value) for value in raw]
    else:
        values = [_number(item.get(key)) for key in ("x", "y", "w", "h")]
    if any(value is None for value in values) or not all(_in_page(value) for value in values if value is not None):
        return None
    x, y, w, h = (min(max(value, 0.0), 1.0) for value in values if value is not None)
    w, h = min(w, 1.0 - x), min(h, 1.0 - y)
    if w < MIN_SIDE or h < MIN_SIDE:
        return None
    return round(x, 4), round(y, 4), round(w, 4), round(h, 4)


def _text(value: Any, limit: int) -> str:
    return " ".join(value.split())[:limit].rstrip() if isinstance(value, str) else ""


def _regions(raw: Any, page: int) -> tuple[CompareRegion, ...]:
    if not isinstance(raw, list):
        return ()
    regions: list[CompareRegion] = []
    for item in raw:
        if not isinstance(item, Mapping):
            continue
        label, box = _text(item.get("label"), MAX_LABEL_CHARS), _box(item)
        if not label or box is None:
            continue
        regions.append(CompareRegion(page, *box, label))
        if len(regions) == MAX_REGIONS:
            break
    return tuple(regions)


def _summary(raw: Any) -> tuple[str, ...]:
    if not isinstance(raw, list):
        return ()
    lines = (_text(line, MAX_SUMMARY_LINE_CHARS) for line in raw)
    return tuple(line for line in lines if line)[:MAX_SUMMARY_LINES]


def _says_no_change(lines: tuple[str, ...]) -> bool:
    return all(NO_CHANGE_TEXT.casefold() in line.casefold() for line in lines)


def parse_compare(data: Mapping[str, Any], page: int) -> CompareResult:
    regions = _regions(data.get("changes"), page)
    summary = _summary(data.get("summary"))
    if regions and (not summary or _says_no_change(summary)):
        summary = tuple(region.label for region in regions)
    if not summary and not regions:
        summary = (NO_CHANGE_TEXT,)
    return CompareResult(regions, summary)
