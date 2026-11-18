#!/usr/bin/env python3

from __future__ import annotations

import json
import re
import subprocess
import sys

EXPANDS = "deploy/rollout/expands/"
SWITCHES = "deploy/rollout/switches/"
PROD_STACK = "deploy/pulumi/Pulumi.prod.yaml"
PIN = re.compile(r"^  [a-z-]+:imageTag: *sha-([0-9a-f]{40})\b", re.MULTILINE)
NAME = re.compile(r"^[a-z][a-z0-9-]*$")


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], check=check, capture_output=True, text=True)


def has_commit(sha: str) -> bool:
    return git("cat-file", "-e", f"{sha}^{{commit}}", check=False).returncode == 0


def prod_sha(prod_ref: str) -> str:
    stack = git("show", f"{prod_ref}:{PROD_STACK}").stdout
    pinned = PIN.search(stack)
    if pinned is None:
        raise SystemExit(f"::error::{prod_ref}:{PROD_STACK} pins no sha- imageTag, so what prod runs is unknown.")
    sha = pinned[1]
    if not has_commit(sha):
        git("fetch", "-q", "--filter=blob:none", "origin", sha, check=False)
    if not has_commit(sha):
        raise SystemExit(f"::error::prod runs {sha}, which this clone cannot fetch.")
    return sha


def switch_at(rev: str, path: str) -> tuple[str, str]:
    name = path.removeprefix(SWITCHES).removesuffix(".json")
    try:
        manifest = json.loads(git("show", f"{rev}:{path}").stdout)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"::error file={path}::{path} is not JSON: {exc}") from exc
    expand = manifest.get("switches")
    if not isinstance(expand, str) or not NAME.match(expand):
        raise SystemExit(f'::error file={path}::{path} must name its expand: "switches": "<name>"')
    return name, expand


def switches_at(rev: str) -> list[str]:
    out = git("ls-tree", "-r", "--name-only", rev, "--", SWITCHES).stdout
    return [p for p in out.split() if p.endswith(".json")]


def switches_changed(base: str, head: str) -> list[str]:
    out = git("diff", "--name-only", "--diff-filter=AM", f"{base}...{head}", "--", SWITCHES).stdout
    return [p for p in out.split() if p.endswith(".json")]


SHA = re.compile(r"^[0-9a-f]{40}$")


def expand_commit(name: str, rev: str) -> str | None:
    path = f"{EXPANDS}{name}.json"
    added = git("log", "--diff-filter=A", "--format=%H", rev, "--", path).stdout.split()
    if not added:
        return None
    named = json.loads(git("show", f"{rev}:{path}").stdout).get("commit")
    if named is None:
        return added[-1]
    if not isinstance(named, str) or not SHA.match(named) or not is_ancestor(named, rev):
        raise SystemExit(f'::error file={path}::{path}: "commit" must be the 40-hex sha of the expand on develop')
    return named


def is_ancestor(commit: str, of: str) -> bool:
    return git("merge-base", "--is-ancestor", commit, of, check=False).returncode == 0


def ahead_of_prod(paths: list[str], rev: str, prod: str) -> list[str]:
    problems = []
    for path in paths:
        name, expand = switch_at(rev, path)
        commit = expand_commit(expand, rev)
        if commit is None:
            problems.append(
                f"::error file={path}::{name} switches {expand}, but no {EXPANDS}{expand}.json was ever added."
            )
        elif not is_ancestor(commit, prod):
            problems.append(
                f"::error file={path}::{name} switches {expand}, which {commit[:9]} added and prod "
                f"({prod[:9]}) does not run yet. Merge the switch once a promotion carrying the expand is live."
            )
    return problems


def report(problems: list[str], ok: str) -> int:
    for line in problems:
        print(line)
    if problems:
        print("Expand before switch: docs/deployment/expand-and-switch.md")
        return 1
    print(ok)
    return 0


def check_pr(base: str, head: str, prod_ref: str) -> int:
    paths = switches_changed(base, head)
    if not paths:
        print("This pull request declares no switch.")
        return 0
    ok = f"Every switch it declares has its expand on prod: {', '.join(paths)}"
    return report(ahead_of_prod(paths, head, prod_sha(prod_ref)), ok)


def check_promotion(candidate: str, prod_ref: str) -> int:
    paths = switches_at(candidate)
    return report(
        ahead_of_prod(paths, candidate, prod_sha(prod_ref)),
        f"Prod runs the expand of every switch this promotion carries ({len(paths)}).",
    )


USAGE = "usage: expand_switch.py pr <base-sha> <head-sha> [prod-ref] | promotion <candidate-sha> [prod-ref]"


def main(argv: list[str]) -> int:
    if len(argv) in (3, 4) and argv[0] == "pr":
        return check_pr(argv[1], argv[2], argv[3] if len(argv) == 4 else "origin/prod")
    if len(argv) in (2, 3) and argv[0] == "promotion":
        return check_promotion(argv[1], argv[2] if len(argv) == 3 else "origin/prod")
    print(USAGE, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
