#!/usr/bin/env python3

"""Comment-line ratchet; the rule and its reasons: docs/contributing/code-conventions.md#comments."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_file_size import comment_lines  # noqa: E402

BASELINE = Path("ci/comment_baseline.json")
FREE = 3
SUFFIXES = (".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")
EXCLUDED = re.compile(
    "|".join(
        (
            r"\.generated\.",
            r"^apps/workspace/shared/cards/generated\.ts$",
            r"^apps/cms/src/payload-types\.ts$",
            r"^apps/cms/src/app/\(payload\)/admin/importMap\.js$",
            r"\.d\.ts$",
            r"(^|/)migrations/",
            r"(^|/)drizzle/",
            r"^packages/agent/src/agent/skills/review/skill-check/",
        )
    )
)
DIRECTIVE = re.compile(
    r"noqa|type:\s*ignore|pragma|pyright:|mypy:|fmt:\s*(off|on|skip)|ruff:|"
    r"eslint-|oxlint-|biome-ignore|prettier-ignore|@ts-(expect-error|ignore|nocheck|check)|"
    r"istanbul ignore|c8 ignore|v8 ignore|@vitest-environment|@jest-environment|@disk-inputs|"
    r"@type\s*\{|@typedef|@param\s*\{|@returns?\s*\{|@template|@satisfies|@import|"
    r"webpack[A-Z]|@vite-ignore|/// <reference|#!|-\*- coding|@license|@preserve"
)
MESSAGE = (
    "Fix the code instead of explaining it: a clearer name, a smaller function, a check whose "
    "message names the rule. Keep only a dated measurement, a vendor bug link or a legal "
    "constraint, and pay for it by deleting another comment. "
    "docs/contributing/code-conventions.md#comments"
)


def is_checked(path: str) -> bool:
    return path.endswith(SUFFIXES) and not EXCLUDED.search(path)


def tracked_sources(root: Path) -> list[str]:
    out = subprocess.run(["git", "ls-files"], cwd=root, capture_output=True, text=True, check=True).stdout
    return [path for path in out.splitlines() if is_checked(path) and (root / path).is_file()]


def prose_comment_count(path: str, source: str) -> int:
    rows = source.split("\n")
    return sum(1 for number in comment_lines(path, source) if not DIRECTIVE.search(rows[number - 1]))


def _script_counts(root: Path, paths: list[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for start in range(0, len(paths), 400):
        batch = paths[start : start + 400]
        out = subprocess.run(
            ["node", str(Path(__file__).with_name("purge_comments.mjs")), "--count", *batch],
            cwd=root,
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        counts.update(json.loads(out))
    return counts


def measure(root: Path, paths: list[str]) -> dict[str, int]:
    python = [path for path in paths if path.endswith(".py")]
    counts = {p: prose_comment_count(p, (root / p).read_text(encoding="utf-8", errors="replace")) for p in python}
    counts.update(_script_counts(root, [path for path in paths if not path.endswith(".py")]))
    return counts


def check(current: dict[str, int], baseline: dict[str, int]) -> list[str]:
    findings = []
    for path, count in sorted(current.items()):
        allowed = max(baseline.get(path, 0), FREE)
        if count > allowed:
            findings.append(f"{path}: {count} comment line(s), {allowed} allowed.")
    for path, allowed in sorted(baseline.items()):
        if path in current and current[path] < allowed and allowed > FREE:
            findings.append(
                f"{path}: down from {allowed} to {current.get(path, 0)}, so lower its entry (run --update)."
            )
    return findings


def tightened(current: dict[str, int], baseline: dict[str, int]) -> dict[str, int]:
    lowered = {path: min(allowed, current.get(path, 0)) for path, allowed in baseline.items()}
    return {path: count for path, count in lowered.items() if count > FREE}


def write_baseline(path: Path, counts: dict[str, int]) -> None:
    path.write_text(json.dumps(dict(sorted(counts.items())), indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--update", action="store_true", help="Lower and remove entries; never raise or add one.")
    mode.add_argument("--rebaseline", action="store_true", help="Rewrite the baseline from the tree.")
    parser.add_argument("paths", nargs="*", help="Check only these files (pre-commit passes the staged ones).")
    args = parser.parse_args(argv)

    root = Path.cwd()
    if args.paths and not (args.update or args.rebaseline):
        current = measure(root, [p for p in args.paths if is_checked(p) and (root / p).is_file()])
    else:
        current = measure(root, tracked_sources(root))
    if args.rebaseline:
        write_baseline(root / BASELINE, {path: count for path, count in current.items() if count > FREE})
        print(f"Wrote {BASELINE}: {sum(current.values())} comment line(s).")
        return 0
    baseline = json.loads((root / BASELINE).read_text(encoding="utf-8")) if (root / BASELINE).exists() else {}
    if args.update:
        baseline = tightened(current, baseline)
        write_baseline(root / BASELINE, baseline)

    findings = check(current, baseline)
    slack = [f for f in findings if "so lower its" in f]
    findings = [f for f in findings if f not in slack]
    if findings:
        print(f"Comment check FAILED ({len(findings)} finding(s)):", file=sys.stderr)
        for finding in findings:
            print(f"  - {finding}", file=sys.stderr)
        print(MESSAGE, file=sys.stderr)
        return 1
    over = sum(1 for count in current.values() if count > FREE)
    print(f"Comment check passed: {sum(current.values())} comment line(s); {over} file(s) over {FREE}, none grown.")
    if slack:
        print(
            f"  {len(slack)} baseline entr{'y' if len(slack) == 1 else 'ies'} can be lowered: `task baselines:tighten`."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
