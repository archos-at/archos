#!/usr/bin/env python3
"""Run the part of the local gate a change can break: `task verify:fast`.

The whole gate is `task verify`. It costs about a quarter of an hour on four
cores, and the UI suite is thirteen minutes of that (measured 2026-11-10: 2,310
CPU seconds of 3,250), whatever the change touched. CI does not pay that on a
pull request: its Plan job runs only the tiers `.github/filters.yml` names for
the diff, and only the UI specs `ci/pr_selection.py` says the diff reaches.
This script makes the same two decisions for the working tree, from the same
two definitions, so the local gate before a push costs what the change costs.

What changed: everything since the merge base with the default branch
(`origin/develop`, or `VERIFY_BASE`), committed or not, plus untracked files.

What runs, after `lint:repo` (which the Taskfile runs first, always):

- a tier whose filter matches a changed path, without its production build
  and without coverage instrumentation;
- for the UI tier, the specs `decide_ui` selects (`vitest related`), or the
  whole suite when the change reaches what every spec loads;
- the harness tests when the backend tier does not run, as CI's Repo checks
  job runs them on every pull request.

The Python suites run whole when the backend tier runs: the testmon database
CI selects from is recorded on `develop` and lives in CI's cache.

`--all` runs every tier whole. So does a missing base, since a selection from
an unknown diff is a guess.

Usage: verify_plan.py [--all] [--dry-run] [--task TASK_EXE]
"""

from __future__ import annotations

import argparse
import os
import shlex
import subprocess
import sys
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pr_selection  # noqa: E402 - a sibling script, loaded by path like reuse_green_run

ROOT = pr_selection.ROOT
FILTERS = ROOT / ".github" / "filters.yml"
DEFAULT_BASE = "origin/develop"

#: The tasks each tier of `.github/filters.yml` runs here. The UI tier's suite
#: is decided separately (`_ui_tasks`).
TIER_TASKS: dict[str, tuple[str, ...]] = {
    "backend": ("be:verify:fast",),
    "workspace": ("workspace:lint", "workspace:types"),
    "site": ("verify:website:fast",),
    "cms": ("verify:cms",),
    "infra": ("infra:types", "infra:test"),
}

#: Required checks outside `task verify` (they need PostgreSQL server binaries
#: or minutes of IfcOpenShell), named when the change touches what they guard.
ALSO_RUN: dict[str, str] = {
    "migrations": "task db:test:rls",
    "packages": "task pkg:test",
    "cms": "task cms:test:db",
}


@dataclass(frozen=True)
class Plan:
    """What `verify:fast` runs for one set of changed paths."""

    tasks: tuple[str, ...]
    #: Paths for `vitest related`, relative to apps/workspace; empty unless selected.
    ui_files: tuple[str, ...] = ()
    notes: tuple[str, ...] = field(default=())


def load_filters(path: Path = FILTERS) -> dict[str, list[str]]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def tiers_for(changed: list[str], filters: dict[str, list[str]]) -> set[str]:
    """The tiers whose filter names a changed path, matched as `pr_selection` matches."""
    return {tier for tier, globs in filters.items() if any(pr_selection._matches(path, globs) for path in changed)}


def _ui_tasks(changed: list[str], disk_readers: pr_selection.DiskReaders) -> tuple[list[str], list[str], str]:
    mode, files, reason = pr_selection.decide_ui(changed, disk_readers)
    if mode == "full":
        return ["workspace:test"], [], f"UI suite: whole ({reason})"
    if mode == "none":
        return [], [], f"UI suite: skipped ({reason})"
    return ["workspace:test:related"], files, f"UI suite: {len(files)} paths to `vitest related` ({reason})"


def full_plan(reason: str) -> Plan:
    tasks = [task for tier in TIER_TASKS for task in TIER_TASKS[tier]]
    return Plan(tasks=(*tasks, "workspace:test"), notes=(f"every tier, whole: {reason}",))


def plan(changed: list[str], filters: dict[str, list[str]], disk_readers: pr_selection.DiskReaders) -> Plan:
    """The tasks a change to `changed` needs, in the order of `TIER_TASKS`."""
    hit = tiers_for(changed, filters)
    tasks = [task for tier in TIER_TASKS if tier in hit for task in TIER_TASKS[tier]]
    notes = [f"{len(changed)} changed paths; tiers: {', '.join(sorted(hit & TIER_TASKS.keys())) or 'none'}"]
    ui_files: list[str] = []
    if "workspace" in hit:
        ui, ui_files, note = _ui_tasks(changed, disk_readers)
        tasks += ui
        notes.append(note)
    if "backend" not in hit:
        # CI's Repo checks job runs these on every pull request: `ci/`, the
        # workflows and the release notes are in no tier's filter.
        tasks.append("be:test:harness")
    notes += [f"not in verify, and this change touches it: {ALSO_RUN[tier]}" for tier in ALSO_RUN if tier in hit]
    return Plan(tasks=tuple(tasks), ui_files=tuple(ui_files), notes=tuple(notes))


def _git(*args: str) -> str | None:
    done = subprocess.run(["git", *args], cwd=ROOT, check=False, capture_output=True, text=True)
    return done.stdout if done.returncode == 0 else None


def changed_paths(base: str) -> list[str] | None:
    """Paths that differ from the merge base with `base`, untracked files included; None without a base."""
    merge_base = _git("merge-base", "HEAD", base)
    if merge_base is None:
        return None
    diff = _git("diff", "--name-only", merge_base.strip())
    untracked = _git("ls-files", "--others", "--exclude-standard")
    if diff is None or untracked is None:
        return None
    return sorted(set(diff.split("\n") + untracked.split("\n")) - {""})


def command(task_exe: str, decided: Plan) -> list[str]:
    """One `task --parallel` over the plan; the related run's variables ride along."""
    argv = [task_exe, "--parallel", "--output=group", *decided.tasks]
    if decided.ui_files:
        argv += ["SHARD=1/1", "FILES=" + " ".join(decided.ui_files)]
    return argv


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--all", action="store_true", help="run every tier whole")
    parser.add_argument("--dry-run", action="store_true", help="print the plan and stop")
    parser.add_argument("--task", default="task", help="the go-task executable")
    args = parser.parse_args(argv[1:])

    base = os.environ.get("VERIFY_BASE", DEFAULT_BASE)
    changed = None if args.all else changed_paths(base)
    if args.all:
        decided = full_plan("--all")
    elif changed is None:
        decided = full_plan(f"no merge base with {base} (git fetch origin develop, or set VERIFY_BASE)")
    else:
        decided = plan(changed, load_filters(), pr_selection._disk_readers())

    for note in decided.notes:
        print(f"verify:fast: {note}")
    if not decided.tasks:
        return 0
    run = command(args.task, decided)
    print("verify:fast: " + shlex.join(run[:3] + list(decided.tasks)), flush=True)
    if args.dry_run:
        return 0
    return subprocess.run(run, cwd=ROOT, check=False).returncode


if __name__ == "__main__":
    sys.exit(main(sys.argv))
