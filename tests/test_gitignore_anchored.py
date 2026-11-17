from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

ANY_DEPTH = {
    "__pycache__": "Python's bytecode cache",
    "node_modules": "npm's install tree",
    "develop-eggs": "setuptools",
    "eggs": "setuptools",
    "lib": "Python build output; the source folders named lib are negated beside it",
    "lib64": "Python build output",
    "sdist": "Python source distributions",
    "wheels": "Python wheels",
    "*.egg-info": "setuptools metadata",
    "venv": "a virtual environment",
    "ENV": "a virtual environment",
    "htmlcov": "coverage.py's HTML report",
    "apm_modules": "the agent package manager's install tree",
    "mcp-app-views": "the MCP app views build (ADR-0142)",
    "dist-scripts": "the workspace's bundled deploy scripts",
    "dist-jobs": "the workspace's bundled jobs",
}

PATTERN = re.compile(r"^[^/#!\s][^/\s]*/$")


def _unanchored() -> list[str]:
    files = subprocess.run(
        ["git", "ls-files", "*.gitignore", ".gitignore"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.split()
    found = []
    for name in sorted(set(files)):
        for number, line in enumerate((ROOT / name).read_text(encoding="utf-8").splitlines(), start=1):
            line = line.strip()
            if not PATTERN.match(line) or line.startswith("."):
                continue  # anchored, a negation, a comment, or a hidden tool folder (`.next/`, `.venv/`)
            if line[:-1] not in ANY_DEPTH:
                found.append(f"{name}:{number}: {line} (write /{line}, or list it in ANY_DEPTH with why)")
    return found


def test_every_directory_pattern_that_could_name_source_is_anchored():
    assert _unanchored() == []
