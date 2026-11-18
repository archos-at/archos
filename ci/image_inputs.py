#!/usr/bin/env python3

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
from collections.abc import Callable
from dataclasses import asdict
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIND_PUBLISHED_TAG = ROOT / "deploy" / "pulumi" / "scripts" / "find-published-tag.sh"

SCHEME = "1"


@dataclass(frozen=True)
class Image:
    name: str
    context: str
    dockerfile: str
    target: str = ""
    repo: str = ""

    @property
    def repository(self) -> str:
        return self.repo or f"grid-oib-{self.name}"


IMAGES = (
    Image("backend", context=".", dockerfile="apps/agent-host/Dockerfile", target="release"),
    Image("frontend", context="apps/workspace", dockerfile="apps/workspace/deploy/Dockerfile"),
    Image("web", context="apps/website", dockerfile="apps/website/Dockerfile"),
    Image("cms", context="apps/cms", dockerfile="apps/cms/Dockerfile", repo="cms"),
    Image("code-runner", context="apps/code-runner", dockerfile="apps/code-runner/Dockerfile", repo="code-runner"),
    Image(
        "browser-renderer",
        context="apps/browser-renderer",
        dockerfile="apps/browser-renderer/Dockerfile",
        repo="browser-renderer",
    ),
)

_INSTRUCTION = re.compile(r"^\s*(COPY|ADD)\s+(.*)$", re.IGNORECASE)


def _logical_lines(text: str) -> list[str]:
    lines: list[str] = []
    pending = ""
    for raw in text.splitlines():
        if not pending and raw.lstrip().startswith("#"):
            continue
        if raw.rstrip().endswith("\\"):
            pending += raw.rstrip()[:-1] + " "
            continue
        lines.append(pending + raw)
        pending = ""
    if pending:
        lines.append(pending)
    return lines


def copy_sources(dockerfile_text: str) -> list[str]:
    sources: list[str] = []
    for line in _logical_lines(dockerfile_text):
        match = _INSTRUCTION.match(line)
        if not match:
            continue
        rest = match.group(2).strip()
        args = json.loads(rest) if rest.startswith("[") else shlex.split(rest)
        flags = [arg for arg in args if arg.startswith("--")]
        if any(flag.startswith("--from") for flag in flags):
            continue
        paths = [arg for arg in args if not arg.startswith("--")]
        sources.extend(_cut_glob(path) for path in paths[:-1])
    return sources


def _cut_glob(path: str) -> str:
    parts = []
    for part in path.split("/"):
        if any(char in part for char in "*?["):
            break
        parts.append(part)
    return "/".join(parts) or "."


def _normalise(context: str, source: str) -> str:
    joined = os.path.normpath(os.path.join(context, source))
    if os.path.relpath(joined, context).split(os.sep)[0] == "..":
        raise ValueError(f"{source!r} leaves the build context {context!r}")
    return joined


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout


def _tracks(rev: str, path: str) -> bool:
    return (
        subprocess.run(
            ["git", "cat-file", "-e", f"{rev}:{path}"], check=False, cwd=ROOT, capture_output=True
        ).returncode
        == 0
    )


def inputs(image: Image, rev: str = "HEAD") -> list[str]:
    dockerfile = _git("show", f"{rev}:{image.dockerfile}")
    paths = {image.dockerfile, _normalise(image.context, ".dockerignore")}
    paths.update(_normalise(image.context, source) for source in copy_sources(dockerfile))
    return sorted(paths)


PROD_STACK = "deploy/pulumi/Pulumi.prod.yaml"
_BASE_DOMAIN = re.compile(r"^\s*[\w-]+:baseDomain:\s*[\"']?([^\s\"'#]+)", re.MULTILINE)


def build_args(image: Image, rev: str = "HEAD") -> dict[str, str]:
    if image.name != "web":
        return {}
    match = _BASE_DOMAIN.search(_git("show", f"{rev}:{PROD_STACK}"))
    if not match:
        raise ValueError(f"{PROD_STACK} at {rev} has no baseDomain")
    return {"PUBLIC_SITE_URL": f"https://{match.group(1)}"}


def iso_week(today: datetime.date) -> str:
    year, week, _ = today.isocalendar()
    return f"{year}-W{week:02d}"


