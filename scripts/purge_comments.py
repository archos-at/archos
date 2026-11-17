"""Comment and docstring purge for Python, TypeScript and JavaScript; the rule: code-conventions.md#comments."""

from __future__ import annotations

import ast
import io
import re
import sys
import tokenize
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_comments import DIRECTIVE  # noqa: E402
from check_comments import _comment_nodes  # noqa: E402
from check_comments import _kind  # noqa: E402
from check_comments import _parser  # noqa: E402
from check_comments import script_metadata_lines  # noqa: E402

MODEL_FACING = re.compile(
    r"__doc__|getdoc|@tool|\.tool\(|from_function|FunctionInfo|StructuredTool|BaseModel|TypedDict|"
    r"\btyper\b|\bclick\b|APIRouter|FastAPI|@\w+\.(get|post|put|patch|delete)\("
)


def _docstring_spans(tree: ast.Module, lines: list[str]) -> list[tuple[int, int, bool, int]]:
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
        end = first.end_lineno or first.lineno
        before = lines[first.lineno - 1].encode("utf-8")[: first.col_offset]
        after = lines[end - 1].encode("utf-8")[first.end_col_offset or 0 :]
        if before.strip() or after.strip():
            continue
        sole = len(body) == 1 and not isinstance(node, ast.Module)
        spans.append((first.lineno, end, sole, first.col_offset))
    return spans


def _comment_lines(source: str) -> set[int]:
    found: set[int] = set()
    kept = script_metadata_lines(source)
    for token in tokenize.generate_tokens(io.StringIO(source).readline):
        if token.type != tokenize.COMMENT or token.line[: token.start[1]].strip():
            continue
        if token.start[0] == 1 and token.string.startswith("#!"):
            continue
        if token.start[0] not in kept and not DIRECTIVE.search(token.string):
            found.add(token.start[0])
    return found


def purge(path: Path) -> int:
    source = path.read_text(encoding="utf-8")
    lines = source.split("\n")
    try:
        tree = ast.parse(source)
        remove = _comment_lines(source)
    except SyntaxError, tokenize.TokenError, IndentationError:
        return 0
    replace: dict[int, str] = {}
    spans = [] if MODEL_FACING.search(source) else _docstring_spans(tree, lines)
    for start, end, sole, col in spans:
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


def _script_groups(path: Path, source: bytes, rows: list[bytes]) -> list[tuple[int, int]]:
    plain_js = path.suffix in {".js", ".jsx", ".mjs", ".cjs"}
    groups = []
    for comment in _comment_nodes(_parser(_kind(str(path))).parse(source).root_node):
        text = source[comment.start_byte : comment.end_byte].decode("utf-8", "replace")
        (first, start_col), (last, end_col) = comment.start_point, comment.end_point
        alone = not rows[first][:start_col].strip() and not rows[last][end_col:].strip()
        if alone and not DIRECTIVE.search(text) and not (plain_js and text.startswith("/**")):
            groups.append((first, last))
    return groups


def _sole_block_content(rows: list[bytes], remove: set[int], first: int, last: int) -> bool:
    prev = first - 1
    while prev >= 0 and (prev in remove or not rows[prev].strip()):
        prev -= 1
    nxt = last + 1
    while nxt < len(rows) and (nxt in remove or not rows[nxt].strip()):
        nxt += 1
    opens = prev >= 0 and rows[prev].rstrip().endswith((b"{", b"("))
    closes = nxt < len(rows) and rows[nxt].lstrip().startswith((b"}", b")"))
    return opens and closes


def purge_script(path: Path) -> int:
    source = path.read_bytes()
    rows = source.split(b"\n")
    groups = _script_groups(path, source, rows)
    remove = {n for first, last in groups for n in range(first, last + 1)}
    for first, last in groups:
        if _sole_block_content(rows, remove, first, last):
            remove.difference_update(range(first, last + 1))
    if not remove:
        return 0
    out: list[bytes] = []
    for n, row in enumerate(rows):
        if n in remove:
            continue
        if not row.strip() and out and not out[-1].strip() and n - 1 in remove:
            continue
        out.append(row)
    while len(out) > 1 and not out[0].strip() and 0 in remove:
        out.pop(0)
    path.write_bytes(b"\n".join(out))
    return len(remove)


def main(argv: list[str]) -> int:
    scripts = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")
    total = sum(purge(Path(p)) for p in argv if p.endswith(".py"))
    total += sum(purge_script(Path(p)) for p in argv if p.endswith(scripts) and not p.endswith(".d.ts"))
    print(f"purged {total} comment line(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
