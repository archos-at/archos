#!/usr/bin/env python3

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from pathlib import PurePosixPath

MARKER = "drop after release"
OCCURRENCE = re.compile(MARKER + r"\W*")
COMMENT = re.compile(r"(?:^|\s)(?:#|//)")
YEAR_WEEK = re.compile(r"(\d{4})-W(\d{2})")
PLACEHOLDER = re.compile(r"N\b")


def tracked_text(root: Path) -> Iterator[tuple[str, list[str]]]:
    out = subprocess.run(["git", "ls-files", "-z"], cwd=root, capture_output=True, text=True, check=True).stdout
    for path in filter(None, out.split("\0")):
        target = root / path
        if "node_modules" in PurePosixPath(path).parts or not target.is_file():
            continue
        data = target.read_bytes()
        if MARKER.encode() not in data or b"\0" in data:
            continue
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            continue
        yield path, text.splitlines()


def week_of(text: str) -> tuple[int, int] | None:
    found = YEAR_WEEK.match(text)
    if found is None:
        return None
    year, week = int(found[1]), int(found[2])
    try:
        date.fromisocalendar(year, week, 1)
    except ValueError:
        return None
    return year, week


def scan(path: str, lines: list[str], today_week: tuple[int, int]) -> tuple[int, list[str]]:
    markers, findings = 0, []
    for line_no, line in enumerate(lines, start=1):
        for occurrence in OCCURRENCE.finditer(line):
            if line_no > 1 and not COMMENT.search(line[: occurrence.start()]):
                continue
            rest = line[occurrence.end() :]
            week = week_of(rest)
            if week is None:
                if not PLACEHOLDER.match(rest):
                    findings.append(
                        f"{path}:{line_no}: malformed legacy marker; the phrase must be followed by an ISO "
                        "year and week, YYYY-Www, that exists."
                    )
                continue
            markers += 1
            if week < today_week:
                year, iso_week = week
                findings.append(
                    f"{path}:{line_no}: release {year}-W{iso_week:02d} has shipped; delete this legacy name and "
                    "everything that reads it, or move the marker to the release that will drop it."
                )
    return markers, findings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Fail when a legacy name has outlived the release its marker names.")
    parser.add_argument("--today", type=date.fromisoformat, help="Judge as of this YYYY-MM-DD instead of today.")
    args = parser.parse_args(argv)
    today_week = (args.today or date.today()).isocalendar()[:2]

    markers, findings = 0, []
    for path, lines in tracked_text(Path.cwd()):
        count, found = scan(path, lines, today_week)
        markers += count
        findings += found
    if findings:
        for finding in findings:
            print(finding, file=sys.stderr)
        return 1
    print(f"Legacy expiry check passed: {markers} marker(s), none past its release.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
