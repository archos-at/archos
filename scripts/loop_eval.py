#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from scripts.loop_eval_rows import Observation
    from scripts.loop_eval_rows import Question

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

DEFAULT_QUESTIONS = REPO_ROOT / "tests" / "fixtures" / "derivation" / "loop_eval_questions.yaml"

BASE_URL_ENV = "LOOP_EVAL_URL"

DEFAULT_TIMEOUT_SECONDS = 240.0


def run(questions: Sequence[Question], base_url: str, timeout: float) -> list[Observation]:
    from scripts.loop_eval_flags import observe
    from scripts.loop_eval_rows import Observation
    from scripts.loop_eval_socket import _socket_turn

    rows: list[Observation] = []
    for index, question in enumerate(questions, 1):
        print(f"[{index}/{len(questions)}] {question.id}", file=sys.stderr, flush=True)
        try:
            steps, answer, envelope = _socket_turn(base_url, question.question, timeout)
        except Exception as exc:  # noqa: BLE001 — one dead turn must not lose the other nineteen
            rows.append(
                Observation(
                    id=question.id,
                    expected_family=question.family or "",
                    expected_clause=question.clause or "",
                    expected_kind=question.kind,
                    error=f"{type(exc).__name__}: {exc}"[:200],
                )
            )
            continue
        rows.append(observe(question, steps, answer, envelope))
    return rows


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Loop eval: what the agentic-loop changes did to the SHAPE of a turn.")
    parser.add_argument("--questions", type=Path, default=DEFAULT_QUESTIONS)
    parser.add_argument("--out", type=Path, help="Where to write this run's CSV.")
    parser.add_argument("--compare", nargs=2, type=Path, metavar=("BEFORE", "AFTER"))
    parser.add_argument("--base-url", default=os.environ.get(BASE_URL_ENV, ""))
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_SECONDS)
    args = parser.parse_args(argv)
    from scripts.loop_eval_report import format_comparison
    from scripts.loop_eval_rows import load_questions
    from scripts.loop_eval_rows import read_csv
    from scripts.loop_eval_rows import write_csv

    if args.compare:
        print(format_comparison(read_csv(args.compare[0]), read_csv(args.compare[1])))
        return 0
    if not args.out:
        parser.error("--out is required unless --compare is given")
    if not args.base_url:
        parser.error(
            f"no backend to measure: pass --base-url or set {BASE_URL_ENV}. "
            "This eval needs a running backend with the OIB corpus ingested; it cannot run in CI."
        )
    rows = run(load_questions(args.questions), args.base_url, args.timeout)
    write_csv(args.out, rows)
    print(format_comparison([], rows))
    failed = sum(1 for row in rows if row.error)
    print(f"\nwrote {args.out} ({len(rows)} row(s), {failed} error(s))", file=sys.stderr)
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI
    raise SystemExit(main())
