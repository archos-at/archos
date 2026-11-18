from __future__ import annotations

import ast
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SCANNED = (REPO / "apps/agent-host/src", REPO / "packages/agent/src")

ALLOWED = {
    "packages/agent/src/agent/lazy_exports.py": "PEP 562 re-exports; each package passes a literal map",
    # drop after release 2026-W50
    "packages/agent/src/agent/legacy_paths.py": "checkpoints pickled under agent.agents.piloti restore",
}


def _imports_by_value(tree: ast.AST) -> list[int]:
    lines = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not node.args:
            continue
        func = node.func
        name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", None)
        if name not in {"import_module", "__import__"}:
            continue
        if not (isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str)):
            lines.append(node.lineno)
    return lines


def _found() -> dict[str, list[int]]:
    found = {}
    for root in SCANNED:
        for path in sorted(root.rglob("*.py")):
            lines = _imports_by_value(ast.parse(path.read_text(encoding="utf-8")))
            if lines:
                found[path.relative_to(REPO).as_posix()] = lines
    return found


def test_modules_are_imported_by_literal_name():
    found = _found()

    unexpected = {path: lines for path, lines in found.items() if path not in ALLOWED}
    assert not unexpected, (
        f"import_module with a computed name: {unexpected}. Import the module literally, e.g. a loader "
        "function in agent_host/registry.py"
    )
    assert set(ALLOWED) <= set(found), f"allowlisted but no longer importing by value: {set(ALLOWED) - set(found)}"


def test_the_check_catches_a_computed_name():
    source = (
        "import importlib\n"
        "from importlib import import_module\n"
        "importlib.import_module(p)\n"
        "import_module(f'a.{b}')\n"
        "__import__(x)\n"
        "import_module('ok')\n"
    )

    assert _imports_by_value(ast.parse(source)) == [3, 4, 5]
