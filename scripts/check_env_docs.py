#!/usr/bin/env python3


from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

DOC = Path("docs/deployment/environment-variables.md")

SCOPE = (
    "apps/agent-host/src/agent_host/jobs/*.py",
    "packages/agent/src/agent/knowledge/ingest_*.py",
    "packages/agent/src/agent/knowledge/folder_cards/*.py",
    "apps/workspace/workers/*.js",
    "apps/workspace/purger/*.js",
    "apps/workspace/bff/scheduling/*.ts",
    "apps/workspace/bff/jobs-queue/*.ts",
    "apps/workspace/bff/mail-import/*.ts",
)

NOT_OURS = frozenset({"HOSTNAME"})

_NAME = r"([A-Z][A-Z0-9_]*)"
PY_READ = re.compile(rf"""(?:environ\.get\(|environ\[|getenv\(|_env\(|_flag\()\s*["']{_NAME}["']""")
PY_CONST = re.compile(rf"""^\s*\w*_ENV\s*=\s*["']{_NAME}["']""", re.MULTILINE)
JS_READ = re.compile(rf"""\benv(?:\.{_NAME}|\[['"]{_NAME}['"]\])""")
DOC_ROW = re.compile(rf"^\|\s*`{_NAME}`\s*\|", re.MULTILINE)


def names_read(path: str, source: str) -> set[str]:
    if path.endswith(".py"):
        return set(PY_READ.findall(source)) | set(PY_CONST.findall(source))
    return {dotted or indexed for dotted, indexed in JS_READ.findall(source)}


def undocumented(sources: dict[str, str], doc: str) -> dict[str, list[str]]:
    rows = set(DOC_ROW.findall(doc))
    missing: dict[str, list[str]] = {}
    for path, source in sorted(sources.items()):
        for name in sorted(names_read(path, source) - rows - NOT_OURS):
            missing.setdefault(name, []).append(path)
    return missing


def _scoped_files() -> list[str]:
    listed = subprocess.run(["git", "ls-files", "--", *SCOPE], capture_output=True, text=True, check=True)
    return [path for path in listed.stdout.split() if ".spec." not in path and not path.endswith(".d.ts")]


def main() -> int:
    sources = {path: Path(path).read_text(encoding="utf-8") for path in _scoped_files()}
    missing = undocumented(sources, DOC.read_text(encoding="utf-8"))
    for name, paths in missing.items():
        print(f"{name} is read by {', '.join(paths)} and has no row in {DOC}", file=sys.stderr)
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
