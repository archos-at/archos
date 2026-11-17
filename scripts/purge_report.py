"""List purged comment lines that state an invariant, for review before merge."""

from __future__ import annotations

import re
import subprocess
import sys

INVARIANT = re.compile(
    r"\b(never|must|always|only|security|secur|tenant|rls|row-level|privacy|private|personal|leak|"
    r"invariant|guard|authz|permission|secret|token|race|deadlock|idempot|workaround|upstream|legal|gdpr|dsgvo)\w*|https?://|§|\b20[12]\d\b",
    re.I,
)


def main(paths: list[str]) -> int:
    diff = subprocess.run(["git", "diff", "-U0", "--", *paths], capture_output=True, text=True, check=True).stdout
    current = ""
    hits = 0
    for row in diff.splitlines():
        if row.startswith("+++ b/"):
            current = row[6:]
        elif row.startswith("-") and not row.startswith("---") and INVARIANT.search(row):
            print(f"{current}: {row[1:].strip()}")
            hits += 1
    print(f"{hits} purged line(s) name an invariant", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
