#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import os
import subprocess
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKSPACE = ROOT / "apps" / "workspace"
PYTHON = os.environ.get("GENERATE_PYTHON", str(ROOT / ".venv" / "bin" / "python"))

SCRIPT_GENERATORS = ("scripts/generate_*.py",)
NODE_GENERATORS = ("apps/workspace/scripts/generate-*.mjs", "apps/workspace/scripts/sync-*.mjs", "packages/*/sync.mjs")
SPEC_HELPER = "@/test-utils/generated-file"
TEST_HELPER = "agent_testing.generated"
FIXTURE_ROUNDS = 3


@dataclass
class Step:
    label: str
    argv: list[str]
    cwd: Path = ROOT
    env: dict[str, str] = field(default_factory=dict)


def _tracked(*patterns: str) -> list[str]:
    out = subprocess.run(["git", "ls-files", "--", *patterns], cwd=ROOT, capture_output=True, text=True, check=True)
    return sorted(path for path in out.stdout.splitlines() if not path.endswith((".spec.mjs", ".test.mjs")))


def _users(needle: str, *patterns: str) -> list[str]:
    out = subprocess.run(
        ["git", "grep", "-l", "-F", needle, "--", *patterns], cwd=ROOT, capture_output=True, text=True, check=False
    )
    return sorted(out.stdout.splitlines())


def script_steps() -> list[Step]:
    env = {"PYTHONPATH": str(ROOT / "packages" / "agent" / "src")}
    steps = [Step(path, [PYTHON, path], env=env) for path in _tracked(*SCRIPT_GENERATORS)]
    return steps + [Step(path, ["node", path]) for path in _tracked(*NODE_GENERATORS)]


def fixture_steps() -> list[Step]:
    specs = [
        str(Path(path).relative_to("apps/workspace"))
        for path in _users(SPEC_HELPER, "apps/workspace/**/*.spec.ts", "apps/workspace/**/*.spec.tsx")
    ]
    tests = [path for path in _users(TEST_HELPER, "*.py") if not path.endswith("agent_testing/generated.py")]
    update = {"UPDATE_FIXTURES": "1", "TZ": "UTC"}
    steps = []
    if specs:
        steps.append(
            Step(
                f"{len(specs)} UI specs",
                ["bun", "run", "test:specs", *(f"./{spec}" for spec in specs)],
                cwd=WORKSPACE,
                env=update,
            )
        )
    if tests:
        argv = [PYTHON, "-m", "pytest", "-q", "-p", "no:cacheprovider", *tests]
        steps.append(Step(f"{len(tests)} Python tests", argv, env=update))
    return steps


def lock_steps() -> list[Step]:
    version = os.environ.get("APM_VERSION")
    if not version:
        return []
    return [Step("apm.lock.yaml", ["uvx", "--from", f"apm-cli=={version}", "apm", "install", "--frozen"])]


def run(step: Step) -> bool:
    print(f"→ {step.label}", flush=True)
    env = {**os.environ, **step.env}
    done = subprocess.run(step.argv, cwd=step.cwd, env=env, capture_output=True, text=True, check=False)
    if done.returncode != 0:
        print((done.stdout + done.stderr)[-3000:], file=sys.stderr)
        print(f"✗ {step.label} failed (exit {done.returncode})", file=sys.stderr)
    return done.returncode == 0


def tree_state() -> str:
    diff = subprocess.run(["git", "diff", "HEAD"], cwd=ROOT, capture_output=True, check=True).stdout
    untracked = subprocess.run(
        ["git", "ls-files", "--others", "--exclude-standard"], cwd=ROOT, capture_output=True, check=True
    ).stdout
    return hashlib.sha256(diff + untracked).hexdigest()


def changed_files() -> dict[str, str]:
    out = subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=all"], cwd=ROOT, capture_output=True, text=True, check=True
    )
    paths = [line[3:].split(" -> ")[-1] for line in out.stdout.splitlines()]
    return {path: _digest(ROOT / path) for path in paths}


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else "absent"


def generate() -> list[str]:
    failed = [step.label for step in script_steps() if not run(step)]
    for _ in range(FIXTURE_ROUNDS):
        before = tree_state()
        failed += [step.label for step in fixture_steps() if not run(step)]
        if tree_state() == before:
            break
    return failed + [step.label for step in lock_steps() if not run(step)]


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Rewrite every file generated from code: the generator scripts, the fixtures the specs and tests "
        "hold, and the agent-skill lockfile. A generator is found by its name or its helper, never listed."
    )
    parser.add_argument("--list", action="store_true", help="name what would run, and run nothing")
    args = parser.parse_args(argv)
    if args.list:
        for step in script_steps() + fixture_steps() + lock_steps():
            print(f"{step.label}: {' '.join(step.argv[:3])} … (in {step.cwd.relative_to(ROOT)})")
        return 0
    start = changed_files()
    failed = generate()
    end = changed_files()
    rewritten = sorted(path for path in start.keys() | end.keys() if start.get(path) != end.get(path))
    print("\nRewritten:" if rewritten else "\nNothing generated was stale.")
    for path in rewritten:
        print(f"  {path}")
    if failed:
        print(f"\n{len(failed)} step(s) failed: {', '.join(failed)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
