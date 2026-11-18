#!/usr/bin/env python3
"""How much of CI a run owes, 'light' or 'full': the rule and its reasons are in docs/contributing/ci.md, rule 4."""

from __future__ import annotations

import os
import sys
from collections.abc import Callable

from reuse_green_run import github_get

FULL_LABEL = "ci:full"


def decide(event: str, light_runs: str, base: str, author: str, labels: Callable[[], set[str]]) -> tuple[str, str]:
    if event != "pull_request":
        return "full", f"a {event} run is always full: the deploy waits for it"
    if light_runs == "false":
        return "full", "light runs are off (CI_LIGHT_RUNS is 'false')"
    if base.startswith("release/"):
        return "full", "a pull request into a release branch is always full"
    if author == "dependabot[bot]":
        return "full", "Dependabot merges itself once CI OK passes, so it gets the full suite"
    try:
        found = labels()
    except Exception as error:  # noqa: BLE001 - a lookup failure means a full run, never a red Plan
        return "full", f"could not read the labels ({error})"
    if FULL_LABEL in found:
        return "full", f"labelled {FULL_LABEL}"
    return "light", f"a pull request into {base}: the full suite runs on the push after the merge"


def main() -> int:
    repo = os.environ.get("GITHUB_REPOSITORY", "")

    def labels() -> set[str]:
        get = github_get(os.environ.get("GITHUB_API_URL", "https://api.github.com"), os.environ["GITHUB_TOKEN"])
        pull = get(f"/repos/{repo}/pulls/{int(os.environ['PR_NUMBER'])}")
        return {label.get("name", "") for label in pull.get("labels", [])}

    depth, reason = decide(
        os.environ.get("EVENT", ""),
        os.environ.get("LIGHT_RUNS", ""),
        os.environ.get("BASE_REF", ""),
        os.environ.get("AUTHOR", ""),
        labels,
    )
    print(f"depth: {depth} ({reason})")
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(f"depth={depth}\nreason={reason}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
