from __future__ import annotations

import statistics
from pathlib import Path
from typing import Any

from files_eval import _basename
from files_eval import files_checks
from fixture_bff import ROOT
from render_fixture_drawings import load_spec
from workspace_eval import Judge
from workspace_eval import load_questions as load_rows

QUESTIONS = ROOT / "tests" / "fixtures" / "visual" / "visual_questions.yaml"
LOOK_TOOLS = frozenset({"look", "canvas__look", "view_knowledge_image"})
COVERAGE_MIN = 0.8
BOXES = ("found", "given")
CATEGORIES = ("dimension", "count", "plankopf", "legend", "fassung", "skip")
CARD_MODELS = ROOT / "packages" / "agent" / "src" / "agent" / "cards" / "look_card.py"
WIRE_MODELS = ROOT / "packages" / "agent" / "src" / "agent" / "common" / "wire_v2.py"

Box = tuple[float, float, float, float]
WHOLE_PAGE: Box = (0.0, 0.0, 1.0, 1.0)


def _elements(spec: dict[str, Any]) -> dict[tuple[str, int, str], list[float]]:
    return {
        (drawing["file_name"], page["number"], element["id"]): element["box"]
        for drawing in spec["drawings"]
        for page in drawing["pages"]
        for element in page["elements"]
    }


def resolve_gold(row: dict, elements: dict[tuple[str, int, str], list[float]]) -> list[dict[str, Any]]:
    raw = row.get("gold") or []
    golds = []
    for item in raw if isinstance(raw, list) else [raw]:
        key = (str(item["document"]), int(item["page"]), str(item["element"]))
        if key not in elements:
            raise ValueError(f"{row['id']}: gold {key} is not an element of drawings.json")
        golds.append({**item, "page": int(item["page"]), "box": tuple(elements[key])})
    return golds


def load_questions(path: Path = QUESTIONS, spec: dict[str, Any] | None = None) -> list[dict]:
    elements = _elements(spec or load_spec())
    rows = []
    for row in load_rows(path):
        if row.get("box", "found") not in BOXES:
            raise ValueError(f"{row['id']}: box must be one of {', '.join(BOXES)}")
        if row.get("box") == "given":
            raise ValueError(
                f"{row['id']}: box: given sends a drawn region on the turn, "
                "which only the north-star set does (`turn_input.py`)"
            )
        rows.append({**row, "set": "visual", "gold": resolve_gold(row, elements)})
    return rows


def area(box: Box) -> float:
    return max(0.0, box[2]) * max(0.0, box[3])


def intersection(a: Box, b: Box) -> float:
    width = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
    height = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
    return max(0.0, width) * max(0.0, height)


def iou(a: Box, b: Box) -> float:
    shared = intersection(a, b)
    union = area(a) + area(b) - shared
    return shared / union if union > 0 else 0.0


def coverage(look: Box, gold: Box) -> float:
    return intersection(look, gold) / area(gold) if area(gold) > 0 else 0.0


def is_look(name: str) -> bool:
    return name in LOOK_TOOLS or _basename(name) in LOOK_TOOLS


def with_look_names(calls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{**call, "name": "look"} if is_look(call["name"]) else call for call in calls]


def _region(value: Any) -> Box:
    try:
        x, y, w, h = (float(part) for part in value)
    except TypeError, ValueError:
        return WHOLE_PAGE
    return (x, y, w, h)


