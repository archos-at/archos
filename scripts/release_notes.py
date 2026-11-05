#!/usr/bin/env python3
"""Release notes: lint the reno notes, publish them to the website and to the app.

The pipeline this file implements
---------------------------------

1. A change that a customer can notice ships with a reno note
   (``releasenotes/notes/<slug>-<hash>.yaml``, written with ``task release:note``),
   in one product area (its ``# area:`` line). ``lint`` enforces the house
   rules on it, on every PR.
2. On merge to ``develop``, ``publish`` reads the notes **through reno**, so a
   note is attributed to the release it actually shipped in, from git history
   rather than from whatever the file claims; translates the new English
   strings into German once; and writes two artifacts, one per reader
   (ADR-0154):

   * ``apps/website/src/data/changelog.json``, the **public** tier: the weekly
     summaries from ``releasenotes/summaries.yaml``, and nothing else;
   * ``apps/workspace/bff/release-notes/release-notes.generated.json``, the
     **customer** tier: every note of the customer sections, with its section
     and area, for the app's "What's new" behind sign-in.

   ``security``, ``incident`` and ``operators`` notes reach neither.
3. The website renders the first at ``/changelog/`` and ``/en/changelog/``; the
   app renders the second at ``/app/whats-new``. Both images are built from the
   repo, so the commit made in step 2 is what puts a note in front of a reader.

The modules beside this file hold the parts: ``release_notes_rules`` (the house
rules), ``release_notes_areas`` (the area vocabulary and its guess),
``release_notes_build`` (reading, grouping, the two artifacts) and
``release_notes_translate`` (the German side and its cache).

Why JSON artifacts instead of ``reno report``
---------------------------------------------

``reno report`` emits reStructuredText for a Sphinx build. The readers are an
Astro site and a Next.js app, and the notes have to survive machine translation
string by string (so a translation is cached per sentence, not per release). A
structured artifact gives both.

Why the artifacts are committed rather than generated at build time
-------------------------------------------------------------------

reno derives versions from git history, and the image builds have neither the
history (they copy a working tree) nor this Python toolchain. Generating on
merge and committing the result keeps the image builds hermetic and offline.

Usage
-----

    python scripts/release_notes.py lint
    python scripts/release_notes.py publish [--check] [--no-translate]
    python scripts/release_notes.py week 2026-W44

reno itself is deliberately *not* a repo dependency (it is needed by two
commands and a workflow, not by the product), so the Taskfile runs this script
under ``uv run --no-project --with reno``. Everything except the git scan works
without it, which is also what keeps the unit tests reno-free.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date
from pathlib import Path
from typing import Any

# The modules beside this file, importable however the script is started (by
# path from the Taskfile, or loaded by path from the tests).
sys.path.insert(0, str(Path(__file__).resolve().parent))

from release_notes_build import build_customer_changelog  # noqa: E402
from release_notes_build import build_public_changelog  # noqa: E402
from release_notes_build import collect_strings  # noqa: E402
from release_notes_build import customer_sections  # noqa: E402
from release_notes_build import group_notes  # noqa: E402
from release_notes_build import load_notes_from_reno  # noqa: E402
from release_notes_build import load_summaries  # noqa: E402
from release_notes_build import read_config_sections  # noqa: E402
from release_notes_build import summaries_due  # noqa: E402
from release_notes_rules import lint_note  # noqa: E402
from release_notes_rules import lint_summaries  # noqa: E402
from release_notes_translate import load_translations  # noqa: E402
from release_notes_translate import prune_translations  # noqa: E402
from release_notes_translate import resolve_translations  # noqa: E402
from release_notes_translate import save_translations  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
RELNOTES_DIR = REPO_ROOT / "releasenotes"
NOTES_DIR = RELNOTES_DIR / "notes"
TRANSLATIONS_FILE = RELNOTES_DIR / "translations" / "de.json"
SUMMARIES_FILE = RELNOTES_DIR / "summaries.yaml"
# The public tier, for the website.
CHANGELOG_FILE = REPO_ROOT / "apps" / "website" / "src" / "data" / "changelog.json"
# The customer tier, for the app.
CUSTOMER_FILE = REPO_ROOT / "apps" / "workspace" / "bff" / "release-notes" / "release-notes.generated.json"


def dump_json(data: dict[str, Any]) -> str:
    """Deterministic serialisation: the files are diffed and committed by a bot."""
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def cmd_lint(args: argparse.Namespace) -> int:
    notes_dir = Path(args.notes_dir)
    valid_sections = {key for key, _ in read_config_sections(Path(args.config))}
    files = sorted(p for p in notes_dir.glob("*.yaml"))
    problems: list[str] = []
    for path in files:
        problems.extend(lint_note(path.name, path.read_text(encoding="utf-8"), valid_sections))
    summaries = Path(args.summaries)
    if summaries.exists():
        problems.extend(lint_summaries(summaries.read_text(encoding="utf-8")))

    if problems:
        print(f"\nRelease-note lint failed ({len(problems)}):\n", file=sys.stderr)
        for problem in problems:
            print(f"  ✗ {problem}", file=sys.stderr)
        print(
            "\nCustomer notes reach the app's What's new; the public /changelog/ shows only the weekly summaries;\n"
            "`security`, `incident` and `operators` reach neither. Rules and examples: "
            "docs/contributing/release-notes.md.\n",
            file=sys.stderr,
        )
        return 1
    print(f"Release-note lint passed ({len(files)} notes).")
    return 0


def _render(args: argparse.Namespace) -> tuple[dict[Path, str], list[str], list[str], dict[str, Any]]:
    """Both artifacts as text, keyed by where they go, with what is untranslated and what is due."""
    repo_root = Path(args.repo_root)
    sections = customer_sections(read_config_sections(repo_root / "releasenotes" / "config.yaml"))
    notes = load_notes_from_reno(repo_root)
    groups = group_notes(notes, [key for key, _ in sections], load_summaries(Path(args.summaries)))

    strings = collect_strings(groups)
    translations = load_translations(Path(args.translations))
    german, untranslated = resolve_translations(
        strings,
        translations,
        enabled=not args.no_translate,
        require=args.require_translations,
    )
    rendered = {
        Path(args.output): dump_json(build_public_changelog(groups, german)),
        Path(args.customer_output): dump_json(build_customer_changelog(groups, sections, german)),
    }
    state = {"translations": translations, "strings": strings, "groups": groups}
    return rendered, untranslated, summaries_due(groups, date.today()), state


def _report_due(due: list[str]) -> None:
    """Weeks the public page leaves out until someone summarises them; an annotation on GitHub."""
    prefix = "::warning title=Weekly summary due::" if os.environ.get("GITHUB_ACTIONS") else "  ! "
    for week in due:
        print(
            f"{prefix}{week} has customer notes and no summary in releasenotes/summaries.yaml, "
            "so the public changelog does not list it.",
            file=sys.stderr,
        )


def cmd_publish(args: argparse.Namespace) -> int:
    rendered, untranslated, due, state = _render(args)
    _report_due(due)
    if args.check:
        stale = [path for path, text in rendered.items() if not path.exists() or path.read_text("utf-8") != text]
        for path in stale:
            print(f"{path} is out of date with releasenotes/. Run `task release:changelog`.", file=sys.stderr)
        if stale:
            return 1
        print(f"Both artifacts are up to date ({len(state['strings'])} strings).")
        return 0

    for path, text in rendered.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    if not args.no_translate:
        save_translations(Path(args.translations), prune_translations(state["translations"], state["strings"]))

    for text in untranslated:
        print(f"  ! no German translation, published in English: {text[:80]}…", file=sys.stderr)
    weeks = state["groups"]
    public = sum(1 for group in weeks if group["summary"])
    print(f"Wrote {len(rendered)} artifacts: {public} public summaries, {len(weeks)} release(s) in the app.")
    return 0


def cmd_week(args: argparse.Namespace) -> int:
    """One week's customer notes by area, from the committed app artifact: what its summary is written from."""
    artifact = json.loads(Path(args.customer_output).read_text(encoding="utf-8"))
    release = next((item for item in artifact["releases"] if item["id"] == args.week), None)
    if release is None:
        print(f"{args.week} has no customer notes. Weeks: {', '.join(r['id'] for r in artifact['releases'])}")
        return 1
    print(f"{args.week} ({release['date']} to {release['dateEnd']}), {len(release['notes'])} notes")
    if release["summary"]:
        print(f"\nSummary: {release['summary']['en']}")
    for area in artifact["areas"]:
        notes = [note for note in release["notes"] if note["area"] == area]
        if notes:
            print(f"\n{area} ({len(notes)})")
            for note in notes:
                print(f"  [{note['section']}] {note['text']['en']}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)

    lint = sub.add_parser("lint", help="check the notes against the house rules")
    lint.add_argument("--notes-dir", default=str(NOTES_DIR))
    lint.add_argument("--config", default=str(RELNOTES_DIR / "config.yaml"))
    lint.add_argument("--summaries", default=str(SUMMARIES_FILE))
    lint.set_defaults(func=cmd_lint)

    publish = sub.add_parser("publish", help="regenerate the public and the customer artifact")
    publish.add_argument("--repo-root", default=str(REPO_ROOT))
    publish.add_argument("--output", default=str(CHANGELOG_FILE), help="the public artifact (website)")
    publish.add_argument("--customer-output", default=str(CUSTOMER_FILE), help="the customer artifact (app)")
    publish.add_argument("--translations", default=str(TRANSLATIONS_FILE))
    publish.add_argument("--summaries", default=str(SUMMARIES_FILE))
    publish.add_argument(
        "--no-translate",
        action="store_true",
        help="use the cached translations only; never call the translation API",
    )
    publish.add_argument(
        "--require-translations",
        action="store_true",
        help="fail instead of publishing an English sentence to a German reader",
    )
    publish.add_argument(
        "--check",
        action="store_true",
        help="verify the committed artifacts match the notes; write nothing",
    )
    publish.set_defaults(func=cmd_publish)

    week = sub.add_parser("week", help="list one week's customer notes by area, to write its summary from")
    week.add_argument("week", help="an ISO week id, such as 2026-W44")
    week.add_argument("--customer-output", default=str(CUSTOMER_FILE))
    week.set_defaults(func=cmd_week)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
