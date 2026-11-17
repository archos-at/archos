#!/usr/bin/env python3

from __future__ import annotations

import datetime
import fnmatch
import json
import os
import posixpath
import re
import subprocess
import sys
import urllib.parse
from collections.abc import Callable
from collections.abc import Iterable
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
UI = "apps/workspace/"

Get = Callable[[str], Any]

CACHE_PREFIX = "testmon-"
BASE_SLACK = datetime.timedelta(hours=1)

PY_FULL = (
    "**/conftest.py",
    "conftest.py",
    "tests/fixtures/*.py",
    "tests/__init__.py",
    "uv.lock",
    "pyproject.toml",
    "**/pyproject.toml",
    "Taskfile.yml",
    "taskfiles/backend.yml",
    ".github/workflows/ci.yml",
    ".github/filters.yml",
    ".github/actions/setup-python-env/**",
    "ci/pr_selection.py",
    "scripts/rls-test-db.sh",
)

PY_TRACKED = (
    "tests/**",
    "apps/agent-host/src/**",
    "apps/agent-host/tests/**",
    "packages/*/src/**",
    "packages/*/tests/**",
    "packages/*/testing/**",
    "evals/**",
)

PY_TEST_ROOTS = ("tests", "apps/agent-host/tests", "packages", "evals")

PY_FIXTURES = "tests/fixtures/"

PY_PACKAGE_SRC = ("apps/agent-host/src/**", "packages/*/src/**", "evals/*/src/**", "evals/*/fixtures/**")

UI_FULL = (
    UI + "package.json",
    UI + "bun.lock",
    UI + "tsconfig*.json",
    UI + "vitest.config.*",
    UI + "next.config.ts",
    UI + "config/vitest/**",
    UI + "tests/mocks/**",
    UI + "ui/adapters/api/documents-schemas.ts",
    UI + "ui/features/documents/types.ts",
    UI + "bff/upload-screening/policy.ts",
    "Taskfile.yml",
    "taskfiles/workspace.yml",
    ".github/workflows/ci.yml",
    ".github/filters.yml",
    ".github/actions/setup-bun/**",
    "ci/pr_selection.py",
)

UI_INPUTS = (
    UI + "**",
    "configs/**",
    "contracts/**",
    "scripts/**",
    "packages/agent/src/agent/cards/**",
    "tests/fixtures/**",
)

_SOURCE_DIRS = ("app", "bff", "ui", "i18n", "shared", "types", "utils")
_VITEST_INCLUDE = (
    *(f"{root}/**/*.{kind}.{ext}" for root in _SOURCE_DIRS for kind in ("spec", "test") for ext in ("ts", "tsx")),
    "*.spec.ts",
    "*.spec.tsx",
    "*.test.ts",
    "*.test.tsx",
    "tests/**/*.spec.ts",
    "tests/**/*.spec.tsx",
    "tests/**/*.test.ts",
    "tests/**/*.test.tsx",
    "purger/**/*.spec.mjs",
    "observability/**/*.spec.mjs",
    "workers/**/*.spec.mjs",
    "scripts/**/*.spec.mjs",
    "eslint-rules/**/*.spec.mjs",
)
UI_SPECS = _VITEST_INCLUDE + tuple(glob.replace("/**/", "/") for glob in _VITEST_INCLUDE)

# declares them in a `// @disk-inputs:` line (globs relative to apps/workspace),
READS_DISK = re.compile(
    r"""from ['"](?:node:)?fs(?:/promises)?['"]|require\(['"](?:node:)?fs|readdirSync|readFileSync|globSync"""
)
DISK_INPUTS = re.compile(r"^\s*//\s*@disk-inputs:\s*(.+)$", re.MULTILINE)
SPAWNS = re.compile(r"""['"](?:node:)?child_process['"]""")

DiskReaders = dict[str, tuple[str, ...] | None]


def declared_inputs(source: str) -> tuple[str, ...] | None:
    found = DISK_INPUTS.search(source)
    if not found or SPAWNS.search(source):
        return None
    globs = (glob.strip() for glob in found.group(1).split(","))
    return tuple(posixpath.normpath(posixpath.join(UI, glob)).replace("[", "[[]") for glob in globs if glob)


def _matches(path: str, patterns: Iterable[str]) -> bool:
    return any(fnmatch.fnmatchcase(path, pattern) for pattern in patterns)