def looks_of(calls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    found = []
    for call in calls:
        if not is_look(call["name"]):
            continue
        arguments = call.get("arguments") or {}
        page = arguments.get("page", arguments.get("page_number", 1))
        found.append(
            {
                "document": str(arguments.get("document") or arguments.get("file_name") or ""),
                "page": int(page) if str(page).isdigit() else 1,
                "box": _region(arguments.get("region")),
            }
        )
    return found


def _stem(name: str) -> str:
    folded = name.strip().casefold()
    return folded[:-4] if folded.endswith(".pdf") else folded


def same_document(wanted: str, given: str) -> bool:
    wanted, given = _stem(wanted), _stem(given)
    return bool(given) and (given == wanted or given in wanted)


def gold_scores(looks: list[dict[str, Any]], golds: list[dict[str, Any]]) -> list[dict[str, float]]:
    scores = []
    for gold in golds:
        there = [
            look["box"]
            for look in looks
            if same_document(gold["document"], look["document"]) and look["page"] == gold["page"]
        ]
        scores.append(
            {
                "iou": max((iou(box, gold["box"]) for box in there), default=0.0),
                "coverage": max((coverage(box, gold["box"]) for box in there), default=0.0),
            }
        )
    return scores


def parity_available() -> bool:
    try:
        return 'type: Literal["look"]' in CARD_MODELS.read_text(encoding="utf-8") and (
            'kind: Literal["look"]' in WIRE_MODELS.read_text(encoding="utf-8")
        )
    except OSError:
        return False


def look_parity(n_looks: int, cards: list[Any], available: bool | None = None) -> dict[str, bool | None]:
    available = parity_available() if available is None else available
    if not available:
        return {"card": None, "step": None}
    items = sum(
        len(card.get("items") or [None]) for card in cards if isinstance(card, dict) and card.get("type") == "look"
    )
    return {"card": items >= n_looks, "step": None}


def visual_checks(
    expect: dict[str, Any],
    calls: list[dict[str, Any]],
    gold: list[dict[str, Any]],
    answer: str,
    question: str,
    judge: Judge | None,
    signals: list[str],
    research_calls: int,
    look_on: bool = True,
) -> dict[str, bool]:
    named = with_look_names(calls)
    tools = dict(expect.get("tools") or {})
    if not look_on:
        tools["must"] = [item for item in tools.get("must") or [] if item != "look"]
    checks = files_checks({**expect, "tools": tools}, named, answer, question, judge, signals, research_calls)
    if gold and look_on:
        checks["gold_covered"] = all(s["coverage"] >= COVERAGE_MIN for s in gold_scores(looks_of(calls), gold))
    return checks


def _row_cells(rows: list[Any], gold: list[dict[str, Any]], available: bool) -> tuple[str, str, str, str]:
    counts = [len(looks_of(r.tool_args)) for r in rows]
    scored = [gold_scores(looks_of(r.tool_args), gold) for r in rows] if gold else []
    best = [statistics.fmean(s["iou"] for s in score) for score in scored]
    held = sum(all(s["coverage"] >= COVERAGE_MIN for s in score) for score in scored)
    parity = [look_parity(n, (r.envelope or {}).get("cards") or [], available)["card"] for n, r in zip(counts, rows)]
    parity_cell = "n/a" if all(p is None for p in parity) else f"{sum(bool(p) for p in parity)}/{len(parity)}"
    return (
        f"{statistics.median(counts):g}",
        f"{statistics.fmean(best):.2f}" if best else "-",
        f"{held}/{len(scored)}" if scored else "-",
        parity_cell,
    )


def report_lines(runs: list[Any], meta: dict[str, Any] | None = None) -> list[str]:
    meta = meta or {}
    ok = [run for run in runs if not run.error]
    head = [f"## Visual eval (looking: {meta.get('look') or 'on'})", ""]
    if not ok:
        return [*head, "No run finished."]
    rows = {row["id"]: row for row in load_questions()}
    available = parity_available()
    held = [all(run.checks.values()) for run in ok if run.checks]
    skip_ids = {i for i, row in rows.items() if row.get("category") == "skip"}
    per_run = [len(looks_of(run.tool_args)) for run in ok]
    skip_looks = sum(1 for run, n in zip(ok, per_run) if run.question_id in skip_ids and n)
    gold_runs = [(run, rows[run.question_id]["gold"]) for run in ok if rows.get(run.question_id, {}).get("gold")]
    ious = [statistics.fmean(s["iou"] for s in gold_scores(looks_of(run.tool_args), gold)) for run, gold in gold_runs]
    median = statistics.median
    lines = [
        *head,
        f"- runs where every check held: {sum(held)}/{len(held)} ({sum(held) / max(1, len(held)):.0%})",
        f"- looks per run: median {median(per_run):g}, mean {sum(per_run) / len(per_run):.2f}, "
        f"runs that looked {sum(1 for n in per_run if n)}/{len(per_run)}",
        f"- skip controls that looked anyway: {skip_looks} of {sum(1 for r in ok if r.question_id in skip_ids)} run(s)",
        f"- best IoU against the gold box, mean over runs with a gold: {statistics.fmean(ious):.2f}"
        if ious
        else "- best IoU against the gold box: no run with a gold",
        "- every look reached a card item and a step: "
        + ("n/a (the look card and step arrive with V3)" if not available else "see the table"),
        f"- rounds, median: {median([r.research_calls for r in ok]):g}; input tokens per run, median: "
        f"{median([r.input_tokens for r in ok]):g}; output {median([r.output_tokens for r in ok]):g}; "
        f"wall seconds {median([r.wall_s for r in ok]):g}",
        "",
        "| row | category | passed | looks | IoU | covered | card/step | seconds |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for question_id in dict.fromkeys(run.question_id for run in ok):
        mine = [run for run in ok if run.question_id == question_id]
        row = rows.get(question_id, {})
        passed = sum(all(r.checks.values()) for r in mine if r.checks)
        n, best, covered, parity = _row_cells(mine, row.get("gold") or [], available)
        lines.append(
            f"| {question_id} | {row.get('category', '')} | {passed}/{len(mine)} | {n} | {best} | {covered} | "
            f"{parity} | {median([r.wall_s for r in mine]):g} |"
        )
    return [*lines, ""]
