#!/usr/bin/env python3

from __future__ import annotations

import os
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from agent.knowledge import document_classification as dc  # noqa: E402

FIXTURES = ROOT / "tests" / "fixtures" / "decisions"


def eval_tags() -> bool:
    rows = yaml.safe_load((FIXTURES / "document_tags.yaml").read_text(encoding="utf-8"))
    types_right = discipline_hits = discipline_false = labelled = 0
    for row in rows:
        tags = dc.decide_document_tags(row["text"], row["file_name"]) or []
        got = set(tags) & set(dc.DISCIPLINE_TAGS)
        want = set(row["disciplines"])
        types_right += bool(set(tags) & set(row["types"]))
        discipline_hits += len(got & want)
        discipline_false += len(got - want)
        labelled += len(want)
        print(f"  {row['file_name']:34s} {tags}")
    print(f"tags: types {types_right}/{len(rows)}, disciplines {discipline_hits}/{labelled}, false {discipline_false}")
    return types_right == len(rows) and discipline_false == 0


def eval_doc_class() -> bool:
    rows = yaml.safe_load((FIXTURES / "doc_class.yaml").read_text(encoding="utf-8"))
    offered = wrong = 0
    for row in rows:
        suggestion = dc.suggest_doc_class(row["text"], row["file_name"])
        offered += suggestion is not None
        wrong += suggestion is not None and suggestion != row["doc_class"]
        print(f"  {row['file_name']:30s} want={row['doc_class']:16s} offered={suggestion}")
    expected = sum(1 for row in rows if row["doc_class"] != dc.DEFAULT_DOC_CLASS)
    print(f"doc_class: offered {offered}/{expected} non-default rows, {wrong} wrong")
    return wrong == 0


def eval_feedback_causes() -> bool:
    import asyncio
    from types import SimpleNamespace

    from agent.common import feedback_causes

    rows = yaml.safe_load((FIXTURES / "feedback_causes.yaml").read_text(encoding="utf-8"))
    samples = [SimpleNamespace(question=r["question"], reason=r["reason"], comment=r["comment"]) for r in rows]
    labels = asyncio.run(feedback_causes.label_causes(samples))
    right = sum(1 for row, label in zip(rows, labels) if label == row["cause"])
    for row, label in zip(rows, labels):
        print(f"  want={row['cause']:14s} got={label}")
    print(f"feedback causes: {right}/{len(rows)}")
    return right >= len(rows) - 2


def main() -> int:
    os.environ.setdefault("OPENROUTER_API_KEY", os.environ.get("OPENROUTER_KEY", ""))
    ok = eval_tags()
    ok = eval_doc_class() and ok
    ok = eval_feedback_causes() and ok
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
