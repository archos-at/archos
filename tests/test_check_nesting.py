"""The nesting ratchet: a new finding fails, a baselined file may not gain one, the baseline only moves down."""

from __future__ import annotations

import importlib.util
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("check_nesting", ROOT / "scripts" / "check_nesting.py")
assert _spec and _spec.loader
check_nesting = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_nesting)

NESTED = "def f(xs):\n    for x in xs:\n        if x:\n            while x:\n                x -= 1\n"
FLAT = "def f(xs):\n    for x in xs:\n        if x:\n            return x\n"


def test_a_new_finding_fails_and_a_baselined_one_holds():
    assert check_nesting.compare({"a.py": 1}, {}) != []
    assert check_nesting.compare({"a.py": 1}, {"a.py": 1}) == []
    assert check_nesting.compare({"a.py": 2}, {"a.py": 1}) != []


def test_the_baseline_only_moves_down():
    assert check_nesting.compare({}, {"a.py": 1}) != []
    assert check_nesting.tightened({"a.py": 1}, {"a.py": 3, "b.py": 2}) == {"a.py": 1}


def test_ruff_reports_a_third_level_and_not_a_second(tmp_path):
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    (tmp_path / "nested.py").write_text(NESTED)
    (tmp_path / "flat.py").write_text(FLAT)

    assert check_nesting.findings_per_file(tmp_path, ["nested.py", "flat.py"]) == {"nested.py": 1}


def test_the_committed_baseline_is_sorted_and_holds_no_zero():
    baseline = json.loads((ROOT / check_nesting.BASELINE).read_text(encoding="utf-8"))

    assert list(baseline) == sorted(baseline)
    assert all(count > 0 for count in baseline.values())
