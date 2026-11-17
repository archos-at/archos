#!/usr/bin/env python3


from __future__ import annotations

import argparse
import csv
import hashlib
import re
import sys
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import yaml

DOWN_VERDICTS = {"down", "downvote", "down_vote", "negative", "thumbs_down", "-1"}


def slug(question: str) -> str:
    folded = question.casefold().translate(str.maketrans("äöüß", "aous"))
    words = re.sub(r"[^a-z0-9]+", "-", folded).strip("-").split("-")[:6]
    digest = hashlib.sha256(question.strip().encode("utf-8")).hexdigest()[:6]
    return "-".join([*words, digest]).strip("-")


_FORMULA_LEAD = ("=", "+", "-", "@", "\t", "\r")


def cell(row: dict[str, str], column: str) -> str:
    value = (row.get(column) or "").strip()
    if value.startswith("'") and value[1:].startswith(_FORMULA_LEAD):
        return value[1:]
    return value


def reported_on(row: dict[str, str]) -> str | None:
    stamp = (row.get("voted_at") or row.get("created_at") or "").strip()
    return stamp[:10] or None


def draft_cases(rows: Iterable[dict[str, str]]) -> list[dict[str, Any]]:
    cases: dict[str, dict[str, Any]] = {}
    for row in rows:
        question = cell(row, "question")
        expected = cell(row, "expected_answer")
        if (row.get("verdict") or "").strip().casefold() not in DOWN_VERDICTS or not question or not expected:
            continue
        case_id = slug(question)
        cases.setdefault(
            case_id,
            {
                "id": case_id,
                "question": question,
                "family": None,
                "clause": None,
                "kind": "walkthrough",
                "draft": {
                    "expected_answer": expected,
                    "reason": (row.get("reason") or "").strip() or None,
                    "reported": reported_on(row),
                },
            },
        )
    return list(cases.values())


def render(cases: list[dict[str, Any]]) -> str:
    header = (
        "# DRAFT answer-suite cases from down-voted answers. Not part of the golden set.\n"
        "# `draft.expected_answer` is what the user said the answer should be: a claim.\n"
        "# Verify it against the corpus, then fill `family`, `clause` and `expect` (values read\n"
        "# off the PDF), drop `draft`, add the comment `Source: answer feedback <date>`, and move\n"
        "# the case into tests/fixtures/derivation/loop_eval_questions.yaml.\n"
    )
    return header + yaml.safe_dump({"questions": cases}, allow_unicode=True, sort_keys=False, width=100)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Turn down-voted answers from the feedback CSV export into DRAFT answer-suite cases."
    )
    parser.add_argument("csv", type=Path, help="the feedback export")
    parser.add_argument("--out", type=Path, required=True, help="where to write the draft cases")
    args = parser.parse_args(argv)
    with args.csv.open(encoding="utf-8-sig", newline="") as handle:
        cases = draft_cases(csv.DictReader(handle))
    args.out.write_text(render(cases), encoding="utf-8")
    print(f"{len(cases)} draft case(s) written to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
