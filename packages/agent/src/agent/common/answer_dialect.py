from __future__ import annotations

import logging
import re
from collections import Counter
from collections.abc import Mapping
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
from typing import Any

from .sketch_fence import SketchCheck
from .sketch_fence import check_sketch
from .sketch_fence import is_sketch_fence
from .sketch_fence import refused_fence_info
from .sketch_fence import sketch_census

logger = logging.getLogger(__name__)

DIRECTIVE_BLOCKS: tuple[str, ...] = (
    "check",
    "procedure",
    "cases",
    "metrics",
    "compare",
    "details",
    "actions",
    "not-found",
    "subsumption",
)

PRIMARY_BLOCKS: frozenset[str] = frozenset(DIRECTIVE_BLOCKS) - {"details"}

DIRECTIVE_MARKERS: dict[str, str] = {"current": "aktuell", "applies": "trifft zu", "recommended": "empfohlen"}

MARKER_PARENTS: dict[str, str] = {"current": "procedure", "applies": "cases", "recommended": "compare"}

PROJECT_DIRECTIVE = "project"

PROJECT_KEYS: dict[str, str] = {
    "building_class": "building_class",
    "escape_level_m": "escape_level_m",
    "use": "uses",
    "state": "federal_state",
    "storeys": "storeys_above_ground",
    "gross_floor_area_m2": "gfa_above_ground",
}

BUDGET: dict[str, tuple[int, int]] = {
    "direct": (0, 0),
    "handoff": (0, 0),
    "ruling": (1, 0),
    "walkthrough": (2, 1),
    "work": (1, 0),
}

MAX_DIRECTIVE_DEPTH = 4
MAX_DIRECTIVE_BLOCKS = 64

_FENCE_OPEN = re.compile(r"^[ \t]*(`{3,}|~{3,})(.*)$")
_FENCE_CLOSE = re.compile(r"^[ \t]*(`{3,}|~{3,})[ \t]*$")
_OPENER = re.compile(r"^([ \t]*)(:{3,})[ \t]*([A-Za-z][\w-]*)(.*)$", re.ASCII)
_CLOSER = re.compile(r"^([ \t]*)(:{3,})[ \t]*$")
_TEXT_DIRECTIVE = re.compile(r"(^|[^\w:\\])(:)([A-Za-z][\w-]*)(?:\[([^\]\n]*)\])?(?:\{[^}\n]*\})?", re.ASCII)
_LABEL = re.compile(r"^\[([^\]]*)\]")
_ATTRS = re.compile(r"\{([^}\n]*)\}")
_INLINE_CODE = re.compile(r"(`[^`]*`)")


@dataclass
class _Block:
    name: str
    open: int
    close: int | None
    label: str
    attrs: str
    parent: int | None
    bounded: bool = False


def _code_fence(line: str) -> str | None:
    match = _FENCE_OPEN.match(line)
    if not match:
        return None
    marker = match.group(1)
    if marker[0] == "`" and "`" in match.group(2):
        return None
    return marker


def _closes(line: str, fence: str) -> bool:
    match = _FENCE_CLOSE.match(line)
    return bool(match) and match.group(1)[0] == fence[0] and len(match.group(1)) >= len(fence)


def _label(rest: str) -> str:
    stripped = rest.strip()
    label = _LABEL.match(stripped)
    if label:
        return label.group(1).strip()
    return stripped if stripped and stripped[0] not in "{[" and rest[:1].isspace() else ""


@dataclass
class DialectResult:
    text: str
    census: dict[str, int] = field(default_factory=dict)
    repairs: list[dict[str, str]] = field(default_factory=list)
    sketches: list[SketchCheck] = field(default_factory=list)

    def as_trace(self) -> dict[str, Any]:
        trace: dict[str, Any] = {
            "blocks": dict(self.census),
            "repairs": dict(Counter(repair["repair"] for repair in self.repairs)),
        }
        if self.sketches:
            trace["sketches"] = sketch_census(self.sketches)
        return trace


