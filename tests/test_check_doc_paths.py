"""The concept-index path check (scripts/check_doc_paths.py): a directory row may carry its trailing slash."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "check_doc_paths.py"


@pytest.fixture
def checker(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location("check_doc_paths", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "tracked_paths", lambda: {"lib/sample/one.txt", "lib/sample", "lib"})
    monkeypatch.chdir(tmp_path)
    return module


def _index(checker, tmp_path: Path, monkeypatch, row: str) -> list[str]:
    index = tmp_path / "where-is-what.md"
    index.write_text(f"| Thing | Where |\n|---|---|\n| x | {row} |\n", encoding="utf-8")
    monkeypatch.setattr(checker, "INDEX", index)
    errors: list[str] = []
    checker.check(errors)
    return errors


def test_a_tracked_directory_written_with_its_trailing_slash_passes(checker, tmp_path, monkeypatch):
    assert _index(checker, tmp_path, monkeypatch, "`lib/sample/`") == []


def test_a_tracked_directory_written_without_the_slash_passes(checker, tmp_path, monkeypatch):
    assert _index(checker, tmp_path, monkeypatch, "`lib/sample`") == []


def test_a_directory_git_does_not_know_still_fails(checker, tmp_path, monkeypatch):
    errors = _index(checker, tmp_path, monkeypatch, "`lib/missing/`")
    assert len(errors) == 1
    assert "does not exist" in errors[0]
