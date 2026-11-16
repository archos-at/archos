"""Comment and docstring purge for Python; the rule: docs/contributing/code-conventions.md#comments."""

from __future__ import annotations

import ast
import io
import sys
import tokenize
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_comments import DIRECTIVE  # noqa: E402

BEHAVIOUR = ("__doc__", "@tool", "from_function", "FunctionInfo")


def _docstring_spans(tree: ast.Module) -> list[tuple[int, int, bool, int]]:
    spans = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef):
            continue
        body = node.body
        first = body[0] if body else None
        if not (isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant)):
            continue
        if not isinstance(first.value.value, str):
            continue
        shares_line = not isinstance(node, ast.Module) and first.lineno == node.lineno
        followed = len(body) > 1 and body[1].lineno == first.end_lineno
        if shares_line or followed:
            continue
        sole = len(body) == 1 and not isinstance(node, ast.Module)
        spans.append((first.lineno, first.end_lineno or first.lineno, sole, first.col_offset))
    return spans


def _comment_lines(source: str) -> set[int]:
    found = set()
    for token in tokenize.generate_tokens(io.StringIO(source).readline):
        if token.type != tokenize.COMMENT or token.line[: token.start[1]].strip():
            continue
        if token.start[0] == 1 and token.string.startswith("#!"):
            continue
        if not DIRECTIVE.search(token.string):
            found.add(token.start[0])
    return found


def purge(path: Path) -> int:
    source = path.read_text(encoding="utf-8")
    if any(marker in source for marker in BEHAVIOUR):
        return 0
    try:
        tree = ast.parse(source)
        remove = _comment_lines(source)
    except SyntaxError, tokenize.TokenError, IndentationError:
        return 0
    lines = source.split("\n")
    replace: dict[int, str] = {}
    for start, end, sole, col in _docstring_spans(tree):
        remove.update(range(start, end + 1))
        if sole:
            replace[start] = " " * col + "..."
    if not remove:
        return 0
    out = []
    for number, row in enumerate(lines, start=1):
        if number in replace:
            out.append(replace[number])
        elif number not in remove:
            out.append(row)
    while out and not out[0].strip():
        out.pop(0)
    path.write_text("\n".join(out), encoding="utf-8")
    return len(remove) - len(replace)


def main(argv: list[str]) -> int:
    total = sum(purge(Path(p)) for p in argv if p.endswith(".py"))
    print(f"purged {total} comment line(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
