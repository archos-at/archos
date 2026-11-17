#!/usr/bin/env python3

from __future__ import annotations

import argparse
import asyncio
import base64
import io
import os
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts" / "turn_census"))

from render_fixture_drawings import load_spec  # noqa: E402
from render_fixture_drawings import render_page  # noqa: E402

from agent.common.openrouter import PLATFORM_FIXED  # noqa: E402
from agent.common.openrouter import limited_async_http_client  # noqa: E402

MODEL = "typesafe/jev-1.14"
URL = "https://openrouter.ai/api/alpha/decisions"
IMAGE_HEADER = {"TypeSafe-Danger-Zone-Images": "true"}
MAX_SIDE = 1568
RENDER_DPI = 100

PAGE_KIND = {
    "drawing": "A technical drawing: floor plan, section, elevation, site plan or detail",
    "text": "A page of running text: a letter, a specification, a report",
    "table": "A page that is mostly a table or schedule",
    "photo": "A photograph of a building or site",
    "form": "A filled-in form",
}
VIEWS = {
    "floor_plan": "Floor plan (Grundriss)",
    "section": "Section (Schnitt)",
    "elevation": "Elevation (Ansicht)",
    "site_plan": "Site plan (Lageplan)",
    "detail": "Detail",
    "none": "No drawing",
}
QUESTIONS: dict[str, dict[str, Any]] = {
    "page_kind": {
        "type": "choice",
        "instructions": "What kind of page of an architect's project document is this image?",
        "criteria": PAGE_KIND,
    },
    "view": {
        "type": "choice",
        "instructions": "Which kind of architectural view is the main drawing on this sheet?",
        "criteria": VIEWS,
    },
    "title_block": {
        "type": "box",
        "instructions": (
            "The title block (Plankopf): the framed area with the project name, drawing number, scale, "
            "index or revision and date. Often a box or strip along the right or bottom edge."
        ),
    },
    "plan_area": {
        "type": "box",
        "instructions": "The main drawing itself (the plan or section), without the title block and the legend.",
    },
}

FIXTURE_VIEW = {"Grundrisse": "floor_plan", "Schnitt": "section"}

FLOOR_TITLE_COVERAGE = 0.9
FLOOR_TITLE_IOU = 0.6
DRAWING_INK = ("room", "door")


def _image_url(image: Any) -> str:
    image = image.convert("L")
    image.thumbnail((MAX_SIDE, MAX_SIDE))
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


def ask(image: Any, key: str) -> tuple[dict[str, Any], float, float | None]:
    return asyncio.run(_ask(image, key))


async def _ask(image: Any, key: str) -> tuple[dict[str, Any], float, float | None]:
    body = PLATFORM_FIXED.apply(
        {
            "model": MODEL,
            "state": [{"type": "image_url", "image_url": {"url": _image_url(image)}}],
            "questions": QUESTIONS,
        }
    )
    started = time.monotonic()
    async with limited_async_http_client(timeout=60) as client:
        response = await client.post(URL, json=body, headers={"Authorization": f"Bearer {key}", **IMAGE_HEADER})
    elapsed = time.monotonic() - started
    response.raise_for_status()
    payload = response.json()
    return payload["answers"], elapsed, (payload.get("usage") or {}).get("cost")


def as_edges(box: list[float]) -> tuple[float, float, float, float]:
    x, y, w, h = box
    return x, y, x + w, y + h


def answer_edges(answer: dict[str, Any]) -> tuple[float, float, float, float]:
    box = answer["box"]
    return box["left"], box["top"], box["right"], box["bottom"]


def overlap(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    width = min(a[2], b[2]) - max(a[0], b[0])
    height = min(a[3], b[3]) - max(a[1], b[1])
    return max(0.0, width) * max(0.0, height)


def area(edges: tuple[float, ...]) -> float:
    return max(0.0, edges[2] - edges[0]) * max(0.0, edges[3] - edges[1])


def iou(answer: tuple[float, ...], gold: tuple[float, ...]) -> float:
    shared = overlap(answer, gold)
    union = area(answer) + area(gold) - shared
    return shared / union if union else 0.0


def coverage(answer: tuple[float, ...], gold: tuple[float, ...]) -> float:
    return overlap(answer, gold) / area(gold) if area(gold) else 0.0


def gold_box(page: dict[str, Any], *kinds: str) -> tuple[float, float, float, float] | None:
    boxes = [as_edges(element["box"]) for element in page["elements"] if element.get("kind") in kinds]
    if not boxes:
        return None
    return min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)


def expected_view(file_name: str) -> str | None:
    return next((view for word, view in FIXTURE_VIEW.items() if word in file_name), None)


def grade_page(answers: dict[str, Any], page: dict[str, Any], file_name: str) -> list[str]:
    misses = []
    kind = answers["page_kind"]["choice"]
    view = answers["view"]["choice"]
    if kind != "drawing":
        misses.append(f"page kind {kind}")
    if view != expected_view(file_name):
        misses.append(f"view {view}")
    title, plan = gold_box(page, "title_block"), gold_box(page, *DRAWING_INK)
    title_answer, plan_answer = answer_edges(answers["title_block"]), answer_edges(answers["plan_area"])
    print(
        f"    kind={kind} view={view}"
        f" title iou={iou(title_answer, title):.2f} cover={coverage(title_answer, title):.2f}"
        f" conf={answers['title_block'].get('confidence', 0):.2f}"
        f" plan iou={iou(plan_answer, plan):.2f} cover={coverage(plan_answer, plan):.2f}"
    )
    if coverage(title_answer, title) < FLOOR_TITLE_COVERAGE or iou(title_answer, title) < FLOOR_TITLE_IOU:
        misses.append("title block")
    return misses


def eval_fixtures(key: str) -> bool:
    spec = load_spec()
    misses: list[str] = []
    for drawing in spec["drawings"]:
        for page in drawing["pages"]:
            answers, seconds, cost = ask(render_page(spec, drawing, page, dpi=RENDER_DPI), key)
            print(f"{drawing['file_name']} p.{page['number']}: {seconds:.2f} s, ${cost}")
            where = f"{drawing['file_name']} p.{page['number']}"
            misses += [f"{where}: {miss}" for miss in grade_page(answers, page, drawing["file_name"])]
    for miss in misses:
        print("MISS", miss)
    return not misses


def show_sheets(directory: Path, key: str) -> None:
    from PIL import Image

    for path in sorted([*directory.glob("*.png"), *directory.glob("*.jpg")]):
        answers, seconds, cost = ask(Image.open(path), key)
        title, plan = answers["title_block"]["box"], answers["plan_area"]["box"]
        print(f"{path.name}: {seconds:.2f} s, ${cost}")
        print(f"    kind={answers['page_kind']['choice']} view={answers['view']['choice']}")
        print(f"    title block {title}  plan {plan}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Decision eval for reading a page image: Jev 1.14's image input as an ingest page reader."
    )
    parser.add_argument("--sheets", type=Path, help="a directory of real sheet images, answered ungraded")
    args = parser.parse_args()
    key = os.environ.get("DECISIONS_API_KEY") or os.environ.get("OPENROUTER_API_KEY")
    if not key:
        print("No OPENROUTER_API_KEY / DECISIONS_API_KEY: nothing to ask.")
        return 2
    held = eval_fixtures(key)
    if args.sheets:
        show_sheets(args.sheets, key)
    print("floors hold" if held else "floors MISSED")
    return 0 if held else 1


if __name__ == "__main__":
    sys.exit(main())
