#!/usr/bin/env python3

"""Keep code outside a package from reaching past its surface into its submodules.

Why this exists
---------------

A package laid out by job (``knowledge_layer.search``, ``knowledge_layer.ingest``
and their siblings) is one name to the code that uses it, until that code imports
``knowledge_layer.search.ranked_search`` instead. Then the submodule's path is
the contract: laying the knowledge layer out by job meant rewriting 225
references to 24 submodules of the old ``llamaindex`` package alone, most of
them in tests, and the dotted strings among them (``patch("knowledge_layer.….name")``) fail only
when the test runs.

Each listed package's ``__init__.py`` exports what code outside it imports
(``_LAZY``, loaded on first use, `agent.lazy_exports`). This check counts the
references that still name a submodule from outside its package:

- ``from <package>.<submodule> import …`` (one per statement),
- ``from <package> import <submodule>`` and ``import <package>.<submodule>``,
- a string holding ``<package>.<submodule>``: a patch target, an
  ``importlib.import_module`` path, a logger name (a docstring is prose, and
  is not counted).

A test that patches what a submodule looks up needs that module, and code inside
the package imports its siblings; those stay. What is in
``ci/package_surface_baseline.json``, per file and submodule, may only shrink.
A name the package exports is imported from the package, and the finding says
so.

Usage:
    python scripts/check_package_surfaces.py              # check, exit 1 on a finding
    python scripts/check_package_surfaces.py --update     # ratchet the baseline down
    python scripts/check_package_surfaces.py --rebaseline # rewrite it from the tree

``--rebaseline`` is for a move that re-keys entries: it records the tree as it
is, growth included, so its diff is the thing to review.
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import subprocess
import sys
from pathlib import Path

BASELINE = Path("ci/package_surface_baseline.json")
# Its strings are the cases it runs, not references.
EXCLUDED = {"tests/test_check_package_surfaces.py"}

# Each package that has a surface, and the directory that holds it.
PACKAGES = {
    f"knowledge_layer.{name}": f"packages/knowledge-layer/src/{name}"
    for name in ("browse", "estate", "ingest", "read_passage", "search", "vector_store")
}


def tracked_python(root: Path) -> list[str]:
    """Every Python file git tracks (staged included), so a new file is seen at commit time."""
    out = subprocess.run(["git", "ls-files", "*.py"], cwd=root, capture_output=True, text=True, check=True).stdout
    return [path for path in out.splitlines() if path not in EXCLUDED and (root / path).is_file()]


def surface(root: Path, package: str) -> tuple[set[str], set[str]]:
    """(the names the package exports, its submodules), read from its files without importing it."""
    directory = root / PACKAGES[package]
    submodules = {path.stem for path in directory.glob("*.py") if path.stem != "__init__"}
    init = directory / "__init__.py"
    exported: set[str] = set()
    if init.is_file():
        for node in ast.walk(ast.parse(init.read_text(encoding="utf-8"))):
            if isinstance(node, ast.AnnAssign | ast.Assign) and isinstance(node.value, ast.Dict):
                exported |= {key.value for key in node.value.keys if isinstance(key, ast.Constant)}
    return exported, submodules


def _owner(path: str) -> str | None:
    return next((package for package, directory in PACKAGES.items() if path.startswith(directory + "/")), None)


def _split(dotted: str) -> tuple[str, str] | None:
    """(package, submodule) when ``dotted`` names a submodule path of a listed package."""
    for package in PACKAGES:
        if dotted.startswith(package + "."):
            return package, dotted[len(package) + 1 :].split(".", maxsplit=1)[0]
    return None


STRING = re.compile(r"(?<![\w.])(" + "|".join(re.escape(p) for p in PACKAGES) + r")\.(\w+)")


def references(source: str, path: str, submodules: dict[str, set[str]]) -> list[tuple[str, str, int, list[str]]]:
    """(package, submodule, line, names imported) for each reference ``path`` makes from outside the package."""
    owner = _owner(path)
    found = []
    # One walk, kept: walking the tree is most of this check, and it was walked twice.
    nodes = list(ast.walk(ast.parse(source)))
    # A bare string statement is a docstring: prose about the module, not a use of it.
    prose = {id(node.value) for node in nodes if isinstance(node, ast.Expr)}
    for node in nodes:
        if isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            hit = _split(node.module)
            if hit and hit[0] != owner:
                found.append((*hit, node.lineno, [alias.name for alias in node.names]))
            elif node.module in PACKAGES and node.module != owner:
                found += [
                    (node.module, a.name, node.lineno, []) for a in node.names if a.name in submodules[node.module]
                ]
        elif isinstance(node, ast.Import):
            for alias in node.names:
                hit = _split(alias.name)
                if hit and hit[0] != owner:
                    found.append((*hit, node.lineno, []))
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in prose:
            for match in STRING.finditer(node.value):
                package, name = match.groups()
                if package != owner and name in submodules[package]:
                    found.append((package, name, node.lineno, []))
    return [ref for ref in found if ref[1] in submodules[ref[0]]]


def measure(root: Path, paths: list[str]) -> tuple[dict[str, dict[str, int]], list[str]]:
    """The reference counts per file and submodule, and a hint per import of a name the package exports."""
    surfaces = {package: surface(root, package) for package in PACKAGES}
    submodules = {package: subs for package, (_names, subs) in surfaces.items()}
    counts: dict[str, dict[str, int]] = {}
    hints = []
    for path in paths:
        try:
            refs = references((root / path).read_text(encoding="utf-8"), path, submodules)
        except (SyntaxError, UnicodeDecodeError):
            continue
        for package, submodule, line, names in refs:
            key = f"{package}.{submodule}"
            counts.setdefault(path, {})
            counts[path][key] = counts[path].get(key, 0) + 1
            public = [name for name in names if name in surfaces[package][0]]
            if public and len(public) == len(names):
                hints.append(f"{path}:{line}: `from {package} import {', '.join(public)}`, not from {key}")
    return counts, hints


def load_baseline(path: Path) -> dict[str, dict[str, int]]:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def write_baseline(path: Path, counts: dict[str, dict[str, int]]) -> None:
    data = {file: dict(sorted(refs.items())) for file, refs in sorted(counts.items())}
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def check(current: dict[str, dict[str, int]], baseline: dict[str, dict[str, int]]) -> list[str]:
    """New or grown references, and baseline entries above the tree that should be lowered."""
    findings = []
    for path, refs in sorted(current.items()):
        for key, count in sorted(refs.items()):
            allowed = baseline.get(path, {}).get(key, 0)
            if count > allowed:
                findings.append(f"{path}: {count} reference(s) to {key}, {allowed} allowed. Use the package's surface.")
    for path, refs in sorted(baseline.items()):
        for key, allowed in sorted(refs.items()):
            count = current.get(path, {}).get(key, 0)
            if count < allowed:
                findings.append(f"{path}: {key} down from {allowed} to {count}, so lower its entry (run --update).")
    return findings


def tightened(current: dict[str, dict[str, int]], baseline: dict[str, dict[str, int]]) -> dict[str, dict[str, int]]:
    """The baseline lowered to the tree wherever the tree has fewer; nothing new, nothing raised."""
    lowered: dict[str, dict[str, int]] = {}
    for path, refs in baseline.items():
        kept = {key: min(n, current.get(path, {}).get(key, 0)) for key, n in refs.items()}
        kept = {key: n for key, n in kept.items() if n}
        if kept:
            lowered[path] = kept
    return lowered


def main(argv: list[str] | None = None) -> int:
    """CLI entry point: check (or ratchet) the surface baseline and return an exit code."""
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--update", action="store_true", help="Lower and remove baseline entries; never raise one.")
    mode.add_argument("--rebaseline", action="store_true", help="Record the tree as it is, growth included.")
    args = parser.parse_args(argv)
    if sys.version_info < (3, 14):
        print("check_package_surfaces.py needs Python 3.14: run .venv/bin/python", file=sys.stderr)
        return 2

    root = Path.cwd()
    current, hints = measure(root, tracked_python(root))
    baseline = load_baseline(root / BASELINE)
    total = sum(n for refs in current.values() for n in refs.values())
    if args.rebaseline:
        write_baseline(root / BASELINE, current)
        print(f"Surface baseline rewritten: {total} reference(s) in {len(current)} file(s).")
        return 0
    if args.update:
        baseline = tightened(current, baseline)
        write_baseline(root / BASELINE, baseline)

    findings = check(current, baseline)
    if findings:
        print(f"Package surface check FAILED ({len(findings)} finding(s)):", file=sys.stderr)
        for finding in findings:
            print(f"  - {finding}", file=sys.stderr)
        for hint in hints:
            print(f"  hint: {hint}", file=sys.stderr)
        print("Why: docs/contributing/code-conventions.md#a-package-is-imported-by-its-surface", file=sys.stderr)
        return 1
    print(f"Package surface check passed: {total} submodule reference(s) from outside, held at baseline.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
