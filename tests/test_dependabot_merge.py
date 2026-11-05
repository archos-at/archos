"""Which Dependabot pull requests merge themselves once `CI OK` passes.

`ci/dependabot_merge.py` is the policy the auto-merge workflow asks; a wrong
yes lands an unread bump on staging, so each boundary is pinned here.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "ci" / "dependabot_merge.py"


@pytest.fixture(scope="module")
def mod():
    spec = importlib.util.spec_from_file_location("dependabot_merge", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("update_type", ["version-update:semver-minor", "version-update:semver-patch"])
@pytest.mark.parametrize("directory", ["/", "/apps/workspace", "/apps/website"])
def test_minor_and_patch_updates_merge(mod, update_type, directory):
    assert mod.decide(update_type, directory)[0] is True


@pytest.mark.parametrize("update_type", ["version-update:semver-major", ""])
def test_a_major_or_an_unclassified_jump_waits_for_a_person(mod, update_type):
    merge, reason = mod.decide(update_type, "/apps/workspace")
    assert merge is False
    assert "person" in reason


@pytest.mark.parametrize("directory", ["/deploy/pulumi", "/deploy/pulumi/policy"])
def test_the_pulumi_program_waits_for_a_person_even_on_a_patch(mod, directory):
    assert mod.decide("version-update:semver-patch", directory)[0] is False


def test_a_directory_that_only_shares_the_prefix_is_not_held(mod):
    assert mod.decide("version-update:semver-patch", "/deploy/pulumi-tools")[0] is True


@pytest.mark.parametrize(
    ("update_type", "expected"),
    [("version-update:semver-major", "merge=false"), ("version-update:semver-minor", "merge=true")],
)
def test_the_cli_prints_the_lines_the_workflow_appends_to_its_outputs(update_type, expected):
    lines = run_cli(update_type, "/").splitlines()
    assert lines[0] == expected
    assert lines[1].startswith("reason=")


def run_cli(*args: str, stdin: str | None = None) -> str:
    result = subprocess.run(
        [sys.executable, str(SCRIPT), *args], input=stdin, capture_output=True, text=True, check=True
    )
    return result.stdout


def status_rule(*checks: dict) -> dict:
    return {"type": "required_status_checks", "parameters": {"required_status_checks": list(checks)}}


ACTIONS = 15368


def test_ci_ok_from_github_actions_is_the_only_required_check_that_counts(mod):
    assert mod.ci_ok_required([status_rule({"context": "CI OK", "integration_id": ACTIONS})])
    # No rule at all: auto-merge would merge at once.
    assert not mod.ci_ok_required([])
    assert not mod.ci_ok_required([{"type": "pull_request", "parameters": {}}])
    # Another check, or CI OK from any source or from another app, which an
    # integration other than this repository's workflows could pass.
    assert not mod.ci_ok_required([status_rule({"context": "Conventional PR title", "integration_id": ACTIONS})])
    assert not mod.ci_ok_required([status_rule({"context": "CI OK"})])
    assert not mod.ci_ok_required([status_rule({"context": "CI OK", "integration_id": 1})])


def test_the_required_reviews_are_the_most_any_rule_asks(mod):
    rules = [
        {"type": "pull_request", "parameters": {"required_approving_review_count": 0}},
        {"type": "pull_request", "parameters": {"required_approving_review_count": 2}},
        status_rule({"context": "CI OK", "integration_id": ACTIONS}),
    ]
    assert mod.required_reviews(rules) == 2
    assert mod.required_reviews([]) == 0


def test_the_rules_cli_prints_shell_assignments_the_workflow_sources():
    rules = json.dumps([status_rule({"context": "CI OK", "integration_id": ACTIONS})])
    assert run_cli("rules", stdin=rules).splitlines() == ["ci_ok_required=true", "reviews=0"]
    assert run_cli("rules", stdin="[]").splitlines() == ["ci_ok_required=false", "reviews=0"]
