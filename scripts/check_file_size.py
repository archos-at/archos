#!/usr/bin/env python3


from __future__ import annotations

import argparse
import ast
import functools
import io
import json
import re
import subprocess
import sys
import tokenize
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path

FILE_LIMIT = 600
FUNCTION_LIMIT = 60
BASELINE = Path("ci/size_baseline.json")
SUFFIXES = (".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")

EXCLUDED = re.compile(
    "|".join(
        (
            r"^apps/workspace/shared/cards/generated\.ts$",  # card schemas, rendered from cards/models.py
            r"\.generated\.",  # wire-v2.generated.ts and its kind
            r"^apps/cms/src/payload-types\.ts$",
            r"^apps/cms/src/app/\(payload\)/admin/importMap\.js$",
            r"\.d\.ts$",  # type declarations
            r"(^|/)(tests?|testing|__tests__|e2e|_?fixtures|__fixtures__|test-utils)/",  # suites, their support, data
            r"(^|/)i18n/dictionaries/",  # copy: its length is the copy's
            r"(^|/)(test_[^/]*|[^/]*_test|conftest)\.py$",
            r"\.(spec|test)\.[cm]?[jt]sx?$",
            r"(^|/)migrations/",  # Alembic and Drizzle history, written once
        )
    )
)


@dataclass
class Sizes:
    files: dict[str, int] = field(default_factory=dict)
    functions: dict[str, int] = field(default_factory=dict)


def is_checked(path: str) -> bool:
    return path.endswith(SUFFIXES) and not EXCLUDED.search(path)


def tracked_sources(root: Path) -> list[str]:
    out = subprocess.run(["git", "ls-files"], cwd=root, capture_output=True, text=True, check=True).stdout
    return [path for path in out.splitlines() if is_checked(path) and (root / path).is_file()]


@functools.lru_cache(maxsize=1)
def _parsed(source: str) -> ast.Module:
    return ast.parse(source)


def function_lengths(source: str) -> dict[str, int]:
    lengths: dict[str, int] = {}
    seen: dict[str, int] = {}

    def visit(node: ast.AST, prefix: str) -> None:
        for child in ast.iter_child_nodes(node):
            if not isinstance(child, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
                visit(child, prefix)
                continue
            name = f"{prefix}{child.name}"
            seen[name] = seen.get(name, 0) + 1
            if seen[name] > 1:
                name = f"{name}#{seen[name]}"
            if not isinstance(child, ast.ClassDef):
                lengths[name] = (child.end_lineno or child.lineno) - child.lineno + 1 - len(_docstring_lines(child))
            visit(child, f"{name}.")

    visit(_parsed(source), "")
    return lengths


TS_IMPORT = re.compile(
    r"^[ \t]*"
    r"(?:import(?:\s+type)?\s+[^'\"`;()]*?\sfrom\s*"  # import x from, import { a } from
    r"|import\s*"  # import 'side-effect'
    r"|export(?:\s+type)?\s*(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*)"  # export * / { a } from
    r"['\"][^'\"\n]+['\"];?[ \t]*$",
    re.M,
)


def import_lines(path: str, source: str) -> set[int]:
    if path.endswith(".py"):
        try:
            tree = _parsed(source)
        except SyntaxError:
            return set()
        return {
            line
            for node in ast.walk(tree)
            if isinstance(node, ast.Import | ast.ImportFrom)
            for line in range(node.lineno, (node.end_lineno or node.lineno) + 1)
        }
    covered: set[int] = set()
    for match in TS_IMPORT.finditer(source):
        first = source.count("\n", 0, match.start()) + 1
        covered.update(range(first, first + match.group(0).count("\n") + 1))
    return covered


def _docstring_lines(node: ast.AST) -> set[int]:
    body = getattr(node, "body", None)
    if not body or not isinstance(body[0], ast.Expr):
        return set()
    value = body[0].value
    if not isinstance(value, ast.Constant) or not isinstance(value.value, str):
        return set()
    return set(range(value.lineno, (value.end_lineno or value.lineno) + 1))


def _python_comment_lines(source: str) -> set[int]:
    try:
        tree = _parsed(source)
    except SyntaxError:
        return set()
    covered: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef):
            covered |= _docstring_lines(node)
    for token in tokenize.generate_tokens(io.StringIO(source).readline):
        if token.type == tokenize.COMMENT and not token.line[: token.start[1]].strip():
            covered.add(token.start[0])
    return covered


def _script_comment_lines(source: str) -> set[int]:
    covered: set[int] = set()
    in_block = False
    for number, row in enumerate(source.split("\n"), start=1):
        text = row.strip()
        if in_block:
            _, _, rest = text.partition("*/")
            in_block = "*/" not in text
            if in_block or not rest.strip():
                covered.add(number)
            continue
        if text.startswith("//"):
            covered.add(number)
        elif text.startswith("/*"):
            _, closes, rest = text[2:].partition("*/")
            in_block = not closes
            if in_block or not rest.strip():
                covered.add(number)
    return covered


