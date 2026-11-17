#!/usr/bin/env python3


from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

BASELINE = Path("ci/nesting_baseline.json")
SCOPE = ("packages/*/src/*.py", "packages/*/src/**/*.py", "apps/agent-host/src/**/*.py")
RUFF = (
    "check",
    "--preview",
    "--select",
    "PLR1702",
    "--config",
    "lint.ignore = []",
    "--config",
    "lint.pylint.max-nested-blocks = 2",
    "--output-format",
    "json",
    "--no-cache",
    "--exit-zero",
)


def tracked_sources(root: Path) -> list[str]:
    listed = subprocess.run(
        ["git", "ls-files", "-z", "--", *SCOPE], cwd=root, check=True, capture_output=True, text=True
    )
    return sorted(path for path in listed.stdout.split("\0") if path)


def ruff_binary() -> str:
    local = Path(sys.executable).with_name("ruff")
    return str(local) if local.exists() else "ruff"


def findings_per_file(root: Path, paths: list[str]) -> dict[str, int]:
    if not paths:
        return {}
    ran = subprocess.run([ruff_binary(), *RUFF, *paths], cwd=root, check=True, capture_output=True, text=True)
    counts = Counter(
        Path(item["filename"]).resolve().relative_to(root.resolve()).as_posix() for item in json.loads(ran.stdout)
    )
    return dict(counts)


def compare(current: dict[str, int], baseline: dict[str, int]) -> list[str]:
    findings = []
    for path, count in sorted(current.items()):
        allowed = baseline.get(path, 0)
        if count > allowed:
            findings.append(
                f"{path}: {count} function(s) nest past two levels, {allowed} allowed. Name the inner block."
            )
    for path, allowed in sorted(baseline.items()):
        if current.get(path, 0) < allowed:
            findings.append(
                f"{path}: down from {allowed} to {current.get(path, 0)}, so lower its entry (run --update)."
            )
    return findings


def tightened(current: dict[str, int], baseline: dict[str, int]) -> dict[str, int]:
    lowered = {path: min(allowed, current.get(path, 0)) for path, allowed in baseline.items()}
    return {path: count for path, count in lowered.items() if count}


def write_baseline(path: Path, counts: dict[str, int]) -> None:
    path.write_text(json.dumps(dict(sorted(counts.items())), indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Keep a third level of nesting out of Python functions that do not have one yet.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--update", action="store_true", help="Lower and remove baseline entries; never raise one.")
    mode.add_argument("--rebaseline", action="store_true", help="Record the tree as it is, growth included.")
    args = parser.parse_args(argv)

    root = Path.cwd()
    current = findings_per_file(root, tracked_sources(root))
    baseline_path = root / BASELINE
    baseline = json.loads(baseline_path.read_text(encoding="utf-8")) if baseline_path.exists() else {}
    if args.rebaseline:
        write_baseline(baseline_path, current)
        print(f"Nesting baseline rewritten: {len(current)} file(s), {sum(current.values())} finding(s).")
        return 0
    if args.update:
        baseline = tightened(current, baseline)
        write_baseline(baseline_path, baseline)

    findings = compare(current, baseline)
    slack = [f for f in findings if "so lower its" in f or "remove its baseline entry" in f]
    findings = [f for f in findings if f not in slack]
    if findings:
        print(f"Nesting check FAILED ({len(findings)} finding(s)):", file=sys.stderr)
        for finding in findings:
            print(f"  - {finding}", file=sys.stderr)
        print("Why and how: docs/contributing/code-conventions.md (two levels of nesting)", file=sys.stderr)
        return 1
    print(f"Nesting check passed: {len(baseline)} file(s) held at baseline, every other source at two levels.")
    if slack:
        print(
            f"  {len(slack)} baseline entr{'y' if len(slack) == 1 else 'ies'} can be lowered: `task baselines:tighten`."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