@dataclass
class _Sketch:
    open: int
    body: list[str] = field(default_factory=list)


def _scan(lines: Sequence[str]) -> tuple[list[_Block], list[bool], int, list[_Sketch]]:
    blocks: list[_Block] = []
    stack: list[int] = []
    code = [False] * len(lines)
    fence: str | None = None
    diagrams = 0
    sketches: list[_Sketch] = []
    sketch: _Sketch | None = None
    for index, line in enumerate(lines):
        if fence is not None:
            code[index] = True
            if _closes(line, fence):
                fence, sketch = None, None
            elif sketch is not None:
                sketch.body.append(line)
            continue
        opened = _code_fence(line)
        if opened:
            fence = opened
            code[index] = True
            info = _FENCE_OPEN.match(line).group(2)  # type: ignore[union-attr]
            if is_sketch_fence(info):
                sketch = _Sketch(index)
                sketches.append(sketch)
            diagrams += info.strip().lower().startswith("mermaid") or sketch is not None
            continue
        opener = _OPENER.match(line)
        if opener:
            rest = opener.group(4)
            attrs = _ATTRS.search(rest)
            kept = sum(1 for at in stack if not blocks[at].bounded)
            bounded = (
                kept >= MAX_DIRECTIVE_DEPTH or sum(1 for block in blocks if not block.bounded) >= MAX_DIRECTIVE_BLOCKS
            )
            blocks.append(
                _Block(
                    name=opener.group(3),
                    open=index,
                    close=None,
                    label=_label(rest),
                    attrs=attrs.group(1) if attrs else "",
                    parent=stack[-1] if stack else None,
                    bounded=bounded,
                )
            )
            stack.append(len(blocks) - 1)
            continue
        if _CLOSER.match(line) and stack:
            blocks[stack.pop()].close = index
    return blocks, code, diagrams, sketches


def _refused_sketches(
    lines: list[str], sketches: Sequence[_Sketch], repairs: list[dict[str, str]]
) -> list[SketchCheck]:
    checks: list[SketchCheck] = []
    for sketch in sketches:
        check = check_sketch("\n".join(sketch.body))
        checks.append(check)
        if check.refusal is None:
            continue
        repairs.append({"repair": "sketch_refused", "name": check.refusal})
        opener = _FENCE_OPEN.match(lines[sketch.open])
        marker_end = opener.end(1)  # type: ignore[union-attr]
        lines[sketch.open] = lines[sketch.open][:marker_end] + refused_fence_info(opener.group(2))  # type: ignore[union-attr]
    return checks


def _unwrap_set(blocks: Sequence[_Block], kind: str | None, repairs: list[dict[str, str]]) -> set[int]:
    unwrap: set[int] = set()
    for index, block in enumerate(blocks):
        if block.bounded:
            unwrap.add(index)
            repairs.append({"repair": "unwrap_too_deep", "name": block.name})
        elif block.name not in DIRECTIVE_BLOCKS:
            unwrap.add(index)
            repairs.append({"repair": "unwrap_unknown", "name": block.name})
    budget = BUDGET.get(kind or "")
    if budget is None:
        return unwrap
    allowed = budget[0]
    kept = 0
    for index, block in enumerate(blocks):
        if index in unwrap:
            continue
        if allowed == 0 or block.name in PRIMARY_BLOCKS:
            if allowed and kept < allowed:
                kept += 1
                continue
            unwrap.add(index)
            repairs.append({"repair": "unwrap_over_budget", "name": block.name})
    return unwrap


def _enclosing(blocks: Sequence[_Block], unwrap: set[int], line_count: int) -> list[frozenset[str]]:
    inside: list[set[str]] = [set() for _ in range(line_count)]
    for index, block in enumerate(blocks):
        if index in unwrap:
            continue
        end = block.close if block.close is not None else line_count
        for line in range(block.open + 1, end):
            inside[line].add(block.name)
    return [frozenset(names) for names in inside]


