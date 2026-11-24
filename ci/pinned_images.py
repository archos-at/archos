#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

USAGE = (
    "usage: pinned_images.py list [REV]     every pin at REV (default: the working tree)\n"
    "       pinned_images.py new BASE       pins at HEAD that BASE's merge base with HEAD lacks"
)

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "deploy/pulumi/src"
PIN = re.compile(r"""["'`]([a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9._-]+)?@sha256:[a-f0-9]{64})["'`]""")


def pins_in(text: str) -> set[str]:
    return set(PIN.findall(text))


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout


def pins_at(rev: str | None) -> set[str]:
    if rev is None:
        files = [p for p in (ROOT / SOURCE).rglob("*.ts") if not p.name.endswith(".spec.ts")]
        return set().union(*(pins_in(p.read_text(encoding="utf-8")) for p in files))
    names = [n for n in _git("ls-tree", "-r", "--name-only", rev, "--", SOURCE).split() if n.endswith(".ts")]
    return set().union(*(pins_in(_git("show", f"{rev}:{n}")) for n in names if not n.endswith(".spec.ts")))


def main(argv: list[str]) -> int:
    if argv[:1] == ["list"] and len(argv) <= 2:
        print("\n".join(sorted(pins_at(argv[1] if len(argv) == 2 else None))))
        return 0
    if argv[:1] != ["new"] or len(argv) != 2:
        print(USAGE, file=sys.stderr)
        return 2
    merge_base = _git("merge-base", argv[1], "HEAD").strip()
    new = sorted(pins_at("HEAD") - pins_at(merge_base))
    print("\n".join(new) if new else "no pin added or moved")
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(f"pins={json.dumps(new)}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
