#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import urllib.parse
from collections.abc import Callable
from pathlib import Path
from typing import Any

_spec = importlib.util.spec_from_file_location("reuse_green_run", Path(__file__).with_name("reuse_green_run.py"))
assert _spec is not None and _spec.loader is not None
reuse_green_run = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(reuse_green_run)

Get = Callable[[str], Any]
IsAncestor = Callable[[str], bool]


def find(get: Get, *, repo: str, path: str, branch: str, head: str, is_ancestor: IsAncestor) -> str | None:
    workflow = urllib.parse.quote(path.rsplit("/", 1)[-1])
    query = urllib.parse.urlencode({"branch": branch, "event": "push", "status": "success", "per_page": 50})
    runs = get(f"/repos/{repo}/actions/workflows/{workflow}/runs?{query}").get("workflow_runs", [])
    for run in runs:
        sha = run.get("head_sha", "")
        if not reuse_green_run._SHA.match(sha) or sha == head:
            continue
        if run.get("event") != "push" or run.get("conclusion") != "success":
            continue
        if str(run.get("path", "")).split("@", 1)[0] != path:
            continue
        if (run.get("head_repository") or {}).get("full_name") != repo:
            continue
        if is_ancestor(sha):
            return sha
    return None


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout.strip()


def _is_ancestor(sha: str) -> bool:
    return (
        subprocess.run(["git", "merge-base", "--is-ancestor", sha, "HEAD"], capture_output=True, check=False).returncode
        == 0
    )


def main() -> int:
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    head = _git("rev-parse", "HEAD")
    root = _git("rev-list", "--max-parents=0", "HEAD").splitlines()[-1]
    parents = _git("rev-list", "--parents", "-n", "1", "HEAD").split()[1:]
    try:
        path = reuse_green_run.workflow_path(os.environ.get("GITHUB_WORKFLOW_REF", ""), repo)
        get = reuse_green_run.github_get(
            os.environ.get("GITHUB_API_URL", "https://api.github.com"), os.environ.get("GITHUB_TOKEN", "")
        )
        green = find(
            get, repo=repo, path=path, branch=os.environ.get("GITHUB_REF_NAME", ""), head=head, is_ancestor=_is_ancestor
        )
        reason = f"newest green push run is at {green}" if green else "no green push run is an ancestor of HEAD"
    except Exception as error:  # noqa: BLE001 - any failure must widen the diff, never fail the run
        green, reason = None, f"lookup failed ({type(error).__name__}: {error})"
    base = green or root
    note = "diffing against it" if green else "diffing against the root commit, so every tier runs"
    print(f"::notice title=Diff base for this push::{reason}; {note}")
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(f"sha={base}\n")
            handle.write(f"found={'true' if green else 'false'}\n")
            handle.write(f"parent-is-green={'true' if green and parents == [green] else 'false'}\n")
            handle.write("reason=" + " ".join(f"{reason}; {note}".split()) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
