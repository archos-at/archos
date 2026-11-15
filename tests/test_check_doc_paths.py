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


def _scoped(checker, tmp_path: Path, monkeypatch, guide: str, doc: str, baseline: dict[str, int]) -> list[str]:
    monkeypatch.setattr(
        checker,
        "tracked_paths",
        lambda: {"pkg/AGENTS.md", "docs/architecture/a.md", "pkg/common/http.py", "pkg/common", "pkg"},
    )
    (tmp_path / "pkg").mkdir(exist_ok=True)
    (tmp_path / "pkg" / "AGENTS.md").write_text(guide, encoding="utf-8")
    (tmp_path / "docs" / "architecture").mkdir(parents=True, exist_ok=True)
    (tmp_path / "docs" / "architecture" / "a.md").write_text(doc, encoding="utf-8")
    monkeypatch.setattr(checker, "BASELINE", tmp_path / "baseline.json")
    checker.BASELINE.write_text(__import__("json").dumps(baseline), encoding="utf-8")
    errors: list[str] = []
    checker.check_scoped(errors)
    return errors


def test_a_guide_names_files_by_their_tail(checker, tmp_path, monkeypatch):
    assert _scoped(checker, tmp_path, monkeypatch, "Use `common/http.py` and `http.py`.", "", {}) == []


def test_a_renamed_file_in_a_guide_fails(checker, tmp_path, monkeypatch):
    errors = _scoped(checker, tmp_path, monkeypatch, "Use `lib/request-context.ts`.", "", {})

    assert len(errors) == 1 and "lib/request-context.ts" in errors[0]


def test_symbols_and_generated_paths_are_not_claims(checker, tmp_path, monkeypatch):
    guide = "`knowledge/inventory.get_turn_documents` `grid/require-tenant-cache-key` `node_modules/next/dist/docs/`"

    assert _scoped(checker, tmp_path, monkeypatch, guide, "", {}) == []


def test_a_doc_may_keep_its_baseline_but_not_gain_a_dead_path(checker, tmp_path, monkeypatch):
    doc = "`gone/old.py` was removed."

    assert _scoped(checker, tmp_path, monkeypatch, "", doc, {"docs/architecture/a.md": 1}) == []

    errors = _scoped(checker, tmp_path, monkeypatch, "", doc + " See `also/gone.ts`.", {"docs/architecture/a.md": 1})

    assert len(errors) == 1 and "baseline 1" in errors[0]