def input_hash(image: Image, rev: str = "HEAD", *, week: str) -> str:
    paths = inputs(image, rev)
    listing = _git("ls-tree", "-r", "--full-tree", rev, "--", *paths)
    tracked = {line.split("\t", 1)[1] for line in listing.splitlines()}
    missing = [path for path in paths if path != image.dockerfile and not _covered(path, tracked)]
    missing = [path for path in missing if not path.endswith(".dockerignore")]
    if missing:
        raise ValueError(f"{image.dockerfile} copies {missing}, which {rev} does not track")
    args = "".join(f"{key}={value}\n" for key, value in sorted(build_args(image, rev).items()))
    digest = hashlib.sha256()
    for part in (SCHEME, image.name, image.target, week, listing, args):
        digest.update(part.encode())
        digest.update(b"\0")
    return digest.hexdigest()[:40]


def _covered(path: str, tracked: set[str]) -> bool:
    if path == ".":
        return bool(tracked)
    return path in tracked or any(name.startswith(path + "/") for name in tracked)


def hashes(rev: str = "HEAD", *, week: str) -> dict[str, str]:
    return {image.name: input_hash(image, rev, week=week) for image in IMAGES}


def _entry(image: Image, digest: str) -> dict[str, str]:
    return {**asdict(image), "repository": image.repository, "hash": digest}


def plan_pull_request(base: str, *, week: str) -> tuple[list[dict], list[dict]]:
    merge_base = _git("merge-base", base, "HEAD").strip()
    head = hashes("HEAD", week=week)
    before = {
        image.name: input_hash(image, merge_base, week=week)
        for image in IMAGES
        if _tracks(merge_base, image.dockerfile)
    }
    images = [_entry(image, head[image.name]) for image in IMAGES]
    return [entry for entry in images if head[entry["name"]] != before.get(entry["name"])], images


Published = Callable[[str, str], bool | None]


def plan_push(published: Published, *, week: str) -> tuple[list[dict], list[dict]]:
    head = hashes("HEAD", week=week)
    images = [_entry(image, head[image.name]) for image in IMAGES]
    return [entry for entry in images if published(entry["name"], f"inputs-{entry['hash']}") is not True], images


def registry_lookup(owner: str) -> Published:

    repositories = {image.name: image.repository for image in IMAGES}

    def published(name: str, tag: str) -> bool | None:
        env = {**os.environ, "REPOSITORY": repositories[name]}
        result = subprocess.run(
            ["bash", str(FIND_PUBLISHED_TAG), owner, name, tag], capture_output=True, text=True, check=False, env=env
        )
        sys.stderr.write(result.stderr)
        return {0: True, 1: False}.get(result.returncode)

    return published


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Name each image by what goes into it, and decide which images a CI run must build."
    )
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("hashes").add_argument("rev", nargs="?", default="HEAD")
    sub.add_parser("inputs").add_argument("image", choices=[image.name for image in IMAGES])
    sub.add_parser("build-args").add_argument("image", choices=[image.name for image in IMAGES])
    plan = sub.add_parser("plan")
    side = plan.add_mutually_exclusive_group(required=True)
    side.add_argument("--base")
    side.add_argument("--registry", metavar="OWNER")
    args = parser.parse_args(argv)

    week = iso_week(datetime.datetime.now(datetime.UTC).date())
    if args.command == "hashes":
        print(json.dumps(hashes(args.rev, week=week), indent=2))
        return 0
    if args.command == "inputs":
        print("\n".join(inputs(next(image for image in IMAGES if image.name == args.image))))
        return 0
    if args.command == "build-args":
        for key, value in build_args(next(image for image in IMAGES if image.name == args.image)).items():
            print(f"{key}={value}")
        return 0

    if args.base:
        build, images = plan_pull_request(args.base, week=week)
    else:
        build, images = plan_push(registry_lookup(args.registry), week=week)
    for entry in images:
        verdict = "build" if entry in build else "already built"
        print(f"{entry['name']}: inputs-{entry['hash']} ({verdict})")
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(f"build={json.dumps(build)}\n")
            handle.write(f"images={json.dumps(images)}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
