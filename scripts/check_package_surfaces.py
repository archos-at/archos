#!/usr/bin/env python3


from __future__ import annotations

import argparse
import ast
import re
import subprocess
import sys
from pathlib import Path

EXCLUDED = {"tests/test_check_package_surfaces.py"}

PACKAGES = {
    f"knowledge_layer.{name}": f"packages/knowledge-layer/src/knowledge_layer/{name}"
    for name in ("browse", "estate", "ingest", "read_passage", "search", "vector_store")
}


def tracked_python(root: Path) -> list[str]:
    out = subprocess.run(["git", "ls-files", "*.py"], cwd=root, capture_output=True, text=True, check=True).stdout
    return [path for path in out.splitlines() if path not in EXCLUDED and (root / path).is_file()]


def surface(root: Path, package: str) -> tuple[set[str], set[str]]:
    directory = root / PACKAGES[package]
    submodules = {path.stem for path in directory.glob("*.py") if path.stem != "__init__"}
    init = directory / "__init__.py"
    exported: set[str] = set()
    if init.is_file():
        for node in ast.walk(ast.parse(init.read_text(encoding="utf-8"))):
            if isinstance(node, ast.AnnAssign | ast.Assign) and isinstance(node.value, ast.Dict):
                exported |= {key.value for key in node.value.keys if isinstance(key, ast.Constant)}
    return exported, submodules


WHITE_BOX = (
    "packages/knowledge-layer/tests/",
    "packages/knowledge-layer/testing/",
    "tests/knowledge_layer_tests/",
    "evals/oib-retrieval/src/oib_retrieval/qdrant_parity/",
)


def _owner(path: str) -> str | None:
    if path.startswith(WHITE_BOX):
        return "*"
    return next((package for package, directory in PACKAGES.items() if path.startswith(directory + "/")), None)


def _split(dotted: str) -> tuple[str, str] | None:
    for package in PACKAGES:
        if dotted.startswith(package + "."):
            return package, dotted[len(package) + 1 :].split(".", maxsplit=1)[0]
    return None


STRING = re.compile(r"(?<![\w.])(" + "|".join(re.escape(p) for p in PACKAGES) + r")\.(\w+)")


def references(source: str, path: str, submodules: dict[str, set[str]]) -> list[tuple[str, str, int, list[str]]]:
    owner = _owner(path)
    found = []
    nodes = list(ast.walk(ast.parse(source)))
    prose = {id(node.value) for node in nodes if isinstance(node, ast.Expr)}
    for node in nodes:
        if isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            hit = _split(node.module)
            if hit and owner not in (hit[0], "*"):
                found.append((*hit, node.lineno, [alias.name for alias in node.names]))
            elif node.module in PACKAGES and owner not in (node.module, "*"):
                found += [
                    (node.module, a.name, node.lineno, []) for a in node.names if a.name in submodules[node.module]
                ]
        elif isinstance(node, ast.Import):
            for alias in node.names:
                hit = _split(alias.name)
                if hit and owner not in (hit[0], "*"):
                    found.append((*hit, node.lineno, []))
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in prose:
            for match in STRING.finditer(node.value):
                package, name = match.groups()
                if owner not in (package, "*") and name in submodules[package]:
                    found.append((package, name, node.lineno, []))
    return [ref for ref in found if ref[1] in submodules[ref[0]]]


def findings(refs: list[tuple[str, str, str, int, list[str]]], exported: dict[str, set[str]]) -> list[str]:
    found = []
    for path, package, submodule, line, names in refs:
        public = [name for name in names if name in exported[package]]
        what = (
            f"`from {package} import {', '.join(names)}`" if names and public == names else f"a name from `{package}`"
        )
        found.append(
            f"{path}:{line}: names {package}.{submodule}. Import {what}, its surface; "
            f"a name it lacks goes in `_LAZY` in {PACKAGES[package]}/__init__.py."
        )
    return found


def main(argv: list[str] | None = None) -> int:
    argparse.ArgumentParser(description="Code outside a package imports its surface.").parse_args(argv)
    if sys.version_info < (3, 14):
        print("check_package_surfaces.py needs Python 3.14: run .venv/bin/python", file=sys.stderr)
        return 2
    root = Path.cwd()
    surfaces = {package: surface(root, package) for package in PACKAGES}
    submodules = {package: subs for package, (_names, subs) in surfaces.items()}
    refs = []
    for path in tracked_python(root):
        try:
            source = (root / path).read_text(encoding="utf-8")
            refs += [(path, *ref) for ref in references(source, path, submodules)]
        except (SyntaxError, UnicodeDecodeError):
            continue
    found = findings(refs, {package: names for package, (names, _subs) in surfaces.items()})
    if found:
        print(f"Package surface check FAILED ({len(found)} finding(s)):", file=sys.stderr)
        for finding in found:
            print(f"  - {finding}", file=sys.stderr)
        print("Why: docs/contributing/code-conventions.md#a-package-is-imported-by-its-surface", file=sys.stderr)
        return 1
    print("Package surface check passed: nothing outside a package names its submodules.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
