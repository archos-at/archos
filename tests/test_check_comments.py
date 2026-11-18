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


def _config(path: str, comments: str) -> str:
    return comments + ("key = 1\n" if path.endswith(".toml") else "key: 1\n")


@pytest.mark.parametrize("path", ["config.yml", "deploy/stack.yaml", "pyproject.toml"])
def test_config_files_get_three_free_lines_and_no_fourth(checker, repo, path):
    _add(repo, path, _config(path, "# one\n# two\n  # three\n"))
    assert checker.main([]) == 0

    _add(repo, path, _config(path, "# one\n# two\n# three\n# four\n"))
    assert checker.main([]) == 1


def test_a_yaml_file_over_the_allowance_may_shrink_but_not_grow(checker, repo):
    _add(repo, "ci.yml", "# a\n# b\n# c\n# d\non: push\n")
    assert checker.main(["--rebaseline"]) == 0
    assert json.loads((repo / "ci/comment_baseline.json").read_text()) == {"ci.yml": 4}

    _add(repo, "ci.yml", "# a\n# b\n# c\n# d\n# e\non: push\n")
    assert checker.main(["ci.yml"]) == 1

    _add(repo, "ci.yml", "# a\non: push\n")
    assert checker.main(["--update"]) == 0
    assert json.loads((repo / "ci/comment_baseline.json").read_text()) == {}


def test_a_hash_inside_a_yaml_string_or_after_a_value_is_no_comment_line(checker, repo):
    text = (
        "run: |\n  # a shell comment is the string's content\n  # second\n  echo\n"
        'quoted: "first\n  # still the string"\n'
        "plain: value  # trailing\n"
        "# counted\n"
    )
    _add(repo, "w.yml", text)
    assert checker.measure(repo, ["w.yml"]) == {"w.yml": 1}


def test_a_hash_inside_a_toml_multiline_string_is_no_comment_line(checker, repo):
    text = (
        'script = """\n# content\n# more\n"""\n'
        "literal = '''\n# content\n'''\n"
        'url = "a#b"  # trailing\n# counted\n'
    )
    _add(repo, "p.toml", text)
    assert checker.measure(repo, ["p.toml"]) == {"p.toml": 1}


def test_config_lines_a_tool_reads_do_not_count(checker, repo):
    text = (
        "# yaml-language-server: $schema=https://example.org/schema.json\n"
        "#!/usr/bin/env yq\n# nosemgrep: rule\n# zizmor: ignore[artipacked]\n"
        "token: abc  # pragma: allowlist secret\nkey: 1\n"
    )
    _add(repo, "t.yaml", text)
    assert checker.measure(repo, ["t.yaml"]) == {"t.yaml": 0}


def test_unparsable_yaml_counts_comment_lines_outside_a_block_scalar(checker, repo):
    _add(repo, "bad.yaml", "# one\nkey: @invalid\nrun: |\n  # shell\n\n  echo\n# two\n")
    assert checker.measure(repo, ["bad.yaml"]) == {"bad.yaml": 2}


def test_a_separation_tab_the_scanner_rejects_is_read_as_a_space(checker, repo):
    _add(repo, "tab.yaml", "key:\tvalue\nrun: |\n  # shell\n# counted\n")
    assert checker.measure(repo, ["tab.yaml"]) == {"tab.yaml": 1}


def test_a_comment_that_names_a_tool_is_still_prose(checker, repo):
    text = (
        "# Run actionlint before merging.\n# yamllint is strict here.\n# shellcheck runs in CI.\n"
        "# zizmor: ignore[x]\nk: 1\n"
    )
    _add(repo, "w.yml", text)
    assert checker.measure(repo, ["w.yml"]) == {"w.yml": 3}


def test_the_area_line_is_free_only_in_a_release_note(checker, repo):
    text = "---\n# area: projects\nfeatures:\n  - x\n"
    _add(repo, "releasenotes/notes/a-0123456789abcdef.yaml", text)
    _add(repo, "other/a.yaml", text)
    assert checker.measure(repo, ["releasenotes/notes/a-0123456789abcdef.yaml", "other/a.yaml"]) == {
        "releasenotes/notes/a-0123456789abcdef.yaml": 0,
        "other/a.yaml": 1,
    }


def test_a_byte_order_mark_does_not_hide_the_first_comment(checker, repo):
    _add(repo, "bom.yaml", "\ufeff# one\nrun: |\n  # shell\nk: 1\n")
    assert checker.measure(repo, ["bom.yaml"]) == {"bom.yaml": 1}


def test_lines_break_where_the_yaml_scanner_breaks_them(checker, repo):
    _add(repo, "ls.yaml", "a: 1\u2028b: 2\u2028c: |\n  # shell\n# counted\u2028# also\n")
    assert checker.measure(repo, ["ls.yaml"]) == {"ls.yaml": 2}


def test_toml_quotes_in_a_comment_or_a_one_line_string_open_nothing(checker, repo):
    text = (
        '# a """ in a comment\n'
        'literal = \'a """ b\'\n'
        'basic = "say \\"\\"\\" here"\n'
        "# counted\n"
        'script = """\n# content \\"""\n"""\n'
        "# counted too\n"
    )
    _add(repo, "q.toml", text)
    assert checker.measure(repo, ["q.toml"]) == {"q.toml": 3}
