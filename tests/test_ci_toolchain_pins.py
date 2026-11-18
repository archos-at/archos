from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCKERFILE = "deploy/ci-runner/Dockerfile"


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def one(pattern: str, relative: str) -> str:
    found = re.findall(pattern, read(relative), flags=re.MULTILINE)
    assert len(found) == 1, f"expected one match for {pattern!r} in {relative}, found {found}"
    return found[0]


def runner_arg(name: str) -> str:
    return one(rf"^ARG {name}=(\S+)$", DOCKERFILE)


def action_default(action: str) -> str:
    return one(r'^\s+default: "([0-9.]+)"$', f".github/actions/{action}/action.yml")


def test_ci_tests_against_productions_qdrant():
    production = one(r'"qdrantImage"\) \?\? "qdrant/qdrant:v([0-9.]+)"', "deploy/pulumi/src/config/qdrant.ts")

    assert one(r'^QDRANT_VERSION="([0-9.]+)"$', "scripts/qdrant-test-server.sh") == production
    assert runner_arg("QDRANT_VERSION") == production
    assert one(r"QDRANT_IMAGE:-qdrant/qdrant:v([0-9.]+)\}", "deploy/compose/docker-compose.yaml") == production
    assert set(re.findall(r"qdrant/qdrant:v([0-9.]+)", read(".github/workflows/ci.yml"))) == {production}


def test_the_runner_image_carries_the_binary_the_script_would_download():
    linux = one(r'Linux-x86_64\) echo "x86_64-unknown-linux-gnu ([a-f0-9]{64})"', "scripts/qdrant-test-server.sh")

    assert runner_arg("QDRANT_SHA256") == linux


def test_the_runner_image_runs_productions_postgres_major():
    production = one(r'imageName: "ghcr\.io/cloudnative-pg/postgresql:(\d+)"', "deploy/pulumi/src/data/cnpg.ts")

    assert runner_arg("POSTGRES_MAJOR") == production


def test_the_runner_image_scanners_are_the_versions_ci_runs():
    trivy = one(r'^\s+TRIVY_VERSION: "([0-9.]+)"$', ".github/workflows/ci.yml")
    gitleaks = set(re.findall(r"zricethezav/gitleaks:v([0-9.]+)", read(".github/workflows/ci.yml")))
    semgrep = set(re.findall(r"semgrep/semgrep:([0-9.]+)", read(".github/workflows/ci.yml")))

    assert one(r"^FROM aquasec/trivy:([0-9.]+)@sha256:[a-f0-9]{64} AS trivy$", DOCKERFILE) == trivy
    assert {one(r"^FROM zricethezav/gitleaks:v([0-9.]+)@sha256:[a-f0-9]{64} AS gitleaks$", DOCKERFILE)} == gitleaks
    assert {runner_arg("SEMGREP_VERSION")} == semgrep


def test_the_runner_image_toolchains_are_the_ones_the_setup_steps_pin():
    assert runner_arg("NODE_VERSION") == read(".node-version").strip()
    assert runner_arg("TASK_VERSION") == action_default("setup-task")
    python = one(r'^\s+default: "(3\.\d+)"$', ".github/actions/setup-python-env/action.yml")
    assert runner_arg("PYTHON_VERSION").startswith(f"{python}.")
    playwright = set(re.findall(r"playwright@([0-9.]+) install-deps", read(".github/workflows/ci.yml")))
    assert {runner_arg("PLAYWRIGHT_VERSION")} == playwright


def test_every_base_image_in_the_runner_image_is_pinned_by_digest():
    for line in read(DOCKERFILE).splitlines():
        if line.startswith("FROM "):
            assert re.search(r"@sha256:[a-f0-9]{64}( AS \w+)?$", line), f"unpinned base image: {line}"
