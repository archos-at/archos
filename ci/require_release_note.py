#!/usr/bin/env python3

from __future__ import annotations

import re
import subprocess
import sys

USAGE = "usage: require_release_note.py <base-sha> <head-sha>"

NOTES_PREFIX = "releasenotes/notes/"

PRODUCT_PATTERNS = [
    re.compile(r"^packages/agent/src/agent/"),
    re.compile(r"^sources/[^/]+/src/"),
    re.compile(r"^apps/agent-host/src/"),
    re.compile(r"^apps/workspace/(app|bff|ui|i18n|shared)/"),
]

EXEMPT_PATTERNS = [
    re.compile(r"(^|/)tests?/"),
    re.compile(r"\.spec\.(ts|tsx|js|jsx)$"),
    re.compile(r"(^|/)(test_[^/]+|[^/]+_test)\.py$"),
    re.compile(r"\.(md|snap)$"),
    re.compile(r"(^|/)__(mocks|fixtures)__/"),
]


def _git(*args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(["git", *args], capture_output=True, check=False)


def _revs(base: str, head: str) -> str:
    for spec in (f"{base}...{head}", f"{base} {head}"):
        if _git("diff", "--quiet", *spec.split()).returncode in (0, 1):
            return spec
    return f"{base} {head}"


def changed_files(base: str, head: str) -> list[str]:
    result = _git("diff", "--name-only", *_revs(base, head).split())
    if result.returncode != 0:
        print("Could not diff the pull request against its base — skipping the check.", file=sys.stderr)
        return []
    return [line.strip() for line in result.stdout.decode().splitlines() if line.strip()]


def added_files(base: str, head: str) -> list[str]:
    result = _git("diff", "--name-only", "--diff-filter=A", *_revs(base, head).split())
    return [line.strip() for line in result.stdout.decode().splitlines() if line.strip()]


def needs_note(files: list[str]) -> list[str]:
    return [
        path
        for path in files
        if any(p.search(path) for p in PRODUCT_PATTERNS) and not any(e.search(path) for e in EXEMPT_PATTERNS)
    ]


def has_note(files: list[str]) -> bool:
    return any(path.startswith(NOTES_PREFIX) and path.endswith(".yaml") for path in files)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(USAGE, file=sys.stderr)
        return 2
    base, head = argv[1], argv[2]
    files = changed_files(base, head)
    if not files:
        return 0

    triggers = needs_note(files)
    if not triggers:
        print("This pull request touches no product file — no release note required.")
        return 0
    if has_note(added_files(base, head)):
        print(f"Release note present for {len(triggers)} changed product file(s).")
        return 0

    shown = "\n".join(f"    {path}" for path in triggers[:10])
    more = f"\n    …and {len(triggers) - 10} more" if len(triggers) > 10 else ""
    print(
        "This pull request touches product files but adds no release note:\n\n"
        f"{shown}{more}\n\n"
        "Write one:\n\n"
        "    task release:note -- short-slug\n"
        "    # edit releasenotes/notes/short-slug-<hash>.yaml, keep one section\n"
        "    task release:lint\n\n"
        "Notes under features, improvements, fixes, deprecations, upgrade or other are\n"
        "published to https://piloti.at/changelog when this merges: plain sentences,\n"
        "written for the architect using Piloti. A security fix goes under `security`,\n"
        "a severe fix (data lost, a permission that did not hold) under `incident`, and\n"
        "a note only platform operators can act on under `operators`. Those three are\n"
        "kept and never published, and they satisfy this check too. The rules are in\n"
        "docs/contributing/release-notes.md.\n\n"
        "If this change genuinely cannot be noticed by a user (a refactor, a comment,\n"
        "internal tooling, infrastructure), add the `no-release-note` label to the PR\n"
        "and re-run this job. No new commit is needed: the job reads the label live.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