def comment_lines(path: str, source: str) -> set[int]:
    if path.endswith(".py"):
        try:
            return _python_comment_lines(source)
        except (tokenize.TokenError, IndentationError):
            return set()
    return _script_comment_lines(source)


def counted_lines(path: str, source: str) -> int:
    rows = source.split("\n")
    if rows and rows[-1] == "":
        rows.pop()  # the newline that ends the last line opens no line of its own
    imports = import_lines(path, source)
    skipped = set(imports) | {line for line in comment_lines(path, source) if line <= len(rows)}
    previous_code = 0  # the last non-blank line seen, 0 before the first
    blanks: list[int] = []
    for number, row in enumerate(rows, start=1):
        if not row.strip():
            blanks.append(number)
            continue
        if number in imports and previous_code in imports:
            skipped.update(blanks)
        blanks = []
        previous_code = number
    return len(rows) - len(skipped)


def measure(root: Path, paths: list[str]) -> Sizes:
    sizes = Sizes()
    for path in paths:
        source = (root / path).read_text(encoding="utf-8", errors="replace")
        lines = counted_lines(path, source)
        if lines > FILE_LIMIT:
            sizes.files[path] = lines
        if not path.endswith(".py"):
            continue
        try:
            spans = function_lengths(source)
        except SyntaxError:
            continue  # ruff reports it; a size is meaningless for a file that does not parse
        for name, span in spans.items():
            if span > FUNCTION_LIMIT:
                sizes.functions[f"{path}::{name}"] = span
    return sizes


def load_baseline(path: Path) -> Sizes:
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    return Sizes(files=data.get("files", {}), functions=data.get("functions", {}))


def write_baseline(path: Path, sizes: Sizes) -> None:
    data = {"files": dict(sorted(sizes.files.items())), "functions": dict(sorted(sizes.functions.items()))}
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def compare(current: dict[str, int], baseline: dict[str, int], limit: int, what: str) -> list[str]:
    findings = []
    for key, size in sorted(current.items()):
        allowed = baseline.get(key)
        if allowed is None:
            findings.append(f"{key}: {size} lines, over the {limit}-line {what} limit. Split it.")
        elif size > allowed:
            findings.append(f"{key}: grew from {allowed} to {size} lines. Split it, do not grow it.")
    for key, allowed in sorted(baseline.items()):
        size = current.get(key)
        if size is None:
            findings.append(f"{key}: under the limit or gone, so remove its baseline entry (run --update).")
        elif size < allowed:
            findings.append(f"{key}: down from {allowed} to {size} lines, so lower its baseline entry (run --update).")
    return findings


def check(current: Sizes, baseline: Sizes) -> list[str]:
    return compare(current.files, baseline.files, FILE_LIMIT, "file") + compare(
        current.functions, baseline.functions, FUNCTION_LIMIT, "function"
    )


def tightened(current: Sizes, baseline: Sizes) -> Sizes:

    def lower(now: dict[str, int], then: dict[str, int]) -> dict[str, int]:
        return {key: min(size, now[key]) for key, size in then.items() if key in now}

    return Sizes(files=lower(current.files, baseline.files), functions=lower(current.functions, baseline.functions))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Keep giant source files and giant Python functions from being added or growing.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--update", action="store_true", help="Lower and remove baseline entries; never raise one.")
    mode.add_argument("--rebaseline", action="store_true", help="Record the tree as it is, growth included.")
    args = parser.parse_args(argv)
    if sys.version_info < (3, 14):
        print("check_file_size.py needs Python 3.14: run .venv/bin/python scripts/check_file_size.py", file=sys.stderr)
        return 2

    root = Path.cwd()
    current = measure(root, tracked_sources(root))
    baseline = load_baseline(root / BASELINE)
    if args.rebaseline:
        write_baseline(root / BASELINE, current)
        print(f"Size baseline rewritten: {len(current.files)} file(s), {len(current.functions)} function(s).")
        return 0
    if args.update:
        baseline = tightened(current, baseline)
        write_baseline(root / BASELINE, baseline)

    findings = check(current, baseline)
    slack = [f for f in findings if "so lower its" in f or "remove its baseline entry" in f]
    findings = [f for f in findings if f not in slack]
    if findings:
        print(f"Size check FAILED ({len(findings)} finding(s)):", file=sys.stderr)
        for finding in findings:
            print(f"  - {finding}", file=sys.stderr)
        print("Why and how to split: docs/contributing/code-conventions.md#size-limits", file=sys.stderr)
        return 1

    print(
        f"Size check passed: {len(baseline.files)} file(s) and {len(baseline.functions)} function(s) held at baseline."
    )
    if slack:
        print(
            f"  {len(slack)} baseline entr{'y' if len(slack) == 1 else 'ies'} can be lowered: `task baselines:tighten`."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
