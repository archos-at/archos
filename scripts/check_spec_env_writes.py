#!/usr/bin/env python3


from __future__ import annotations

import re
import sys
from pathlib import Path

from check_spec_source_reads import scan
from check_spec_source_reads import tracked

DOC = "docs/contributing/code-conventions.md#specs-test-behaviour"
ENV = r"process\s*\.\s*env"
WRITE = re.compile(
    rf"\bdelete\s+{ENV}\b"
    rf"|\b{ENV}\s*(?:\.\s*[A-Za-z_$][\w$]*|\[[^\]]*\])\s*(?:[-+*/|&?]{{0,2}}=)(?!=)"
    rf"|\b{ENV}\s*=(?!=)"
    rf"|\bObject\s*\.\s*assign\s*\(\s*{ENV}\b"
)


def writes(source: str) -> list[int]:
    code, _ = scan(source)
    return sorted({code.count("\n", 0, match.start()) + 1 for match in WRITE.finditer(code)})


def check(root: Path) -> list[str]:
    problems = []
    for path in tracked(root):
        lines = writes((root / path).read_text(encoding="utf-8", errors="replace"))
        if lines:
            problems.append(
                f"{path}:{','.join(map(str, lines))}: writes process.env directly, which leaks into every later "
                "spec file of the worker. Use vi.stubEnv(name, value), or vi.stubEnv(name, undefined) to unset; "
                "vi.unstubAllEnvs() in the vitest setup restores it after each file."
            )
    return problems


def main() -> int:
    problems = check(Path.cwd())
    if problems:
        print(f"Spec env-write check FAILED ({len(problems)}):", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        print(f"Why: {DOC}", file=sys.stderr)
        return 1
    print("Spec env-write check passed: no spec writes process.env directly.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
