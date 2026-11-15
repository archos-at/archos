"""Relative links in any tracked Markdown file resolve against git, not the disk.

A link into a gitignored directory resolves on the author's machine, where
`task setup` created it, and is dead in CI's fresh checkout.
`scripts/check_agent_docs.py` checks every tracked `.md` against `git ls-files`.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def checker():
    spec = importlib.util.spec_from_file_location("check_agent_docs", ROOT / "scripts" / "check_agent_docs.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def errors_for(checker, tmp_path, monkeypatch, text: str, tracked: set[str]) -> list[str]:
    monkeypatch.chdir(tmp_path)
    doc = tmp_path / "docs" / "guide.md"
    doc.parent.mkdir(parents=True, exist_ok=True)
    doc.write_text(text, encoding="utf-8")
    errors: list[str] = []
    checker.check_links(Path("docs/guide.md"), tracked | {"docs/guide.md"}, errors)
    return errors


def test_a_link_to_a_file_on_disk_but_not_in_git_is_dead(checker, tmp_path, monkeypatch):
    (tmp_path / "docs" / "local.md").parent.mkdir(parents=True)
    (tmp_path / "docs" / "local.md").write_text("only here")

    errors = errors_for(checker, tmp_path, monkeypatch, "[x](local.md)", tracked=set())

    assert errors and "not tracked by git" in errors[0]


def test_a_link_into_a_generated_directory_is_dead(checker, tmp_path, monkeypatch):
    errors = errors_for(checker, tmp_path, monkeypatch, "[x](../.claude/skills/a/SKILL.md)", tracked=set())

    assert errors and "generated directory" in errors[0]


def test_a_tracked_target_and_a_placeholder_pass(checker, tmp_path, monkeypatch):
    text = "[x](other.md#part) [y](references/<topic>.md) [z](https://example.com/a.md)"

    assert errors_for(checker, tmp_path, monkeypatch, text, tracked={"docs/other.md"}) == []


def test_every_tracked_markdown_file_is_checked_but_the_vendored_one(checker):
    files = {"README.md", "docs/a.md", "src/x.py", *checker.LINKS_NOT_CHECKED}

    assert [p.as_posix() for p in checker.markdown_files(files)] == ["README.md", "docs/a.md"]


def growth_errors(checker, tmp_path, monkeypatch, baseline: dict[str, int], counts: dict[str, int]) -> list[str]:
    monkeypatch.chdir(tmp_path)
    (tmp_path / "ci").mkdir(exist_ok=True)
    (tmp_path / "ci" / "agent_docs_baseline.json").write_text(__import__("json").dumps(baseline))
    errors: list[str] = []
    checker.check_growth(counts, errors)
    return errors


def test_a_guide_may_shrink_but_never_grow(checker, tmp_path, monkeypatch):
    assert growth_errors(checker, tmp_path, monkeypatch, {"AGENTS.md": 80}, {"AGENTS.md": 70}) == []

    errors = growth_errors(checker, tmp_path, monkeypatch, {"AGENTS.md": 80}, {"AGENTS.md": 81})

    assert errors and "baseline 80" in errors[0]


def test_a_new_guide_is_refused_until_the_baseline_names_it(checker, tmp_path, monkeypatch):
    errors = growth_errors(checker, tmp_path, monkeypatch, {"AGENTS.md": 80}, {"AGENTS.md": 80, "x/AGENTS.md": 5})

    assert errors and "a new guide" in errors[0]


def test_a_guide_deleted_but_still_tracked_is_reported_not_crashed(checker, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    errors: list[str] = []

    checker.check_bridge(Path("gone/AGENTS.md"), {"gone/AGENTS.md", "gone/CLAUDE.md"}, errors)

    assert errors and "deleted but still tracked" in errors[0]
