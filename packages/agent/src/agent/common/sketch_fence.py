from __future__ import annotations

import json
import math
import re
from collections import Counter
from dataclasses import dataclass
from dataclasses import field
from dataclasses import replace
from typing import Any

SKETCH_FENCE_INFO = "excalidraw"
REFUSED_SKETCH_FENCE_INFO = "excalidraw-refused"

MAX_SKETCH_SOURCE_BYTES = 32 * 1024
MAX_SKETCH_ELEMENTS = 150
MAX_SKETCH_COORDINATE = 10_000
MAX_SKETCH_TEXT_CHARS = 500
MAX_SKETCH_POINTS = 200
MAX_SKETCH_TITLE_CHARS = 120

SKETCH_ELEMENT_TYPES: tuple[str, ...] = ("rectangle", "ellipse", "diamond", "text", "arrow", "line", "frame")

SKETCH_REFUSALS: tuple[str, ...] = (
    "too-large",
    "malformed-json",
    "not-a-scene",
    "empty",
    "too-many-elements",
    "unsupported-element",
    "bad-coordinate",
    "missing-text",
    "text-too-long",
    "bad-points",
    "duplicate-id",
    "dangling-binding",
)

_DIMENSION = re.compile(r"\d(?:[.,]\d+)?\s*(?:mm|cm|dm|km|m²|m2|m³|m)(?![a-zäöüß])", re.IGNORECASE)


@dataclass(frozen=True)
class SketchCheck:
    refusal: str | None = None
    unescaped: bool = False
    elements: int = 0
    kinds: dict[str, int] = field(default_factory=dict)
    dimension_labels: int = 0

    @property
    def drawn(self) -> bool:
        return self.refusal is None


class _Refused(Exception):
    def __init__(self, refusal: str) -> None:
        super().__init__(refusal)
        self.refusal = refusal


def _number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _coordinate(value: Any, *, required: bool) -> None:
    if value is None and not required:
        return
    if not _number(value) or abs(value) > MAX_SKETCH_COORDINATE:
        raise _Refused("bad-coordinate")


def _text(value: Any, *, required: bool) -> str:
    if value is None and not required:
        return ""
    if not isinstance(value, str) or not value.strip():
        raise _Refused("missing-text")
    if len(value) > MAX_SKETCH_TEXT_CHARS:
        raise _Refused("text-too-long")
    return value


def _elements(scene: Any) -> list[Any]:
    if isinstance(scene, dict):
        title = scene.get("title")
        if title is not None and (not isinstance(title, str) or len(title) > MAX_SKETCH_TITLE_CHARS):
            raise _Refused("not-a-scene")
        scene = scene.get("elements")
    if not isinstance(scene, list):
        raise _Refused("not-a-scene")
    if not scene:
        raise _Refused("empty")
    if len(scene) > MAX_SKETCH_ELEMENTS:
        raise _Refused("too-many-elements")
    return scene


def _points(value: Any) -> None:
    if value is None:
        return
    if not isinstance(value, list) or not 2 <= len(value) <= MAX_SKETCH_POINTS:
        raise _Refused("bad-points")
    for point in value:
        if not isinstance(point, list) or len(point) != 2:
            raise _Refused("bad-points")
        _coordinate(point[0], required=True)
        _coordinate(point[1], required=True)


def _element_texts(element: dict[str, Any]) -> list[str]:
    kind = element.get("type")
    if kind not in SKETCH_ELEMENT_TYPES:
        raise _Refused("unsupported-element")
    if kind == "frame":
        if not isinstance(element.get("children"), list):
            raise _Refused("not-a-scene")
        return [_text(element.get("name"), required=False)]
    _coordinate(element.get("x"), required=True)
    _coordinate(element.get("y"), required=True)
    _coordinate(element.get("width"), required=False)
    _coordinate(element.get("height"), required=False)
    if kind == "text":
        return [_text(element.get("text"), required=True)]
    if kind in ("arrow", "line"):
        _points(element.get("points"))
    label = element.get("label")
    if label is None:
        return []
    if not isinstance(label, dict):
        raise _Refused("missing-text")
    return [_text(label.get("text"), required=True)]


def _references(element: dict[str, Any]) -> list[Any]:
    if element.get("type") == "frame":
        return list(element["children"])
    ends = [element.get(end) for end in ("start", "end") if element.get(end) is not None]
    if any(not isinstance(end, dict) for end in ends):
        raise _Refused("dangling-binding")
    return [end.get("id") for end in ends]


def _checked(scene: Any) -> SketchCheck:
    elements = _elements(scene)
    if any(not isinstance(element, dict) for element in elements):
        raise _Refused("not-a-scene")
    texts = [text for element in elements for text in _element_texts(element)]
    ids = [element["id"] for element in elements if "id" in element]
    if any(not isinstance(id_, str) or not id_ for id_ in ids) or len(set(ids)) != len(ids):
        raise _Refused("duplicate-id")
    known = set(ids)
    if any(not isinstance(ref, str) or ref not in known for element in elements for ref in _references(element)):
        raise _Refused("dangling-binding")
    return SketchCheck(
        elements=len(elements),
        kinds=dict(Counter(element["type"] for element in elements)),
        dimension_labels=sum(1 for text in texts if _DIMENSION.search(text)),
    )


_OVER_ESCAPED = re.compile(r'^\s*[\[{][\s\[{]*\\"')
_ESCAPE = re.compile(r'\\(["\\/bfnrt])')
_UNESCAPED = {'"': '"', "\\": "\\", "/": "/", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


def _unescaped_once(body: str) -> str:
    return _ESCAPE.sub(lambda match: _UNESCAPED[match.group(1)], body)


def _not_json(token: str) -> Any:
    raise ValueError(f"{token} is not JSON")


def check_sketch(body: str) -> SketchCheck:
    if len(body.encode("utf-8")) > MAX_SKETCH_SOURCE_BYTES:
        return SketchCheck(refusal="too-large")
    unescaped = bool(_OVER_ESCAPED.match(body))
    try:
        scene = json.loads(_unescaped_once(body) if unescaped else body, parse_constant=_not_json)
    except ValueError:
        return SketchCheck(refusal="malformed-json")
    try:
        return replace(_checked(scene), unescaped=unescaped)
    except _Refused as refused:
        return SketchCheck(refusal=refused.refusal)


def is_sketch_fence(info: str) -> bool:
    words = info.strip().split()
    return bool(words) and words[0].lower() == SKETCH_FENCE_INFO


def refused_fence_info(info: str) -> str:
    leading = info[: len(info) - len(info.lstrip())]
    rest = info.strip()[len(SKETCH_FENCE_INFO) :]
    return f"{leading}{REFUSED_SKETCH_FENCE_INFO}{rest}"


def sketch_census(checks: list[SketchCheck]) -> dict[str, Any]:
    return {
        "drawn": sum(1 for check in checks if check.drawn),
        "refused": dict(Counter(check.refusal for check in checks if check.refusal)),
        "unescaped": sum(1 for check in checks if check.unescaped),
        "elements": sum(check.elements for check in checks),
        "kinds": dict(sum((Counter(check.kinds) for check in checks), Counter())),
        "dimension_labels": sum(check.dimension_labels for check in checks),
    }
