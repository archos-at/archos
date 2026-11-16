from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _purge(tmp_path: Path, name: str, text: str) -> str:
    target = tmp_path / name
    target.write_text(text, encoding="utf-8")
    script = ["node", str(ROOT / "scripts/purge_comments.mjs")]
    if name.endswith(".py"):
        script = [sys.executable, str(ROOT / "scripts/purge_comments.py")]
    subprocess.run([*script, str(target)], check=True, capture_output=True)
    return target.read_text(encoding="utf-8")


def test_a_multiline_comment_that_is_a_block_only_content_stays_whole(tmp_path):
    out = _purge(tmp_path, "a.ts", "function f() {\n  /* one\n   * two\n   */\n}\n// gone\nexport const g = 1\n")
    assert "/* one\n   * two\n   */" in out
    assert "// gone" not in out


def test_template_literals_and_directives_are_untouched(tmp_path):
    text = "// @ts-expect-error x\nexport const t = `\n// not a comment\n`\n"
    assert _purge(tmp_path, "b.ts", text) == text


def test_a_docstring_sharing_a_line_with_code_is_kept(tmp_path):
    text = 'def f(): """x"""\n\n\ndef g(\n): """y"""\n\n\n"""Doc."""; X = 1\n'
    out = _purge(tmp_path, "c.py", text)
    ast.parse(out)
    assert out == text


def test_a_docstring_only_body_becomes_an_ellipsis(tmp_path):
    out = _purge(tmp_path, "d.py", 'def f():\n    """Only."""\n\n\nclass C:\n    """Doc."""\n    X = 1\n')
    ast.parse(out)
    assert "    ..." in out and '"""' not in out and "X = 1" in out
