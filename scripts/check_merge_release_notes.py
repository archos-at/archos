#!/usr/bin/env python3


from __future__ import annotations

import subprocess
import sys
from pathlib import Path

NOTES = "releasenotes/notes/"


def git(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout.strip()


def blob(rev: str, path: str) -> str | None:
    found = subprocess.run(
        ["git", "rev-parse", "--verify", "--quiet", f"{rev}:{path}"], check=False, capture_output=True, text=True
    )
    return found.stdout.strip() or None


def merge_parents() -> list[str]:
    merge_head = Path(git("rev-parse", "--git-path", "MERGE_HEAD"))
    if not merge_head.is_file():
        return []
    return ["HEAD", *merge_head.read_text(encoding="utf-8").split()]


def written_notes(parents: list[str]) -> list[str]:
    staged = git("diff", "--cached", "--name-only", "--diff-filter=AM", "HEAD", "--", NOTES).splitlines()
    return [path for path in staged if blob("", path) not in {blob(parent, path) for parent in parents}]


def main() -> int:
    parents = merge_parents()
    if not parents:
        return 0
    notes = written_notes(parents)
    if not notes:
        return 0
    print("This merge commit writes release notes, which reno cannot read:", file=sys.stderr)
    for path in notes:
        print(f"  - {path}", file=sys.stderr)
    print(
        "Take each note as one parent has it (git checkout HEAD -- <note>), commit the merge, "
        "then make the edit in a commit of its own. Why: docs/contributing/gotchas.md (release:lint).",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
