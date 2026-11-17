#!/usr/bin/env python3


from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

INDEX = Path("docs/architecture/where-is-what.md")

CODE_SPAN_RE = re.compile(r"`([^`\n]+)`")

SOURCE_SUFFIXES = (
    ".py",
    ".ts",
    ".tsx",
    ".mjs",
    ".md",
    ".json",
    ".sql",
    ".yml",
    ".yaml",
)

PATH_SHAPE_RE = re.compile(r"^[A-Za-z0-9._\-/\[\]]+$")

BASELINE = Path("ci/doc_paths_baseline.json")

RATCHETED = ("docs/architecture/", "docs/contributing/")

GENERATED = ("node_modules/", ".claude/", ".agents/", ".venv/", "apm_modules/")


def tracked_paths() -> set[str]:
    out = subprocess.run(["git", "ls-files"], capture_output=True, text=True, check=True).stdout
    files = set(out.splitlines())
    directories = {parent.as_posix() for f in files for parent in Path(f).parents if parent.as_posix() != "."}
    return files | directories


def is_path_claim(span: str) -> bool:
    if not PATH_SHAPE_RE.match(span):
        return False
    if span.startswith(("http://", "https://", "/", ".")):
        return False
    return "/" in span or span.endswith(SOURCE_SUFFIXES)


def path_claims(text: str) -> list[str]:
    seen: dict[str, None] = {}
    for span in CODE_SPAN_RE.findall(text):
        candidate = span.strip()
        if is_path_claim(candidate):
            seen.setdefault(candidate, None)
    return list(seen)


def check(errors: list[str]) -> list[str]:
    if not INDEX.exists():
        errors.append(f"{INDEX}: the concept index is missing.")
        return []

    tracked = tracked_paths()
    claims = path_claims(INDEX.read_text(encoding="utf-8"))
    for claim in claims:
        bare = claim.rstrip("/")
        beside_index = (INDEX.parent / bare).as_posix()
        if bare in tracked or beside_index in tracked:
            continue
        if Path(claim).exists():
            errors.append(f"{INDEX}: `{claim}` exists but git does not track it, so the row is dead for other readers.")
            continue
        errors.append(f"{INDEX}: `{claim}` does not exist. Update the row, or delete it.")
    return claims


def path_suffixes(tracked: set[str]) -> set[str]:
    suffixes: set[str] = set()
    for path in tracked:
        parts = path.split("/")
        suffixes.update("/".join(parts[i:]) for i in range(len(parts)))
    return suffixes


def dead_claims(doc: Path, suffixes: set[str]) -> list[str]:
    dead = []
    for claim in path_claims(doc.read_text(encoding="utf-8")):
        if not claim.endswith((*SOURCE_SUFFIXES, "/")) or "*" in claim or claim.startswith(GENERATED):
            continue
        if claim.rstrip("/") not in suffixes:
            dead.append(claim)
    return dead


def scoped_docs(tracked: set[str]) -> tuple[list[Path], list[Path]]:
    guides = sorted(Path(p) for p in tracked if Path(p).name == "AGENTS.md" and Path(p).exists())
    docs = sorted(Path(p) for p in tracked if p.startswith(RATCHETED) and p.endswith(".md") and Path(p).exists())
    return guides, docs


def check_scoped(errors: list[str], update: bool = False) -> None:
    tracked = tracked_paths()
    suffixes = path_suffixes(tracked)
    guides, docs = scoped_docs(tracked)
    for guide in guides:
        errors.extend(
            f"{guide}: `{claim}` names no tracked file. Fix the path or drop it."
            for claim in dead_claims(guide, suffixes)
        )
    counts = {d.as_posix(): n for d in docs if (n := len(dead_claims(d, suffixes)))}
    if update:
        BASELINE.write_text(json.dumps(counts, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return
    baseline = json.loads(BASELINE.read_text(encoding="utf-8")) if BASELINE.exists() else {}
    for doc, n in sorted(counts.items()):
        if n > baseline.get(doc, 0):
            dead = ", ".join(f"`{c}`" for c in dead_claims(Path(doc), suffixes))
            errors.append(f"{doc}: {n} dead path(s), baseline {baseline.get(doc, 0)}: {dead}. Fix the new one.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Keep the paths written in agent guides and docs pointing at files that exist."
    )
    parser.add_argument("--list", action="store_true", help="List the path claims found and exit 0.")
    parser.add_argument("--update", action="store_true", help=f"Rewrite {BASELINE} to the current counts.")
    args = parser.parse_args(argv)

    if args.update:
        check_scoped([], update=True)
        print(f"Wrote {BASELINE}.")
        return 0

    if args.list:
        for claim in path_claims(INDEX.read_text(encoding="utf-8")):
            print(claim)
        return 0

    errors: list[str] = []
    claims = check(errors)
    check_scoped(errors)

    if errors:
        print(f"Doc-path check FAILED ({len(errors)} error(s)):", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    print(f"Doc-path check passed: {len(claims)} path(s) in {INDEX} resolve; the guides and docs hold their baseline.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
