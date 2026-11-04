"""Which Dependabot pull requests merge themselves once `CI OK` passes.

`ci/dependabot_merge.py` is the policy the auto-merge workflow asks; a wrong
yes lands an unread bump on staging, so each boundary is pinned here.
"""

from __future__ import annotations

import importlib.util
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


def test_the_cli_prints_the_lines_the_workflow_appends_to_its_outputs():
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "version-update:semver-major", "/"],
        capture_output=True,
        text=True,
        check=True,
    )
    lines = result.stdout.splitlines()
    assert lines[0] == "merge=false"
    assert lines[1].startswith("reason=")
