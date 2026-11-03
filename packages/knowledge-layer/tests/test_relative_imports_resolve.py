"""Every relative import in the knowledge layer names a module that exists.

When the layer was laid out by job, a branch written before the move merged
cleanly and still said ``from .qdrant.schema import …`` inside a file that now
lives in ``search/``: git carried the hunk into the moved file, and the import,
inside a function body, failed only when a test happened to call it. Read
statically here, so a function nothing calls is checked too.
"""

from __future__ import annotations

import ast
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"


def _unresolved() -> list[str]:
    missing = []
    for path in sorted(SRC.rglob("*.py")):
        parts = list(path.relative_to(SRC).with_suffix("").parts)
        package = parts[:-1]
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if not (isinstance(node, ast.ImportFrom) and node.level):
                continue
            base = package[: len(package) - (node.level - 1)] + (node.module.split(".") if node.module else [])
            target = SRC.joinpath(*base)
            if not (target.with_suffix(".py").is_file() or (target / "__init__.py").is_file()):
                missing.append(f"{path.relative_to(SRC)}:{node.lineno}: from {'.' * node.level}{node.module or ''}")
    return missing


def test_every_relative_import_names_a_module_that_exists():
    assert _unresolved() == []