def _reads(path: str, file: str, text: str) -> bool:
    name = Path(path).name
    if Path(file).name.startswith("test_") and (path in text or name in text):
        return True
    if any(f"{lead}{name}{quote}" in text for lead in ("/", '"', "'") for quote in ('"', "'")):
        return True
    if not path.startswith(PY_FIXTURES):
        return False
    parts = Path(path).parent.relative_to(PY_FIXTURES).parts
    return any(form in text for part in parts for form in (f"fixtures/{part}", f"/{part}/", f"'{part}'", f'"{part}"'))


def _readers(path: str, test_files: dict[str, str]) -> set[str]:
    words = [Path(path).name]
    if path.startswith(PY_FIXTURES):
        words += Path(path).parent.relative_to(PY_FIXTURES).parts
    return {
        file for file, text in test_files.items() if any(word in text for word in words) and _reads(path, file, text)
    }


SUPPORT_MODULE = re.compile(r"/testing/(?P<module>\w+_testing(?:/\w+)*)\.py$")


def _importers(helper: str, test_files: dict[str, str]) -> set[str] | None:
    match = SUPPORT_MODULE.search(f"/{helper}")
    if not match:
        return None
    dotted = match["module"].replace("/", ".").removesuffix(".__init__")
    package, _, leaf = dotted.rpartition(".")
    spellings = [rf"\b{re.escape(dotted)}\b"]
    if package:
        spellings.append(rf"from\s+{re.escape(package)}\s+import\s+[^\n]*\b{re.escape(leaf)}\b")
    imports = re.compile("|".join(spellings))
    return {file for file, text in test_files.items() if Path(file).name.startswith("test_") and imports.search(text)}


def decide_python(changed: list[str], test_files: dict[str, str], recorded: bool) -> tuple[str, list[str], str]:
    if not recorded:
        return "full", [], "no recorded testmon database to select from"
    forced = [path for path in changed if _matches(path, PY_FULL)]
    if forced:
        return "full", [], f"{forced[0]} changes how every test runs"
    untracked = [path for path in changed if path.endswith(".py") and not _matches(path, PY_TRACKED)]
    if untracked:
        return "full", [], f"{untracked[0]} is Python outside the tested packages"
    extra: set[str] = set()
    for path in changed:
        if path.endswith(".py"):
            continue
        named = _readers(path, test_files)
        for helper in sorted(name for name in named if not Path(name).name.startswith("test_")):
            importers = _importers(helper, test_files)
            if not importers:
                return "full", [], f"{path} is read by {helper}, which no test file connects to it"
            named = (named - {helper}) | importers
        if not named and path.startswith(PY_FIXTURES):
            return "full", [], f"{path} is a fixture no test names"
        if not named and _matches(path, PY_PACKAGE_SRC):
            return "full", [], f"{path} is package data no test names"
        extra |= named
    reason = f"{len(changed)} changed files; testmon selects, plus {len(extra)} test files naming a non-Python change"
    return "select", sorted(extra), reason


def decide_ui(changed: list[str], disk_readers: DiskReaders) -> tuple[str, list[str], str]:
    forced = [path for path in changed if _matches(path, UI_FULL)]
    if forced:
        return "full", [], f"{forced[0]} reaches every spec"
    declared = {glob for inputs in disk_readers.values() if inputs for glob in inputs}
    if not any(_matches(path, UI_INPUTS) or _matches(path, declared) for path in changed):
        return "none", [], "nothing a UI spec reads changed"
    mine = sorted(path.removeprefix(UI) for path in changed if path.startswith(UI))
    undeclared = {spec for spec, inputs in disk_readers.items() if inputs is None}
    reached = {spec for spec, inputs in disk_readers.items() if inputs and any(_matches(p, inputs) for p in changed)}
    files = sorted(set(mine) | undeclared | reached)
    reason = (
        f"{len(mine)} changed UI files, plus {len(reached)} of {len(disk_readers) - len(undeclared)} "
        f"tree-reading specs whose declared inputs changed and {len(undeclared)} that declare none"
    )
    return "select", files, reason


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout


def _names(*args: str) -> list[str]:
    return [line for line in _git(*args).splitlines() if line]


def _python_test_files() -> dict[str, str]:
    files: dict[str, str] = {}
    for root in PY_TEST_ROOTS:
        for path in (ROOT / root).rglob("*.py"):
            relative = path.relative_to(ROOT).as_posix()
            if root == "packages" and "/tests/" not in f"/{relative}" and "/testing/" not in f"/{relative}":
                continue
            files[relative] = path.read_text(encoding="utf-8", errors="ignore")
    return files


