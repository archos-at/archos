#!/usr/bin/env python3


from __future__ import annotations

import argparse
import ast
import functools
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tree_sitter_javascript  # noqa: E402
import tree_sitter_typescript  # noqa: E402
import yaml  # noqa: E402
from check_file_size import comment_lines  # noqa: E402
from tree_sitter import Language  # noqa: E402
from tree_sitter import Node  # noqa: E402
from tree_sitter import Parser  # noqa: E402

BASELINE = Path("ci/comment_baseline.json")
FREE = 3
CONFIG_SUFFIXES = (".yml", ".yaml", ".toml")
SUFFIXES = (".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", *CONFIG_SUFFIXES)
EXCLUDED = re.compile(
    "|".join(
        (
            r"\.generated\.",
            r"^apps/workspace/shared/cards/generated\.ts$",
            r"^apps/cms/src/payload-types\.ts$",
            r"^apps/cms/src/app/\(payload\)/",
            r"^apps/workspace/bff/skills/platform-skills\.ts$",
            r"\.d\.ts$",
            r"(^|/)migrations/",
            r"(^|/)drizzle/",
            r"^packages/agent/src/agent/skills/review/skill-check/",
        )
    )
)
DIRECTIVE = re.compile(
    r"noqa|type:\s*ignore|ty:\s*ignore|nosemgrep|nosec\b|NOSONAR|isort:|@deprecated|pragma|pyright:|mypy:|fmt:\s*(off|on|skip)|ruff:|"
    r"eslint-|oxlint-|biome-ignore|prettier-ignore|@ts-(expect-error|ignore|nocheck|check)|"
    r"istanbul ignore|c8 ignore|v8 ignore|@vitest-environment|@jest-environment|@disk-inputs|drop after release|"
    r"@type\s*\{|@typedef|@param\s*\{|@returns?\s*\{|@template|@satisfies|@import|"
    r"webpack[A-Z]|@vite-ignore|/// <reference|#!|-\*- coding|@license|@preserve|"
    r"yaml-language-server:|yamllint |zizmor:|shellcheck |actionlint|gitleaks:allow|trivy:ignore|checkov:skip"
)
MESSAGE = (
    "Fix the code instead of explaining it: a clearer name, a smaller function, a check whose "
    "message names the rule. Keep only a dated measurement, a vendor bug link or a legal "
    "constraint, and pay for it by deleting another comment. "
    "docs/contributing/code-conventions.md#comments"
)


def is_checked(path: str) -> bool:
    return path.endswith(SUFFIXES) and not EXCLUDED.search(path)


def tracked_sources(root: Path) -> list[str]:
    out = subprocess.run(["git", "ls-files"], cwd=root, capture_output=True, text=True, check=True).stdout
    return [path for path in out.splitlines() if is_checked(path) and (root / path).is_file()]


def script_metadata_lines(source: str) -> set[int]:
    found, inside = set(), False
    for number, row in enumerate(source.split("\n"), start=1):
        if row.strip() == "# /// script":
            inside = True
        if inside:
            found.add(number)
        if inside and row.strip() == "# ///":
            inside = False
    return found


def prose_comment_count(path: str, source: str) -> int:
    rows = source.split("\n")
    kept = script_metadata_lines(source)
    return sum(
        1 for number in comment_lines(path, source) if number not in kept and not DIRECTIVE.search(rows[number - 1])
    )


@functools.cache
def _parser(kind: str) -> Parser:
    grammars = {
        "tsx": tree_sitter_typescript.language_tsx,
        "ts": tree_sitter_typescript.language_typescript,
        "js": tree_sitter_javascript.language,
    }
    return Parser(Language(grammars[kind]()))


def _kind(path: str) -> str:
    return "tsx" if path.endswith(".tsx") else "ts" if path.endswith(".ts") else "js"


def _comment_nodes(node: Node) -> list[Node]:
    found, stack = [], [node]
    while stack:
        current = stack.pop()
        if current.type == "comment":
            found.append(current)
        stack.extend(current.children)
    return found


def script_prose_lines(path: str, source: bytes) -> int:
    rows = source.split(b"\n")
    lines: set[int] = set()
    for comment in _comment_nodes(_parser(_kind(path)).parse(source).root_node):
        text = source[comment.start_byte : comment.end_byte].decode("utf-8", "replace")
        (first, start_col), (last, end_col) = comment.start_point, comment.end_point
        alone = not rows[first][:start_col].strip() and not rows[last][end_col:].strip()
        if alone and not DIRECTIVE.search(text):
            lines.update(range(first, last + 1))
    return len(lines)


def _yaml_string_lines(source: str) -> set[int]:
    rows = source.split("\n")
    try:
        tokens = [token for token in yaml.scan(source, Loader=yaml.SafeLoader) if isinstance(token, yaml.ScalarToken)]
    except yaml.YAMLError:
        return set()
    lines: set[int] = set()
    for token in tokens:
        start, end = token.start_mark, token.end_mark
        last = end.line + 1 if rows[end.line][: end.column].strip() else end.line
        lines.update(range(start.line + 2, last + 1))
    return lines


def _toml_string_lines(source: str) -> set[int]:
    lines, quote = set(), None
    for number, row in enumerate(source.split("\n"), start=1):
        if quote:
            lines.add(number)
        for found in re.findall(r'"""|\'\'\'', row):
            quote = None if quote == found else quote or found
    return lines


