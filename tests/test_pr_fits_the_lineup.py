"""Run the real "Fits the lineup" workflow step, not a second copy of its matcher."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "pr.yml"
TEMPLATE = ROOT / ".github" / "pull_request_template.md"


def run_check(body: str) -> subprocess.CompletedProcess[str]:
    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    job = workflow["jobs"]["fits-the-lineup"]
    assert job["if"] == "github.event.pull_request.user.type != 'Bot'"
    steps = job["steps"]
    assert len(steps) == 1
    step = steps[0]
    assert step["shell"] == "python"
    assert step["env"]["BODY"] == "${{ github.event.pull_request.body }}"
    assert "${{" not in step["run"]
    return subprocess.run(
        [sys.executable, "-c", step["run"]],
        env={**os.environ, "BODY": body},
        capture_output=True,
        text=True,
        check=False,
    )


def template_with(answer: str) -> str:
    template = TEMPLATE.read_text(encoding="utf-8")
    heading = "#### Fits the lineup\n"
    assert heading in template
    return template.replace(heading, heading + answer + "\n", 1)


@pytest.mark.parametrize(
    "body",
    [
        template_with("Files row: one row, kind Skizze. Document view: the shared review."),
        template_with("None reached: a CI-only change, no surface a person sees."),
        "#### Fits the lineup\n\nDeep links land in the review.",
        "#### Fits the lineup\r\n\r\nPhone: reachable from Files.\r\n\r\n#### Validation\r\n",
        "## fits the lineup\n- Files list row: unchanged",
        "#### Fits the lineup\n\n##### Files row\n\nOne row.\n\n#### Validation\n",
        "#### Fits the lineup\n<!-- guidance -->\nChat: filed once.",
    ],
)
def test_accepts_a_filled_section(body: str) -> None:
    result = run_check(body)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "::error::" not in result.stdout


@pytest.mark.parametrize(
    "body",
    [
        "",
        "#### Overview\n\nA change.\n\n#### Validation\n\n- ran tests",
        "Fits the lineup: yes",
    ],
)
def test_rejects_a_missing_section(body: str) -> None:
    result = run_check(body)
    assert result.returncode == 1
    assert "no '#### Fits the lineup' section" in result.stdout


@pytest.mark.parametrize(
    "body",
    [
        TEMPLATE.read_text(encoding="utf-8"),
        "#### Fits the lineup\n\n#### Validation\n\nran tests",
        "#### Fits the lineup\r\n<!-- Name the touchpoints. -->\r\n\r\n#### Validation\r\n",
        "#### Fits the lineup\n   \n\t\n",
        "Overview\n\n#### Fits the lineup",
    ],
)
def test_rejects_an_empty_section(body: str) -> None:
    result = run_check(body)
    assert result.returncode == 1
    assert "section is empty" in result.stdout
