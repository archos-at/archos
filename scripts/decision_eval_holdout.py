#!/usr/bin/env python3

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))

from agent.common.decisions import choice  # noqa: E402
from agent.common.decisions import decide_many  # noqa: E402

H = ROOT / "tests" / "fixtures" / "decisions" / "holdout"
T = 0.8


def load(name):
    return yaml.safe_load((H / name).read_text(encoding="utf-8"))


async def tags():
    from agent.knowledge import document_classification as dc

    rows = load("document_tags.yaml")
    states = [{"file_name": r["file_name"], "text": r["text"][:4000]} for r in rows]
    ds = await decide_many(states, dc.tag_questions(), slot="h", timeout=15)
    type_ok = type_sure = tp = fp = fn = 0
    fps = []
    for r, d in zip(rows, ds):
        c, dist = d.choice("type")
        type_ok += c == r["type"]
        type_sure += c == r["type"] and dist.get(c, 0) >= dc.TYPE_THRESHOLD
        want = set(r.get("disciplines") or [])
        got = {
            tag
            for i, tag in enumerate(dc.DISCIPLINE_TAGS)
            if (d.noul(f"discipline_{i}") or 0) >= dc.DISCIPLINE_THRESHOLD
        }
        tp += len(got & want)
        fp += len(got - want)
        fn += len(want - got)
        fps += [(r["file_name"], t) for t in got - want]
    return {
        "rows": len(rows),
        "type_right": type_ok,
        "type_right_at_0.8": type_sure,
        "disc_tp": tp,
        "disc_fp": fp,
        "disc_fn": fn,
        "false_disciplines": fps,
    }


async def doc_class():
    from agent.knowledge import document_classification as dc

    rows = load("doc_class.yaml")
    q = {
        "doc_class": choice(
            dc.DOC_CLASS_QUESTION,
            {k: dc.DOCUMENT_CLASS_CRITERIA[k] for k in dc.DOCUMENT_CLASSES},
        )
    }
    ds = await decide_many(
        [{"file_name": r["file_name"], "text": r["text"][:4000]} for r in rows], q, slot="h", timeout=15
    )
    offered = right = wrong = 0
    bad = []
    for r, d in zip(rows, ds):
        c, dist = d.choice("doc_class")
        if c != "other" and dist.get(c, 0) >= dc.DOC_CLASS_SUGGESTION_THRESHOLD:
            offered += 1
            if c == r["doc_class"]:
                right += 1
            else:
                wrong += 1
                bad.append((r["file_name"], c, r["doc_class"]))
    return {
        "rows": len(rows),
        "non_default": sum(1 for r in rows if r["doc_class"] != "other"),
        "offered": offered,
        "right": right,
        "wrong": wrong,
        "wrong_rows": bad,
    }


async def causes():
    from agent.common import feedback_causes as fc

    rows = load("feedback_causes.yaml")
    labels_state = [
        fc._state(SimpleNamespace(question=r["question"], reason=r["reason"], comment=r["comment"])) for r in rows
    ]
    ds = await decide_many(
        labels_state,
        {
            "cause": choice(
                fc.CAUSE_QUESTION,
                fc.CAUSES,
            )
        },
        slot="h",
        timeout=15,
    )
    right = wrong = unlabelled = 0
    bad = []
    for r, d in zip(rows, ds):
        c, dist = d.choice("cause")
        if dist.get(c, 0) < fc.CAUSE_THRESHOLD:
            unlabelled += 1
            bad.append(("unlabelled", r["cause"], c, round(dist.get(c, 0), 2)))
        elif c == r["cause"]:
            right += 1
        else:
            wrong += 1
            bad.append(("wrong", r["cause"], c, round(dist.get(c, 0), 2)))
    return {"rows": len(rows), "right": right, "wrong": wrong, "unlabelled": unlabelled, "details": bad}


FLOORS = {
    "tags": lambda r: r["type_right_at_0.8"] >= 22 and r["disc_fp"] <= 1,
    "doc_class": lambda r: r["wrong"] == 0 and r["right"] >= 11,
    "causes": lambda r: r["right"] >= 18 and r["wrong"] <= 2,
}


async def main() -> int:
    ok = True
    for name, fn in (
        ("tags", tags),
        ("doc_class", doc_class),
        ("causes", causes),
    ):
        result = await fn()
        held = FLOORS[name](result)
        ok = ok and held
        print(f"{name}: {'ok' if held else 'BELOW FLOOR'}")
        print(json.dumps(result, ensure_ascii=False, default=str))
    return 0 if ok else 1


if __name__ == "__main__":
    os.environ.setdefault("OPENROUTER_API_KEY", os.environ.get("OPENROUTER_KEY", ""))
    sys.exit(asyncio.run(main()))
