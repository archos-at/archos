#!/usr/bin/env python3

"""Keep the paths written in agent guides and docs pointing at files that exist.

Why this exists
---------------

``docs/architecture/where-is-what.md`` is a concept-to-path index: an agent
arrives with the name of a thing and leaves with the module that owns it. Its
whole value is that the paths resolve. A rename anywhere in the repo silently
turns a row into a dead end, and the symptom is the one the index was written to
remove — somebody greps.

Nothing else catches it. The paths sit in code spans rather than links, so
``markdown-link-check`` never looks at them, and the file type-checks and builds
like any other Markdown.

What it checks
--------------

Every backticked span in the index that looks like a repository path (it
contains a ``/`` or ends in a known source extension, and is not prose, a
command or an identifier) names something **git tracks** — a file or a
directory. Tracked, not merely present: a path that resolves only in the
author's working tree is dead for every other reader.

A claim is read from the repository root first and from the index's own
directory second, which is how a reader reads it: the sibling docs are named
``document-roles.md`` in the prose and live beside the index.

The same rot reaches every other doc an agent reads. An audit of the guides on
2026-11-15 found a dozen ``lib/...`` paths, a wrong module for
``FileOperationKind`` and more, all in code spans, all dead for months. So:

- **Every tracked ``AGENTS.md``** is held to zero. A guide is short and loads on
  every turn in its scope: a dead path there is a wrong instruction.
- **``docs/architecture/`` and ``docs/contributing/``** are a ratchet on
  ``ci/doc_paths_baseline.json``: a file may not gain a dead path, and lowers its
  entry with ``--update`` when it loses one. Some entries are deliberate, a path
  named because it is gone (``gotchas.md``), so the count is per file, not zero.

Outside the index a claim is looser, because guides name files the way people
do: ``test_proposals.py`` or ``common/bff_http.py``, not the full path. It must
end in a source extension or ``/`` and match the end of some tracked path. That
still fails on a rename or a deletion, which is what goes stale.

Usage:
    python scripts/check_doc_paths.py [--list] [--update]

Exit code is 0 when every path resolves, 1 otherwise.
"""

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
    """Every file git knows about, plus every directory that holds one."""
    out = subprocess.run(["git", "ls-files"], capture_output=True, text=True, check=True).stdout
    files = set(out.splitlines())
    directories = {parent.as_posix() for f in files for parent in Path(f).parents if parent.as_posix() != "."}
    return files | directories


def is_path_claim(span: str) -> bool:
    """Whether this code span promises a repository path."""
    if not PATH_SHAPE_RE.match(span):
        return False
    if span.startswith(("http://", "https://", "/", ".")):
        return False
    return "/" in span or span.endswith(SOURCE_SUFFIXES)


def path_claims(text: str) -> list[str]:
    """Every distinct path claim in the index, in the order it appears."""
    seen: dict[str, None] = {}
    for span in CODE_SPAN_RE.findall(text):
        candidate = span.strip()
        if is_path_claim(candidate):
            seen.setdefault(candidate, None)
    return list(seen)


def check(errors: list[str]) -> list[str]:
    """Validate every path claim, appending to ``errors``. Returns the claims."""
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
    """Every trailing run of segments of every tracked path: `a/b/c.py` gives `c.py`, `b/c.py`, `a/b/c.py`."""
    suffixes: set[str] = set()
    for path in tracked:
        parts = path.split("/")
        suffixes.update("/".join(parts[i:]) for i in range(len(parts)))
    return suffixes


def dead_claims(doc: Path, suffixes: set[str]) -> list[str]:
    """Path claims in ``doc`` that name no tracked file or directory, by the looser rule."""
    dead = []
    for claim in path_claims(doc.read_text(encoding="utf-8")):
        if not claim.endswith((*SOURCE_SUFFIXES, "/")) or "*" in claim or claim.startswith(GENERATED):
            continue
        if claim.rstrip("/") not in suffixes:
            dead.append(claim)
    return dead


def scoped_docs(tracked: set[str]) -> tuple[list[Path], list[Path]]:
    """The guides (held to zero) and the ratcheted docs, both as tracked files on disk."""
    guides = sorted(Path(p) for p in tracked if Path(p).name == "AGENTS.md" and Path(p).exists())
    docs = sorted(Path(p) for p in tracked if p.startswith(RATCHETED) and p.endswith(".md") and Path(p).exists())
    return guides, docs


def check_scoped(errors: list[str], update: bool = False) -> None:
    """Hold every guide to zero dead paths and every ratcheted doc to its baseline."""
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
    """CLI entry point: validate the concept index and return an exit code."""
    parser = argparse.ArgumentParser(description=__doc__)
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