def _inline(line: str, around: frozenset[str], repairs: list[dict[str, str]]) -> str:

    def substitute(match: re.Match[str]) -> str:
        before, name, label = match.group(1), match.group(3), match.group(4)
        if name == PROJECT_DIRECTIVE and label is not None:
            if label.strip() in PROJECT_KEYS:
                return match.group(0)
            repairs.append({"repair": "project_key_unknown", "name": label.strip()})
            return f"{before}{label}"
        if name in DIRECTIVE_MARKERS and label is None:
            if MARKER_PARENTS[name] not in around:
                repairs.append({"repair": "strip_marker", "name": name})
                return "" if before.isspace() else before
            if name == "current":
                repairs.append({"repair": "current_unverified", "name": name})
        return match.group(0)

    if ":" not in line:
        return line
    parts = _INLINE_CODE.split(line)
    return "".join(part if index % 2 else _TEXT_DIRECTIVE.sub(substitute, part) for index, part in enumerate(parts))


def _cases_keys(blocks: Sequence[_Block], unwrap: set[int], repairs: list[dict[str, str]]) -> None:
    for index, block in enumerate(blocks):
        if index in unwrap or block.name != "cases" or not block.attrs:
            continue
        by = re.search(r"\bby\s*=\s*\"?([\w-]+)", block.attrs)
        if by and by.group(1) not in PROJECT_KEYS:
            repairs.append({"repair": "cases_by_unknown", "name": by.group(1)})


def validate_dialect(text: str, kind: str | None) -> DialectResult:
    if ":" not in text and "```" not in text and "~~~" not in text:
        return DialectResult(text)
    lines = text.split("\n")
    blocks, code, diagrams, sketch_fences = _scan(lines)
    census = dict(Counter(block.name for block in blocks))
    if diagrams:
        census["diagrams"] = diagrams
    repairs: list[dict[str, str]] = []
    sketches = _refused_sketches(lines, sketch_fences, repairs)
    unwrap = _unwrap_set(blocks, kind, repairs)
    budget = BUDGET.get(kind or "")
    if budget is not None and diagrams > budget[1]:
        repairs.append({"repair": "diagrams_over_budget", "name": "excalidraw" if sketches else "mermaid"})
    _cases_keys(blocks, unwrap, repairs)
    around = _enclosing(blocks, unwrap, len(lines))
    replaced: dict[int, list[str]] = {}
    for index, block in enumerate(blocks):
        if index in unwrap:
            continue
        canonical = _canonical_opener(lines[block.open], block)
        if canonical != lines[block.open]:
            replaced[block.open] = [canonical]
            repairs.append({"repair": "opener_canonical", "name": block.name})
    for index in unwrap:
        block = blocks[index]
        indent = _OPENER.match(lines[block.open]).group(1)  # type: ignore[union-attr]
        replaced[block.open] = [f"{indent}**{block.label}**", ""] if block.label else []
        if block.close is not None:
            replaced[block.close] = []
    out: list[str] = []
    dropped = False
    for index, line in enumerate(lines):
        if index in replaced:
            out.extend(replaced[index])
            dropped = not replaced[index]
            continue
        if dropped and not line.strip() and out and not out[-1].strip():
            dropped = False
            continue
        dropped = False
        out.append(line if code[index] else _inline(line, around[index], repairs))
    result = "\n".join(out)
    if repairs:
        logger.info("Answer dialect: %d repair(s) %s; blocks %s", len(repairs), _summary(repairs), census)
    return DialectResult(result, census, repairs, sketches)


def _canonical_opener(line: str, block: _Block) -> str:
    opener = _OPENER.match(line)
    if opener is None:
        return line
    rest = opener.group(4)
    stripped = rest.strip()
    if stripped and stripped[0] not in "{[" and rest[:1].isspace():
        rest = f"[{block.label.replace('[', '').replace(']', '')}]"
    return f"{opener.group(1)}{opener.group(2)}{block.name}{rest}"


def _summary(repairs: Sequence[Mapping[str, str]]) -> str:
    return ", ".join(f"{repair['repair']}:{repair['name']}" for repair in repairs)
