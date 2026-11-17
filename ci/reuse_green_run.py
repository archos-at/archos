#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from collections.abc import Callable
from typing import Any

Get = Callable[[str], Any]

_SHA = re.compile(r"^[0-9a-f]{40}$")


def workflow_path(workflow_ref: str, repo: str) -> str:
    path = workflow_ref.split("@", 1)[0]
    prefix = f"{repo}/"
    if not path.startswith(prefix):
        raise ValueError(f"GITHUB_WORKFLOW_REF {workflow_ref!r} is not in {repo}")
    return path[len(prefix) :]


def _rejection(get: Get, artifact: dict, *, repo: str, path: str, blob: str) -> tuple[dict, str | None]:
    if artifact.get("expired") is not False:
        return {}, f"artifact {artifact.get('id')} has expired"
    run_id = (artifact.get("workflow_run") or {}).get("id")
    if not isinstance(run_id, int):
        return {}, f"artifact {artifact.get('id')} names no workflow run"
    run = get(f"/repos/{repo}/actions/runs/{run_id}")
    return run, _run_rejection(get, run, run_id=run_id, repo=repo, path=path, blob=blob)


def _run_rejection(get: Get, run: dict, *, run_id: int, repo: str, path: str, blob: str) -> str | None:
    if run.get("status") != "completed" or run.get("conclusion") != "success":
        return f"run {run_id} is {run.get('status')}/{run.get('conclusion')}, not completed/success"
    if run.get("event") != "pull_request":
        return f"run {run_id} was a {run.get('event')!r} run, not a pull_request run"
    if str(run.get("path", "")).split("@", 1)[0] != path:
        return f"run {run_id} ran {run.get('path')!r}, not {path!r}"
    if (run.get("head_repository") or {}).get("full_name") != repo:
        return f"run {run_id} came from a fork"
    if (run.get("repository") or {}).get("full_name") != repo:
        return f"run {run_id} belongs to another repository"
    head_sha = run.get("head_sha", "")
    if not _SHA.match(head_sha):
        return f"run {run_id} has no usable head sha"
    quoted = urllib.parse.quote(path)
    contents = get(f"/repos/{repo}/contents/{quoted}?ref={head_sha}")
    if contents.get("sha") != blob:
        return f"run {run_id} ran a different {path} than this commit has"
    return None


def find_green_run(get: Get, *, repo: str, name: str, path: str, blob: str) -> tuple[dict | None, list[str]]:
    query = urllib.parse.urlencode({"name": name, "per_page": 100})
    artifacts = get(f"/repos/{repo}/actions/artifacts?{query}").get("artifacts", [])
    reasons: list[str] = []
    for artifact in artifacts:
        if artifact.get("name") != name:
            continue
        run, reason = _rejection(get, artifact, repo=repo, path=path, blob=blob)
        if reason is None:
            return run, reasons
        reasons.append(reason)
    if not reasons:
        reasons.append(f"no artifact named {name}")
    return None, reasons


def decide(get: Get, *, prefix: str, tree: str, blob: str, repo: str, workflow_ref: str) -> tuple[bool, str]:
    try:
        if not _SHA.match(tree) or not _SHA.match(blob):
            return False, f"miss: tree {tree!r} or workflow blob {blob!r} is not a sha"
        path = workflow_path(workflow_ref, repo)
        run, reasons = find_green_run(get, repo=repo, name=f"{prefix}-{tree}", path=path, blob=blob)
    except Exception as error:  # noqa: BLE001 - any failure must fall back to running everything
        return False, f"miss: lookup failed ({type(error).__name__}: {error}); running every job"
    if run is None:
        return False, "miss: " + "; ".join(reasons) + "; running every job"
    return True, f"hit: tree {tree} already passed in {run.get('html_url', 'run ' + str(run.get('id')))}"


def github_get(api_url: str, token: str) -> Get:

    def get(path: str) -> Any:
        base = urllib.parse.urlsplit(api_url)
        if base.scheme != "https" or not base.netloc:
            raise ValueError(f"GITHUB_API_URL must be an https URL, got {api_url!r}")
        request = urllib.request.Request(
            api_url.rstrip("/") + path,
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {token}",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
        with urllib.request.urlopen(request, timeout=20) as response:  # noqa: S310 - fixed https API base
            return json.load(response)

    return get


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout.strip()


def main(argv: list[str]) -> int:
    hit, message = False, "miss: usage is reuse_green_run.py <prefix>; running every job"
    if len(argv) == 1:
        repo = os.environ.get("GITHUB_REPOSITORY", "")
        workflow_ref = os.environ.get("GITHUB_WORKFLOW_REF", "")
        try:
            tree = _git("rev-parse", "HEAD^{tree}")
            blob = _git("rev-parse", f"HEAD:{workflow_path(workflow_ref, repo)}")
        except (OSError, ValueError, subprocess.CalledProcessError) as error:
            tree = blob = ""
            message = f"miss: could not read the pushed commit ({error}); running every job"
        if tree:
            get = github_get(
                os.environ.get("GITHUB_API_URL", "https://api.github.com"), os.environ.get("GITHUB_TOKEN", "")
            )
            hit, message = decide(get, prefix=argv[0], tree=tree, blob=blob, repo=repo, workflow_ref=workflow_ref)
    print(f"::notice title=Reuse of the pull request's result::{message}")
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(f"hit={'true' if hit else 'false'}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
