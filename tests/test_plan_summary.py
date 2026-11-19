from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
IMAGES = [
    {"name": "backend", "hash": "b" * 16},
    {"name": "frontend", "hash": "f" * 16},
]


@pytest.fixture(scope="module")
def mod():
    spec = importlib.util.spec_from_file_location("plan_summary", ROOT / "ci" / "plan_summary.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_a_push_names_its_diff_base_and_the_reason(mod):
    text = mod.render(
        {
            "EVENT": "push",
            "BASE": "a" * 40,
            "BASE_REASON": "no green push run is an ancestor of HEAD; diffing against the root commit",
            "TIERS": json.dumps({"backend": "true", "workspace": "false"}),
            "BUILD": json.dumps(IMAGES[:1]),
            "IMAGES": json.dumps(IMAGES),
            "PINS": "[]",
        }
    )

    assert "Diffed against `aaaaaaaaaaaa`: no green push run is an ancestor of HEAD" in text
    assert "| backend | yes |" in text and "| workspace | no |" in text
    assert f"| backend | `inputs-{'b' * 16}` | build and push |" in text
    assert f"| frontend | `inputs-{'f' * 16}` | nothing to build |" in text
    assert text.endswith("scanned by trivy: none.\n")


def test_a_pull_request_builds_without_pushing_and_lists_its_pins(mod):
    text = mod.render(
        {
            "EVENT": "pull_request",
            "BASE": "c" * 40,
            "TIERS": json.dumps({"infra": "true"}),
            "BUILD": json.dumps(IMAGES[1:]),
            "IMAGES": json.dumps(IMAGES),
            "PINS": json.dumps(["langfuse/langfuse@sha256:1"]),
        }
    )

    assert "the whole PR, every push" in text
    assert "| infra | yes |" in text and "| backend | no |" in text
    assert "| frontend | `inputs-ffffffffffffffff` | build (pushes nothing) |" in text
    assert "`langfuse/langfuse@sha256:1`" in text


def test_a_reused_run_says_why_nothing_runs_instead_of_a_table_of_noes(mod):
    text = mod.render({"EVENT": "push", "BASE": "d" * 40, "BASE_REASON": "x", "REUSED": "true"})

    assert "**Reused.**" in text and "| Tier |" not in text


@pytest.mark.parametrize(("py_mode", "warned"), [("full", True), ("select", False)])
def test_a_light_run_says_how_to_get_the_full_suite_and_when_it_has_no_python_tests(mod, py_mode, warned):
    text = mod.render(
        {
            "EVENT": "pull_request",
            "DEPTH": "light",
            "DEPTH_REASON": "a pull request into develop",
            "PY_MODE": py_mode,
            "TIERS": json.dumps({"backend": "true"}),
        }
    )

    assert "**Light run** (a pull request into develop)" in text
    assert "`ci:full`" in text
    assert ("No Python tests in this run" in text) is warned


def test_a_full_run_says_nothing_about_depth(mod):
    text = mod.render({"EVENT": "push", "DEPTH": "full", "PY_MODE": "full", "TIERS": json.dumps({"backend": "true"})})

    assert "Light run" not in text and "No Python tests" not in text
