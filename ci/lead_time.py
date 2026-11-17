#!/usr/bin/env python3

from __future__ import annotations

import argparse
import importlib.util
import os
import statistics
import sys
import urllib.parse
from collections.abc import Callable
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC
from datetime import datetime
from datetime import timedelta
from pathlib import Path
from typing import Any

_spec = importlib.util.spec_from_file_location("reuse_green_run", Path(__file__).with_name("reuse_green_run.py"))
assert _spec is not None and _spec.loader is not None
reuse_green_run = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(reuse_green_run)

Get = Callable[[str], Any]
Run = dict[str, Any]
RED = ("failure", "timed_out")
PAGES = 10


@dataclass(frozen=True)
class Sample:
    sha: str
    total: float
    stages: dict[str, float]


def when(stamp: str) -> datetime:
    return datetime.fromisoformat(stamp.replace("Z", "+00:00"))


def seconds(start: str, end: str) -> float:
    return (when(end) - when(start)).total_seconds()


def merge_to_staging(ci_runs: Iterable[Run], deploy_runs: Iterable[Run]) -> tuple[list[Sample], int]:
    pushes = sorted((r for r in ci_runs if r.get("event") == "push"), key=lambda r: r["created_at"])
    deploys = sorted(
        (r for r in deploy_runs if r.get("event") == "workflow_run" and r.get("conclusion") in (*RED, "success")),
        key=lambda r: r["created_at"],
    )
    failed = sum(1 for d in deploys if d["conclusion"] in RED)
    green = [d for d in deploys if d["conclusion"] == "success"]
    by_sha = {r["head_sha"]: r for r in pushes if r.get("conclusion") == "success"}
    samples: list[Sample] = []
    for push in pushes:
        deploy = next(
            (
                d
                for d in green
                if d["created_at"] >= push["created_at"]
                and d["head_sha"] in by_sha
                and by_sha[d["head_sha"]]["created_at"] >= push["created_at"]
            ),
            None,
        )
        carrier = by_sha.get(deploy["head_sha"]) if deploy else None
        if deploy is None or carrier is None:
            continue
        stages = {
            "wait for CI": seconds(push["created_at"], carrier["created_at"]),
            "CI": seconds(carrier["created_at"], carrier["updated_at"]),
            "hand-off": seconds(carrier["updated_at"], deploy["created_at"]),
            "deploy": seconds(deploy["created_at"], deploy["updated_at"]),
        }
        stages = {name: max(value, 0.0) for name, value in stages.items()}
        samples.append(Sample(push["head_sha"], seconds(push["created_at"], deploy["updated_at"]), stages))
    return samples, failed


def pull_request_to_green(ci_runs: Iterable[Run]) -> tuple[list[Sample], int]:
    prs = [r for r in ci_runs if r.get("event") == "pull_request" and r.get("status") == "completed"]
    green = [r for r in prs if r.get("conclusion") == "success"]
    red = sum(1 for r in prs if r.get("conclusion") in RED)
    samples = [
        Sample(
            r["head_sha"], seconds(r["created_at"], r["updated_at"]), {"CI": seconds(r["created_at"], r["updated_at"])}
        )
        for r in green
    ]
    return samples, red


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    return statistics.quantiles(values, n=100, method="inclusive")[round(fraction * 100) - 1]


def minutes(value: float) -> str:
    return f"{value / 60:.1f}"


def render(title: str, samples: list[Sample], excluded: int, excluded_label: str) -> str:
    lines = [f"### {title}", ""]
    if not samples:
        return "\n".join([*lines, f"No samples. {excluded} {excluded_label}.", ""])
    names = list(samples[0].stages)
    lines += ["| | p50 (min) | p90 (min) |", "|---|---|---|"]
    totals = [s.total for s in samples]
    lines.append(f"| **total** | **{minutes(percentile(totals, 0.5))}** | **{minutes(percentile(totals, 0.9))}** |")
    if names != ["CI"]:
        for name in names:
            values = [s.stages[name] for s in samples]
            lines.append(f"| {name} | {minutes(percentile(values, 0.5))} | {minutes(percentile(values, 0.9))} |")
    lines += ["", f"{len(samples)} samples; {excluded} {excluded_label}.", ""]
    return "\n".join(lines)


def runs(get: Get, repo: str, workflow: str, since: datetime, **filters: str) -> tuple[list[Run], bool]:
    created = since.strftime("%Y-%m-%dT%H:%M:%SZ")
    found: list[Run] = []
    for page in range(1, PAGES + 1):
        query = urllib.parse.urlencode({**filters, "created": f">={created}", "per_page": 100, "page": page})
        response = get(f"/repos/{repo}/actions/workflows/{workflow}/runs?{query}")
        found += response.get("workflow_runs", [])
        if len(found) >= response.get("total_count", 0):
            return found, False
    return found, True


def report(get: Get, repo: str, days: int, now: datetime) -> str:
    since = now - timedelta(days=days)
    pushes, cut_pushes = runs(get, repo, "ci.yml", since, branch="develop", event="push")
    deploys, cut_deploys = runs(get, repo, "deploy.yml", since, event="workflow_run")
    prs, cut_prs = runs(get, repo, "ci.yml", since, event="pull_request")
    staging, failed_deploys = merge_to_staging(pushes, deploys)
    green, red = pull_request_to_green(prs)
    partial = cut_pushes or cut_deploys or cut_prs
    heading = f"## Lead time, last {days} days (to {now:%Y-%m-%d %H:%M} UTC)"
    if partial:
        heading += f" — partial: more than {PAGES * 100} runs, only the newest are counted"
    return "\n".join(
        [
            heading,
            "",
            render("Merge to staging", staging, failed_deploys, "staging deploys failed and are not in it"),
            render("Pull request run to green", green, red, "pull request runs went red and are not in it"),
        ]
    )


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="How long a change takes to reach people, measured from the Actions API."
    )
    parser.add_argument("--days", type=int, default=7)
    args = parser.parse_args(argv)
    get = reuse_green_run.github_get(
        os.environ.get("GITHUB_API_URL", "https://api.github.com"), os.environ["GITHUB_TOKEN"]
    )
    print(report(get, os.environ["GITHUB_REPOSITORY"], args.days, datetime.now(UTC)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