def config_prose_lines(path: str, source: str) -> int:
    inside = _toml_string_lines(source) if path.endswith(".toml") else _yaml_string_lines(source)
    return sum(
        1
        for number, row in enumerate(source.split("\n"), start=1)
        if row.lstrip().startswith("#") and number not in inside and not DIRECTIVE.search(row)
    )


def measure(root: Path, paths: list[str]) -> dict[str, int]:
    counts = {}
    for path in paths:
        if path.endswith(".py"):
            counts[path] = prose_comment_count(path, (root / path).read_text(encoding="utf-8", errors="replace"))
        elif path.endswith(CONFIG_SUFFIXES):
            counts[path] = config_prose_lines(path, (root / path).read_text(encoding="utf-8", errors="replace"))
        else:
            counts[path] = script_prose_lines(path, (root / path).read_bytes())
    return counts


DOC_READ = (
    "reads a docstring, and docstrings are purged: give the text an explicit field, `description=` on a tool or "
    "an argparse parser, a `*_DESCRIPTION` constant, `Field(description=...)`, or "
    '`model_config = ConfigDict(json_schema_extra={"description": ...})` on a schema.'
)


def _bare_tool(decorator: ast.expr) -> bool:
    if isinstance(decorator, ast.Name):
        return decorator.id == "tool"
    named = isinstance(decorator, ast.Call) and getattr(decorator.func, "id", "") == "tool"
    return named and not any(keyword.arg == "description" for keyword in decorator.keywords)


def docstring_reads(path: str, source: str) -> list[str]:
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []
    lines = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and node.attr == "__doc__" and isinstance(node.ctx, ast.Load):
            lines.add(node.lineno)
        elif isinstance(node, ast.Name) and node.id == "__doc__" and isinstance(node.ctx, ast.Load):
            lines.add(node.lineno)
        elif isinstance(node, ast.Attribute) and node.attr == "getdoc":
            lines.add(node.lineno)
        elif isinstance(node, ast.Name) and node.id == "getdoc":
            lines.add(node.lineno)
        elif isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            lines.update(d.lineno for d in node.decorator_list if _bare_tool(d))
        elif isinstance(node, ast.Call) and getattr(node.func, "attr", "") == "from_function":
            if not any(keyword.arg == "description" for keyword in node.keywords):
                lines.add(node.lineno)
        elif isinstance(node, ast.Call) and getattr(node.func, "id", "") == "getattr" and len(node.args) > 1:
            if isinstance(node.args[1], ast.Constant) and node.args[1].value == "__doc__":
                lines.add(node.lineno)
    return [f"{path}:{line}: {DOC_READ}" for line in sorted(lines)]


def check(current: dict[str, int], baseline: dict[str, int]) -> list[str]:
    findings = []
    for path, count in sorted(current.items()):
        allowed = max(baseline.get(path, 0), FREE)
        if count > allowed:
            findings.append(f"{path}: {count} comment line(s), {allowed} allowed.")
    for path, allowed in sorted(baseline.items()):
        if path in current and current[path] < allowed and allowed > FREE:
            findings.append(
                f"{path}: down from {allowed} to {current.get(path, 0)}, so lower its entry (run --update)."
            )
    return findings


def tightened(current: dict[str, int], baseline: dict[str, int]) -> dict[str, int]:
    lowered = {path: min(allowed, current.get(path, 0)) for path, allowed in baseline.items()}
    return {path: count for path, count in lowered.items() if count > FREE}


def write_baseline(path: Path, counts: dict[str, int]) -> None:
    path.write_text(json.dumps(dict(sorted(counts.items())), indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Comment-line ratchet.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--update", action="store_true", help="Lower and remove entries; never raise or add one.")
    mode.add_argument("--rebaseline", action="store_true", help="Rewrite the baseline from the tree.")
    parser.add_argument("paths", nargs="*", help="Check only these files (pre-commit passes the staged ones).")
    args = parser.parse_args(argv)

    root = Path.cwd()
    if args.paths and not (args.update or args.rebaseline):
        current = measure(root, [p for p in args.paths if is_checked(p) and (root / p).is_file()])
    else:
        current = measure(root, tracked_sources(root))
    if args.rebaseline:
        write_baseline(root / BASELINE, {path: count for path, count in current.items() if count > FREE})
        print(f"Wrote {BASELINE}: {sum(current.values())} comment line(s).")
        return 0
    baseline = json.loads((root / BASELINE).read_text(encoding="utf-8")) if (root / BASELINE).exists() else {}
    if args.update:
        baseline = tightened(current, baseline)
        write_baseline(root / BASELINE, baseline)

    findings = check(current, baseline)
    for path in current:
        if path.endswith(".py"):
            findings += docstring_reads(path, (root / path).read_text(encoding="utf-8", errors="replace"))
    slack = [f for f in findings if "so lower its" in f]
    findings = [f for f in findings if f not in slack]
    if findings:
        print(f"Comment check FAILED ({len(findings)} finding(s)):", file=sys.stderr)
        for finding in findings:
            print(f"  - {finding}", file=sys.stderr)
        print(MESSAGE, file=sys.stderr)
        return 1
    over = sum(1 for count in current.values() if count > FREE)
    print(f"Comment check passed: {sum(current.values())} comment line(s); {over} file(s) over {FREE}, none grown.")
    if slack:
        print(
            f"  {len(slack)} baseline entr{'y' if len(slack) == 1 else 'ies'} can be lowered: `task baselines:tighten`."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
