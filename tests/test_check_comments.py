from __future__ import annotations

import importlib.util
import json
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def checker():
    spec = importlib.util.spec_from_file_location("check_comments", ROOT / "scripts" / "check_comments.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def repo(tmp_path, monkeypatch):
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    (tmp_path / "ci").mkdir()
    monkeypatch.chdir(tmp_path)
    return tmp_path


def _add(repo: Path, path: str, text: str) -> None:
    target = repo / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    subprocess.run(["git", "add", path], cwd=repo, check=True)


def test_three_lines_are_free_and_the_fourth_fails(checker, repo):
    _add(repo, "src/a.ts", "// one\n// two\n// three\nexport const a = 1\n")
    assert checker.main([]) == 0

    _add(repo, "src/a.ts", "// one\n// two\n// three\n// four\nexport const a = 1\n")
    assert checker.main([]) == 1


def test_a_file_over_the_allowance_may_shrink_but_not_grow(checker, repo):
    _add(repo, "src/b.py", '"""Doc."""\n# a\n# b\n# c\n# d\nX = 1\n')
    assert checker.main(["--rebaseline"]) == 0
    assert json.loads((repo / "ci/comment_baseline.json").read_text()) == {"src/b.py": 5}

    _add(repo, "src/b.py", '"""Doc."""\n# a\n# b\n# c\n# d\n# e\nX = 1\n')
    assert checker.main([]) == 1

    _add(repo, "src/b.py", '"""Doc."""\n# a\n# b\n# c\nX = 1\n')
    assert checker.main([]) == 0
    assert checker.main(["--update"]) == 0
    assert json.loads((repo / "ci/comment_baseline.json").read_text()) == {"src/b.py": 4}


def test_lines_a_tool_reads_do_not_count(checker, repo):
    text = (
        "// eslint-disable-next-line\n// @ts-expect-error x\n/** @type {number} */\n"
        "// @vitest-environment node\nexport const c = 1\n"
    )
    _add(repo, "src/c.ts", text)
    assert checker.main([]) == 0


def test_named_paths_check_only_those_files(checker, repo):
    _add(repo, "src/big.ts", "// 1\n// 2\n// 3\n// 4\n// 5\nexport {}\n")
    _add(repo, "src/clean.ts", "export const d = 1\n")
    assert checker.main(["src/clean.ts"]) == 0
    assert checker.main(["src/big.ts"]) == 1


def test_comment_markers_inside_a_template_literal_are_not_comments(checker, repo):
    _add(repo, "src/t.ts", "export const example = `\n// first\n// second\n// third\n// fourth\n`\n")
    assert checker.measure(repo, ["src/t.ts"]) == {"src/t.ts": 0}
    assert checker.main([]) == 0


def test_a_jsdoc_type_block_counts_as_a_whole(checker, repo):
    text = (
        "/**\n * @typedef {Object} Options\n * @property {string} name\n * @property {number} timeout\n */\nexport {}\n"
    )
    _add(repo, "src/o.js", text)
    assert checker.measure(repo, ["src/o.js"]) == {"src/o.js": 0}
    assert checker.main([]) == 0


@pytest.mark.parametrize(
    "code",
    [
        "import argparse\nargparse.ArgumentParser(description=__doc__)\n",
        "def f():\n    ...\nTEXT = f.__doc__\n",
        "import inspect\nTEXT = inspect.getdoc(len)\n",
        "from inspect import getdoc\nTEXT = getdoc(len)\n",
        'TEXT = getattr(len, "__doc__")\n',
        "from langchain_core.tools import tool\n\n\n@tool\ndef look(page: int) -> str:\n    return ''\n",
        "from langchain_core.tools import tool\n\n\n@tool('look')\ndef look(page: int) -> str:\n    return ''\n",
        "from langchain_core.tools import StructuredTool\n\nT = StructuredTool.from_function(func=len, name='n')\n",
    ],
)
def test_reading_a_docstring_fails_and_names_the_explicit_field(checker, repo, capsys, code):
    _add(repo, "tool.py", code)

    assert checker.main([]) == 1
    assert "json_schema_extra" in capsys.readouterr().err


def test_setting_an_explicit_description_passes(checker, repo):
    _add(repo, "tool.py", 'import argparse\nargparse.ArgumentParser(description="Checks the tree.")\n')
    _add(repo, "look.py", '@tool(description="Looks.")\ndef look(page: int) -> str:\n    return ""\n')

    assert checker.main([]) == 0