def _disk_readers() -> DiskReaders:
    ui = ROOT / UI
    readers: DiskReaders = {}
    for directory, subdirs, names in os.walk(ui):
        subdirs[:] = [name for name in subdirs if name not in ("node_modules", ".next", "coverage")]
        for name in names:
            path = Path(directory, name)
            relative = path.relative_to(ui).as_posix()
            if not _matches(relative, UI_SPECS):
                continue
            source = path.read_text(encoding="utf-8", errors="ignore")
            if READS_DISK.search(source):
                readers[relative] = declared_inputs(source)
    return dict(sorted(readers.items()))


def previous_green(get: Get, repo: str, branch: str, head: str, is_ancestor: Callable[[str], bool]) -> dict | None:
    query = urllib.parse.urlencode({"branch": branch, "event": "pull_request", "status": "success", "per_page": 30})
    for run in get(f"/repos/{repo}/actions/workflows/ci.yml/runs?{query}").get("workflow_runs", []):
        sha = run.get("head_sha", "")
        if re.fullmatch(r"[0-9a-f]{40}", sha) and (sha == head or is_ancestor(sha)):
            return run
    return None


Reference = tuple[list[str], str, str]


def changed_paths(base: str, previous: dict | None) -> list[Reference]:
    merge_base = _git("merge-base", base, "HEAD").strip()
    whole = (_names("diff", "--name-only", "--no-renames", merge_base, "HEAD"), f"the base {merge_base[:12]}", "base")
    if previous is None:
        return [whole]
    own = _names("diff", "--name-only", "--no-renames", previous["head_sha"], "HEAD")
    started = datetime.datetime.fromisoformat(previous["created_at"].replace("Z", "+00:00"))
    since = (started - BASE_SLACK).isoformat()
    from_base = _names("log", "--format=", "--name-only", f"--since={since}", base)
    since_green = sorted(set(own) | set(from_base))
    return [whole, (since_green, f"the last green run at {previous['head_sha'][:12]}", "green")]


def cheaper(candidates: list[Reference], cost: Callable[[list[str]], int]) -> Reference:
    return min(candidates, key=lambda candidate: (cost(candidate[0]), len(candidate[0])))


def recorded_database(get: Get) -> bool:
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    query = urllib.parse.urlencode({"key": CACHE_PREFIX, "ref": "refs/heads/develop", "per_page": "1"})
    try:
        return bool(get(f"/repos/{repo}/actions/caches?{query}").get("actions_caches"))
    except Exception as error:  # noqa: BLE001 - a lookup failure means a full run, never a red Plan
        print(f"cache lookup failed ({error}); running the full Python suite", file=sys.stderr)
        return False


USAGE = (
    "usage: pr_selection.py BASE\n"
    "environment (all optional): GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL, GITHUB_HEAD_REF"
)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(USAGE, file=sys.stderr)
        return 2
    token = os.environ.get("GITHUB_TOKEN", "")
    previous, recorded = None, False
    if token:
        from reuse_green_run import github_get

        get = github_get(os.environ.get("GITHUB_API_URL", "https://api.github.com"), token)
        recorded = recorded_database(get)
        head = _git("rev-parse", "HEAD").strip()

        def is_ancestor(sha: str) -> bool:
            return (
                subprocess.run(["git", "merge-base", "--is-ancestor", sha, "HEAD"], cwd=ROOT, check=False).returncode
                == 0
            )

        try:
            previous = previous_green(
                get, os.environ.get("GITHUB_REPOSITORY", ""), os.environ.get("GITHUB_HEAD_REF", ""), head, is_ancestor
            )
        except Exception as error:  # noqa: BLE001 - no previous run only widens the set
            print(f"previous-run lookup failed ({error}); diffing against the base", file=sys.stderr)
    test_files, disk_readers = _python_test_files(), _disk_readers()

    def full_suites(paths: list[str]) -> int:
        return (decide_python(paths, test_files, recorded)[0] == "full") + (decide_ui(paths, disk_readers)[0] == "full")

    changed, since, reference = cheaper(changed_paths(argv[1], previous), full_suites)
    py_mode, py_extra, py_reason = decide_python(changed, test_files, recorded)
    ui_mode, ui_files, ui_reason = decide_ui(changed, disk_readers)
    print(f"changes since {since}: {len(changed)} files")
    print(f"python: {py_mode} ({py_reason})")
    print(f"ui: {ui_mode} ({ui_reason})")
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(f"since={since}\nreference={reference}\n")
            handle.write(f"py_mode={py_mode}\npy_extra={json.dumps(py_extra)}\n")
            handle.write(f"ui_mode={ui_mode}\nui_files={json.dumps(ui_files)}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
