"""How much of CI a run owes (ci/ci_depth.py), and which green run a full one chains from (ci/pr_selection.py)."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

CI_DIR = Path(__file__).resolve().parents[1] / "ci"


def _load(name: str):
    sys.path.insert(0, str(CI_DIR))
    try:
        spec = importlib.util.spec_from_file_location(name, CI_DIR / f"{name}.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(CI_DIR))


depth = _load("ci_depth")
selection = _load("pr_selection")


def _decide(event="pull_request", light="", base="develop", author="someone", labels=frozenset()):
    def read() -> set[str]:
        if isinstance(labels, Exception):
            raise labels
        return set(labels)

    return depth.decide(event, light, base, author, read)


@pytest.mark.parametrize(
    ("kwargs", "expected"),
    [
        ({}, "light"),
        ({"light": "true"}, "light"),
        ({"base": "claude/stack"}, "light"),
        ({"labels": {"backend", "no-release-note"}}, "light"),
        ({"labels": {depth.FULL_LABEL}}, "full"),
        ({"event": "push"}, "full"),
        ({"light": "false"}, "full"),
        ({"base": "release/1"}, "full"),
        ({"author": "dependabot[bot]"}, "full"),
        ({"labels": RuntimeError("no")}, "full"),
    ],
)
def test_depth(kwargs, expected):
    assert _decide(**kwargs)[0] == expected


def test_a_push_reads_no_labels():
    def boom() -> set[str]:
        raise AssertionError("no lookup needed")

    assert depth.decide("push", "", "", "", boom)[0] == "full"


def test_depth_reads_the_labels_now_and_writes_its_outputs(tmp_path, monkeypatch):
    output = tmp_path / "output"
    for key, value in {
        "GITHUB_OUTPUT": str(output),
        "EVENT": "pull_request",
        "BASE_REF": "develop",
        "GITHUB_REPOSITORY": "o/r",
        "PR_NUMBER": "7",
        "GITHUB_TOKEN": "t",
    }.items():
        monkeypatch.setenv(key, value)
    paths: list[str] = []

    def get(path: str) -> dict:
        paths.append(path)
        return {"labels": [{"name": "ci"}, {"name": depth.FULL_LABEL}]}

    monkeypatch.setattr(depth, "github_get", lambda _url, _token: get)

    assert depth.main() == 0
    assert paths == ["/repos/o/r/pulls/7"]
    assert output.read_text() == f"depth=full\nreason=labelled {depth.FULL_LABEL}\n"


def test_the_label_exists_in_the_repository_labels():
    labels = (CI_DIR.parent / ".github/labels.yml").read_text(encoding="utf-8")

    assert f"- name: {depth.FULL_LABEL}\n" in labels


def _api(*runs: dict, artifacts: dict | None = None):
    artifacts = artifacts or {}

    def get(path: str) -> dict:
        if "/artifacts" in path:
            return {"artifacts": artifacts.get(path.split("/runs/")[1].split("/", maxsplit=1)[0], [])}
        return {"workflow_runs": list(runs)}

    return get


LIGHT_RUN = {"id": 2, "head_sha": "b" * 40}
FULL_RUN = {"id": 1, "head_sha": "c" * 40}
MARKER = [{"name": "ci-green-" + "d" * 40, "expired": False}]


def test_the_reference_is_the_newest_full_run_never_a_newer_light_one():
    get = _api(LIGHT_RUN, FULL_RUN, artifacts={"1": MARKER})

    assert selection.previous_green(get, "o/r", "branch", "h" * 40, lambda _sha: True) is FULL_RUN


def test_a_light_run_that_ran_no_python_tests_never_narrows_the_next_run():
    get = _api(LIGHT_RUN)

    assert selection.previous_green(get, "o/r", "branch", "h" * 40, lambda _sha: True) is None


def test_an_expired_marker_reads_as_light():
    expired = [{"name": "ci-green-" + "d" * 40, "expired": True}]
    get = _api(FULL_RUN, artifacts={"1": expired})

    assert selection.previous_green(get, "o/r", "branch", "h" * 40, lambda _sha: True) is None
