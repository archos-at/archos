#!/usr/bin/env python3

from __future__ import annotations

import re
import subprocess
import sys

MIGRATIONS = "apps/workspace/migrations/"
LABEL = "migration:contract"

RULES: list[tuple[str, re.Pattern[str]]] = [
    ("drops a table, view, type or schema", re.compile(r"\bDROP\s+(MATERIALIZED\s+VIEW|TABLE|VIEW|TYPE|SCHEMA)\b")),
    ("drops a column", re.compile(r"\bDROP\s+COLUMN\b")),
    (
        "renames a table or column",
        re.compile(r"\bALTER\s+TABLE\s+(IF\s+EXISTS\s+)?(ONLY\s+)?\S+\s+RENAME\s+(TO|COLUMN)\b"),
    ),
    ("changes a column's type", re.compile(r"\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b")),
    ("makes an existing column NOT NULL", re.compile(r"\bALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL\b")),
]
ADD_COLUMN = re.compile(r"\bADD\s+COLUMN\b(?P<clause>[^,;]*)")


_STRING_OR_COMMENT = re.compile(r"'(?:[^']|'')*'|--[^\n]*|/\*.*?\*/", re.DOTALL)


def strip_comments(sql: str) -> str:
    return _STRING_OR_COMMENT.sub(lambda m: m.group(0) if m.group(0).startswith("'") else " ", sql)


def findings(sql: str) -> list[str]:
    text = " ".join(strip_comments(sql).upper().split())
    found = [reason for reason, pattern in RULES if pattern.search(text)]
    flat = re.sub(r"\([^()]*\)", "", text)
    for match in ADD_COLUMN.finditer(flat):
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
