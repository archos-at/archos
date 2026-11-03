#!/usr/bin/env python3
"""Fail a PR whose new migration takes something away that a running build still reads.

A rollback (docs/deployment/rollback.md) deploys older images on the current
schema: the migration Job runs `drizzle-kit migrate` forward only, so nothing
undoes a migration. That is safe while migrations only add. A migration that
drops, renames or narrows something breaks every older build that reads it,
and with it the rollback, and during a rollout it breaks the old pods that are
still serving for the minute before the new ones are ready.

So schema changes are expand/contract. The expand migration adds (a table, a
nullable or defaulted column, an index, a compatibility view: 0189 kept each
old table name as a view for a release). The contract migration removes the
old shape, in a later release, once production is pinned past every build that
reads it. This check makes a contract migration visible: it fails on one, and
the `migration:contract` label on the PR, read when the job runs, says the
author knows production has moved past the old shape. The label is the same
escape as `no-release-note`.

It reads only the migrations the PR adds (an edited old migration is not
re-run anywhere), never a `.down.sql`, and ignores comments. It matches
statements, not a parse tree: a drop inside a string literal would be flagged
too, and the label is the answer to that.

A purpose-built linter (Squawk's ban-drop-column, renaming-table and their
siblings) answers the same question with a parser; it was not adopted here only
because it could not be run and its noise on this repository's style measured
in the change that added this. Adopting it is the upgrade path.

Usage: migration_contract.py <base-sha> <head-sha>
"""

from __future__ import annotations

import re
import subprocess
import sys

MIGRATIONS = "apps/workspace/migrations/"
LABEL = "migration:contract"

RULES: list[tuple[str, re.Pattern[str]]] = [
    ("drops a table, view, type or schema", re.compile(r"\bDROP\s+(MATERIALIZED\s+VIEW|TABLE|VIEW|TYPE|SCHEMA)\b")),
    ("drops a column", re.compile(r"\bDROP\s+COLUMN\b")),
    # A table or column, which code names. A function, policy or index rename
    # (0190, 0191) is invisible to an older build.
    (
        "renames a table or column",
        re.compile(r"\bALTER\s+TABLE\s+(IF\s+EXISTS\s+)?(ONLY\s+)?\S+\s+RENAME\s+(TO|COLUMN)\b"),
    ),
    ("changes a column's type", re.compile(r"\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b")),
    ("makes an existing column NOT NULL", re.compile(r"\bALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL\b")),
]
ADD_COLUMN = re.compile(r"\bADD\s+COLUMN\b(?P<clause>[^,;]*)")


def strip_comments(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    return re.sub(r"--[^\n]*", " ", sql)


def findings(sql: str) -> list[str]:
    """What this migration takes away, one line per rule it breaks."""
    text = " ".join(strip_comments(sql).upper().split())
    found = [reason for reason, pattern in RULES if pattern.search(text)]
    for match in ADD_COLUMN.finditer(text):
        clause = match["clause"]
        if re.search(r"\bNOT\s+NULL\b", clause) and not re.search(r"\bDEFAULT\b", clause):
            found.append("adds a NOT NULL column without a default")
            break
    return found


def added_migrations(base: str, head: str) -> list[str]:
    out = subprocess.run(
        ["git", "diff", "--name-only", "--diff-filter=A", f"{base}...{head}", "--", MIGRATIONS],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return [p for p in out.split() if p.endswith(".sql") and not p.endswith(".down.sql")]


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: migration_contract.py <base-sha> <head-sha>", file=sys.stderr)
        return 2
    base, head = argv
    failed = False
    for path in added_migrations(base, head):
        sql = subprocess.run(["git", "show", f"{head}:{path}"], check=True, capture_output=True, text=True).stdout
        for reason in findings(sql):
            failed = True
            print(f"::error file={path}::{path} {reason}: an older build reads it, so rollback breaks.")
    if failed:
        print(
            "Split it: add the new shape now, remove the old one in a later release. If production is already past "
            f"every build that reads the old shape, add the `{LABEL}` label and re-run this job (rollback.md)."
        )
        return 1
    print("No migration this PR adds takes anything away.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
