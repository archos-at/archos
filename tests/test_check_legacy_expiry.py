from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
MARKER = "drop after release"


@pytest.fixture(scope="module")
def checker():
    spec = importlib.util.spec_from_file_location("check_legacy_expiry", ROOT / "scripts" / "check_legacy_expiry.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def repo(tmp_path, monkeypatch):
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    monkeypatch.chdir(tmp_path)
    return tmp_path


def add(repo: Path, path: str, text: str | bytes) -> None:
    target = repo / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(text if isinstance(text, bytes) else text.encode("utf-8"))
    subprocess.run(["git", "add", path], cwd=repo, check=True)


def test_a_past_week_fails_and_names_the_path_and_line(checker, repo, capsys):
    add(repo, "apps/legacy.ts", f"export const A = 1\n// {MARKER} 2026-W40\n")

    assert checker.main(["--today", "2026-11-17"]) == 1

    assert "apps/legacy.ts:2: release 2026-W40 has shipped; delete this legacy name" in capsys.readouterr().err


def test_the_current_and_later_weeks_pass(checker, repo, capsys):
    add(repo, "a.py", f"# {MARKER} 2026-W47\n")
    add(repo, "b.py", f"# {MARKER} 2026-W48\n")
    add(repo, "c.py", f"# {MARKER} 2027-W01\n")

    assert checker.main(["--today", "2026-11-17"]) == 0

    assert "Legacy expiry check passed: 3 marker(s)" in capsys.readouterr().out


@pytest.mark.parametrize(
    "line",
    [
        f"# {MARKER} 2026-W4",
        f"# {MARKER} 2026-48",
        f"# {MARKER} soon",
        f"# {MARKER}",
        f"# {MARKER} 2026-W60",
    ],
)
def test_a_malformed_marker_fails(checker, repo, capsys, line):
    add(repo, "a.py", f"x = 1\n{line}\n")

    assert checker.main(["--today", "2026-11-17"]) == 1

    assert "a.py:2: malformed legacy marker" in capsys.readouterr().err


def test_a_marker_in_the_middle_of_a_line_counts(checker, repo, capsys):
    add(repo, "web/sw.js", f"var LEGACY = {{}} // {MARKER} 2026-W40\n")

    assert checker.main(["--today", "2026-11-17"]) == 1

    assert "web/sw.js:1: release 2026-W40 has shipped" in capsys.readouterr().err


def test_a_marker_in_a_string_or_prose_past_line_one_is_data_not_a_marker(checker, repo, capsys):
    add(repo, "tests/test_x.py", f'x = 1\nTEXT = "// {MARKER} 2026-W40"\n')
    add(repo, "docs/x.md", f"Intro.\nA module says {MARKER} 2026-W40 on its first line.\n")

    assert checker.main(["--today", "2026-11-17"]) == 0


def test_a_marker_followed_by_punctuation_is_still_judged(checker, repo, capsys):
    add(repo, "a.py", f"# {MARKER}: 2026-W40\n")

    assert checker.main(["--today", "2026-11-17"]) == 1


def test_the_placeholder_in_prose_is_not_a_marker(checker, repo, capsys):
    add(repo, "docs/naming.md", f"Its header says `{MARKER} N`.\n")

    assert checker.main(["--today", "2026-11-17"]) == 0

    assert "Legacy expiry check passed: 0 marker(s)" in capsys.readouterr().out


def test_binaries_and_node_modules_are_not_read(checker, repo, capsys):
    add(repo, "blob.bin", b"\0" + f"{MARKER} 2026-W40".encode())
    add(repo, "node_modules/pkg/index.js", f"// {MARKER} 2026-W40\n")

    assert checker.main(["--today", "2026-11-17"]) == 0


def test_the_real_tree_passes(checker, monkeypatch, capsys):
    monkeypatch.chdir(ROOT)

    assert checker.main(["--today", "2026-11-17"]) == 0
