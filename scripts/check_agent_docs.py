#!/usr/bin/env python3

"""Check that every ``AGENTS.md`` actually reaches Claude Code.

Why this exists
---------------

Claude Code reads ``CLAUDE.md`` and never ``AGENTS.md``. The bridge between them
is an import, ``@AGENTS.md``, and the ``@`` is the entire mechanism. Written
without it the file is one line of prose that happens to name a filename: the
guide never loads, ``/context`` still lists a memory file, and nothing reports a
problem.

The root ``CLAUDE.md`` of this repository was exactly that for its whole life —
the ten bytes ``AGENTS.md\\n`` — so every Claude session ran with the root guide
silently absent. It is the second time this repo has shipped a committed text
file containing a path that never resolved; the first was ten "symlinks" under
``.claude/skills/``, committed as mode 100644 rather than 120000.

A missing guide has no symptom, which is what makes it worth a gate rather than
a gotcha entry.

What it checks
--------------

1. Every ``AGENTS.md`` has a ``CLAUDE.md`` beside it.
2. Every such ``CLAUDE.md`` imports it with a real ``@AGENTS.md`` line.
3. No ``CLAUDE.md`` mentions ``AGENTS.md`` only as bare text.
4. Every relative link in every tracked Markdown file resolves against
   **git**, not the filesystem — a link into a generated directory
   (``.claude/``, ``.agents/``, ``node_modules/``) passes on the author's machine
   and is dead in CI's fresh checkout and for every reader who has not run
   ``task setup``. markdown-link-check reads the filesystem, so it cannot see
   this.
5. No guide grows, and no new guide appears, past ``ci/agent_docs_baseline.json``.
   A guide holds only what an agent would get wrong in its scope; documentation
   lives under ``docs/`` and is linked (``docs/contributing/working-style.md``,
   "Context earns its place"). The baseline only shrinks: after cutting a guide,
   or deliberately adding one, run ``--update`` and commit the result, so the
   growth is a reviewed diff rather than a drift.

Usage:
    python scripts/check_agent_docs.py [--list] [--update]

Exit code is 0 when every guide is wired up, 1 otherwise.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

IMPORT_RE = re.compile(r"^\s*@(?:\./)?AGENTS\.md\s*$", re.MULTILINE)

BARE_MENTION_RE = re.compile(r"^\s*(?:\./)?AGENTS\.md\s*$", re.MULTILINE)

MD_LINK_RE = re.compile(r"\[[^\]]*\]\(([^)#]+)(?:#[^)]*)?\)")

GENERATED = ("node_modules/", ".claude/", ".agents/", "apm_modules/", ".venv/")

LINKS_NOT_CHECKED = frozenset({"packages/agent/src/agent/skills/review/skill-check/SKILL.md"})

BASELINE = Path("ci/agent_docs_baseline.json")


def tracked_files() -> set[str]:
    """Every path git knows about, which is the only tree a reader is guaranteed."""
    out = subprocess.run(["git", "ls-files"], capture_output=True, text=True, check=True).stdout
    return set(out.splitlines())


def agents_files(tracked: set[str]) -> list[Path]:
    """Tracked ``AGENTS.md`` files, newest scopes and root alike."""
    return sorted(Path(p) for p in tracked if Path(p).name == "AGENTS.md")


def check_bridge(agents: Path, tracked: set[str], errors: list[str]) -> None:
    """Assert ``agents`` has a *tracked* sibling ``CLAUDE.md`` that imports it.

    Tracked, not merely present: an untracked local bridge satisfies the author's
    working tree and nobody else's checkout, which is the same class of bug as
    the missing ``@`` this script exists for.
    """
    bridge = agents.with_name("CLAUDE.md")
    if not agents.exists():
        errors.append(
            f"{agents}: deleted but still tracked. Stage the deletion with its bridge: git rm {agents} {bridge}"
        )
        return
    if bridge.as_posix() in tracked and not bridge.exists():
        errors.append(f"{bridge}: deleted but still tracked, so {agents} no longer loads. Restore it or git rm both.")
        return
    if bridge.as_posix() not in tracked:
        if bridge.exists():
            errors.append(
                f"{bridge}: exists but is not tracked by git, so {agents} loads for you and for nobody else. Commit it."
            )
            return
        errors.append(
            f"{agents}: no CLAUDE.md beside it. Claude Code reads CLAUDE.md, "
            f"never AGENTS.md, so this guide never loads. "
            f"Create {bridge} containing the single line '@AGENTS.md'."
        )
        return

    text = bridge.read_text(encoding="utf-8")
    if IMPORT_RE.search(text):
        return

    if BARE_MENTION_RE.search(text):
        errors.append(
            f"{bridge}: names AGENTS.md without the leading '@', so it is prose, "
            f"not an import, and {agents} never loads. Write '@AGENTS.md'."
        )
    else:
        errors.append(f"{bridge}: no '@AGENTS.md' import line, so {agents} never loads.")


def markdown_files(tracked: set[str]) -> list[Path]:
    """Tracked Markdown whose relative links must resolve in a fresh checkout."""
    return sorted(Path(p) for p in tracked if p.endswith(".md") and p not in LINKS_NOT_CHECKED)


def check_links(doc: Path, tracked: set[str], errors: list[str]) -> None:
    """Assert every relative link in ``doc`` resolves in a fresh checkout."""
    for target in MD_LINK_RE.findall(doc.read_text(encoding="utf-8")):
        target = target.strip()
        if target.startswith(("http://", "https://", "mailto:", "<")):
            continue
        if "<" in target:
            continue
        if any(seg in target for seg in GENERATED):
            errors.append(
                f"{doc}: links into a generated directory ({target}). "
                f"It resolves only after `task setup` and is dead for every "
                f"other reader."
            )
            continue
        resolved = (doc.parent / target).resolve()
        try:
            rel = resolved.relative_to(Path.cwd().resolve()).as_posix()
        except ValueError:
            errors.append(f"{doc}: link escapes the repository ({target}).")
            continue
        if rel in tracked or any(t.startswith(rel + "/") for t in tracked):
            continue
        errors.append(f"{doc}: dead link, not tracked by git ({target}).")


def guide_lines(guides: list[Path]) -> dict[str, int]:
    """Line count of every guide still on disk, keyed by its repo path."""
    return {g.as_posix(): len(g.read_text(encoding="utf-8").splitlines()) for g in guides if g.exists()}


def check_growth(counts: dict[str, int], errors: list[str]) -> None:
    """Assert no guide is longer than its baseline entry and none is new."""
    baseline = json.loads(BASELINE.read_text(encoding="utf-8")) if BASELINE.exists() else {}
    for path, lines in sorted(counts.items()):
        allowed = baseline.get(path)
        if allowed is None:
            errors.append(
                f"{path}: a new guide. Put what it says in the nearest existing guide or under docs/; "
                f"if it must exist, run --update so the new entry is reviewed."
            )
        elif lines > allowed:
            errors.append(
                f"{path}: {lines} lines, baseline {allowed}. A guide holds what an agent would get wrong "
                f"here; move the explanation under docs/ and link it, or delete a line to pay for this one."
            )


def main(argv: list[str] | None = None) -> int:
    """CLI entry point: check every tracked AGENTS.md and return an exit code."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="store_true", help="List the guides found and exit 0.")
    parser.add_argument("--update", action="store_true", help=f"Rewrite {BASELINE} to the current line counts.")
    args = parser.parse_args(argv)

    tracked = tracked_files()
    guides = agents_files(tracked)

    if args.update:
        BASELINE.write_text(json.dumps(guide_lines(guides), indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(f"Wrote {BASELINE}.")
        return 0

    if args.list:
        for g in guides:
            print(g)
        return 0

    errors: list[str] = []
    for guide in guides:
        check_bridge(guide, tracked, errors)
    check_growth(guide_lines(guides), errors)
    for doc in markdown_files(tracked):
        if doc.exists():
            check_links(doc, tracked, errors)

    if errors:
        print(f"Agent-doc check FAILED ({len(errors)} error(s)):", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    print(f"Agent-doc check passed: {len(guides)} guide(s) wired up.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
