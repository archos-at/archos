"""The lead-time meter attributes each develop push to the deploy that shipped it.

`ci/lead_time.py` is the number a CI change is judged by, so it must count what
a person waited: from their merge to staging running it, including the minutes
their run sat queued or was dropped in favour of a newer one.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def mod():
    spec = importlib.util.spec_from_file_location("lead_time", ROOT / "ci" / "lead_time.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["lead_time"] = module  # dataclasses resolve their module by name
    spec.loader.exec_module(module)
    return module


def at(minute: int) -> str:
    return f"2026-11-03T10:{minute:02d}:00Z"


def ci(sha: str, start: int, end: int, conclusion: str = "success", event: str = "push") -> dict:
    return {
        "head_sha": sha,
        "event": event,
        "status": "completed",
        "conclusion": conclusion,
        "created_at": at(start),
        "updated_at": at(end),
    }


def deploy(sha: str, start: int, end: int, conclusion: str = "success") -> dict:
    return {
        "head_sha": sha,
        "event": "workflow_run",
        "conclusion": conclusion,
        "created_at": at(start),
        "updated_at": at(end),
    }


def test_a_push_is_measured_from_its_merge_to_its_green_deploy_in_stages(mod):
    samples, failed = mod.merge_to_staging([ci("a", 0, 8)], [deploy("a", 8, 14)])

    (sample,) = samples
    assert failed == 0
    assert sample.total == 14 * 60
    assert sample.stages == {"wait for CI": 0, "CI": 8 * 60, "hand-off": 0, "deploy": 6 * 60}


def test_a_dropped_run_counts_until_the_newer_commits_deploy(mod):
    # b's run was cancelled while queued; c's run covered it and deployed.
    pushes = [ci("b", 1, 1, "cancelled"), ci("c", 3, 10)]

    samples, _ = mod.merge_to_staging(pushes, [deploy("c", 10, 15)])

    by_sha = {s.sha: s for s in samples}
    assert by_sha["b"].total == 14 * 60
    assert by_sha["b"].stages["wait for CI"] == 2 * 60
    assert by_sha["c"].total == 12 * 60


def test_a_red_develop_holds_every_merge_until_the_next_green_deploy(mod):
    pushes = [ci("red", 0, 9, "failure"), ci("fix", 30, 38)]
    deploys = [deploy("fix", 38, 44)]

    samples, _ = mod.merge_to_staging(pushes, deploys)

    assert {s.sha: s.total for s in samples}["red"] == 44 * 60


def test_failed_deploys_are_counted_and_not_measured(mod):
    samples, failed = mod.merge_to_staging([ci("a", 0, 8)], [deploy("a", 8, 12, "failure")])

    assert samples == [] and failed == 1


def test_pull_request_runs_count_only_when_green(mod):
    runs = [ci("p", 0, 6, event="pull_request"), ci("q", 0, 3, "failure", event="pull_request")]

    samples, red = mod.pull_request_to_green(runs)

    assert [s.total for s in samples] == [6 * 60] and red == 1


def test_the_report_names_each_stage_with_its_percentiles(mod):
    samples, failed = mod.merge_to_staging([ci("a", 0, 8)], [deploy("a", 8, 14)])

    text = mod.render("Merge to staging", samples, failed, "failed")

    assert "| **total** | **14.0** | **14.0** |" in text
    assert "| deploy | 6.0 | 6.0 |" in text


def test_percentiles_of_nothing_and_of_one(mod):
    assert mod.percentile([], 0.5) == 0.0
    assert mod.percentile([42.0], 0.9) == 42.0
    assert mod.percentile([1.0, 2.0, 3.0, 4.0, 5.0], 0.5) == 3.0


def test_a_push_is_not_credited_to_an_older_commits_deploy(mod):
    # b lands while a's CI runs; a's deploy finishes after b's push but ships a.
    pushes = [ci("a", 0, 8), ci("b", 2, 12)]
    deploys = [deploy("a", 8, 14), deploy("b", 12, 18)]

    samples, _ = mod.merge_to_staging(pushes, deploys)

    assert {s.sha: s.total for s in samples}["b"] == 16 * 60


def test_timed_out_runs_count_as_red(mod):
    _, failed = mod.merge_to_staging([ci("a", 0, 8)], [deploy("a", 8, 70, "timed_out")])
    _, red = mod.pull_request_to_green([ci("p", 0, 60, "timed_out", event="pull_request")])

    assert failed == 1 and red == 1


def test_the_report_says_when_the_page_cap_cut_it_off(mod):
    from datetime import UTC
    from datetime import datetime

    page = {"workflow_runs": [ci("a", 0, 8)] * 100, "total_count": 5000}
    text = mod.report(lambda _path: page, "acme/grid", 7, datetime(2026, 11, 3, tzinfo=UTC))

    assert "partial: more than 1000 runs" in text
    whole = mod.report(
        lambda _path: {"workflow_runs": [], "total_count": 0}, "acme/grid", 7, datetime(2026, 11, 3, tzinfo=UTC)
    )
    assert "partial" not in whole
