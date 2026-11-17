from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _purge(tmp_path: Path, name: str, text: str) -> str:
    target = tmp_path / name
    target.write_text(text, encoding="utf-8")
    subprocess.run(
        [sys.executable, str(ROOT / "scripts/purge_comments.py"), str(target)], check=True, capture_output=True
    )
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


def test_a_module_docstring_sharing_its_line_keeps_the_code_after_it(tmp_path):
    for text in ['"""Doc."""; X = 1\n', '"""\U0001f407\U0001f407\U0001f407"""; X = 1\n']:
        out = _purge(tmp_path, "e.py", text)
        assert out == text


def test_a_model_facing_file_loses_its_docstrings_too(tmp_path):
    text = (
        'from pydantic import BaseModel\n\n\nclass Answer(BaseModel):\n    """Shown to nobody."""\n'
        "\n    # gone\n    text: str\n"
    )
    out = _purge(tmp_path, "f.py", text)
    assert '"""' not in out and "# gone" not in out and "text: str" in out


def test_linter_directives_survive(tmp_path):
    text = "x = 1  # noqa\n# nosemgrep: rule.id\ny = 2\n# ty: ignore[x]\nz = 3\n"
    assert _purge(tmp_path, "g.py", text) == text


def test_inline_script_metadata_survives(tmp_path):
    text = '#!/usr/bin/env python3\n# /// script\n# dependencies = ["x==1"]\n# ///\n# gone\nX = 1\n'
    out = _purge(tmp_path, "h.py", text)
    assert '# dependencies = ["x==1"]' in out and "# ///" in out and "# gone" not in out


def test_a_docstring_marker_of_a_legacy_module_becomes_a_comment(tmp_path):
    out = _purge(tmp_path, "g.py", '"""Old names: drop after release 2026-W48."""\n\nOLD = "x"\n')
    assert out.startswith("# drop after release 2026-W48\n") and '"""' not in out
