"""Release notes: from the notes reno reads to the two artifacts the readers get.

Three tiers, one source (ADR-0156, docs/contributing/release-notes.md):

* **public**, the website's /changelog/: one editorial summary per week
  (releasenotes/summaries.yaml) and nothing else. No per-note line reaches the
  public page, so the page does not map the product's internals for anyone
  reading it closely, and a week without a summary is not listed.
* **customers**, the app's "What's new" for signed-in members: every note of the
  customer sections, grouped by week, each with its section and product area.
* **internal**: `security`, `incident` and `operators`, kept in the repository
  and in neither artifact.

Split out of ``release_notes.py``, which is the command line around it.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from dataclasses import field
from datetime import date
from datetime import timedelta
from pathlib import Path
from typing import Any

import yaml
from release_notes_areas import AREAS
from release_notes_areas import note_area
from release_notes_rules import INTERNAL_SECTIONS
from release_notes_rules import PRELUDE_SECTION
from release_notes_rules import clean


@dataclass
class Note:
    """One note file, as published: its sections and where it landed."""

    filename: str
    version: str
    date: str | None
    sections: dict[str, list[str]] = field(default_factory=dict)
    prelude: str | None = None

    area: str = "general"


# ── Note loading ────────────────────────────────────────────────────────────


def read_config_sections(config_path: Path) -> list[tuple[str, str]]:
    """The `(key, English title)` pairs from reno's own config, in render order."""
    data = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    sections = data.get("sections") or []
    # reno accepts `[key, title]` and `[key, title, level]`; only the first two
    # matter here.
    return [(entry[0], entry[1]) for entry in sections]


def load_notes_from_reno(repo_root: Path, relnotes_dir_name: str = "releasenotes") -> list[Note]:
    """Read every note through reno, so git history decides where a note belongs.

    Imported lazily: reno is a release-tooling dependency, and everything that
    can be unit tested here works on the structures this function returns rather
    than on reno itself.
    """
    from reno import config as reno_config
    from reno import loader as reno_loader

    conf = reno_config.Config(str(repo_root), relnotes_dir_name)
    added = note_added_dates(repo_root, f"{relnotes_dir_name}/notes")
    notes: list[Note] = []
    with reno_loader.Loader(conf) as ldr:
        for version in ldr.versions:
            for filename, sha in ldr[version]:
                body = ldr.parse_note_file(filename, sha)
                if not body:
                    continue
                day = added.get(Path(filename).name) or _note_date(repo_root, sha)
                notes.append(note_from_body(filename, version, day, body, _read_raw(repo_root / filename)))
    return notes


def note_from_body(filename: str, version: str, day: str | None, body: dict[str, Any], raw: str | None) -> Note:
    """One parsed note, with its product area from its `# area:` line or the guess."""
    sections = {
        key: [value] if isinstance(value, str) else list(value) for key, value in body.items() if key != PRELUDE_SECTION
    }
    customer_text = " ".join(" ".join(entries) for key, entries in sections.items() if key not in INTERNAL_SECTIONS)
    return Note(
        filename=filename,
        version=version,
        date=day,
        sections=sections,
        prelude=body.get(PRELUDE_SECTION),
        area=note_area(filename, raw, customer_text),
    )


def _read_raw(path: Path) -> str | None:
    """A note file as written, comments included: reno hands back only the parsed YAML.

    The `# area:` line is a comment, so it is read from the file in the working
    tree, which is the tip reno reads. A note that is gone from the tree gets
    the guess.
    """
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return None


def note_added_dates(repo_root: Path, notes_path: str) -> dict[str, str]:
    """The day each note file first entered history, keyed by its file name.

    reno hands back the sha of a note's *latest* revision, so dating a note by
    that sha moved it to the day somebody last corrected it: fixing a typo in an
    August note republished it under this week. The first commit that added the
    file is the day it shipped. Renames carry the original date over, because
    reno treats a renamed note (same unique id) as the same note.
    """
    try:
        out = subprocess.run(
            ["git", "log", "--reverse", "-M", "--name-status", "--format=@%cI", "--", notes_path],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    except (subprocess.CalledProcessError, OSError):
        return {}
    return parse_added_dates(out)


def parse_added_dates(log: str) -> dict[str, str]:
    """Fold `git log --reverse --name-status --format=@%cI` output into first-add dates."""
    added: dict[str, str] = {}
    day = ""
    for line in log.splitlines():
        if line.startswith("@"):
            day = line[1:11]
            continue
        parts = line.split("\t")
        status = parts[0][:1]
        if status == "A" and len(parts) == 2:
            added.setdefault(Path(parts[1]).name, day)
        elif status == "R" and len(parts) == 3:
            added.setdefault(Path(parts[2]).name, added.get(Path(parts[1]).name, day))
    return added


def _note_date(repo_root: Path, sha: bytes | str | None) -> str | None:
    """The day a commit landed: the fallback when a note's first add is unknown.

    `sha` is None for a note that is staged but not yet committed (reno reports
    those under a `*working-copy*` version), which is the normal state during a
    local preview.
    """
    if not sha:
        return None
    rev = sha.decode() if isinstance(sha, bytes) else sha
    try:
        out = subprocess.run(
            ["git", "log", "-1", "--format=%cI", rev],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=True,
        )
    except (subprocess.CalledProcessError, OSError):
        return None
    stamp = out.stdout.strip()
    return stamp[:10] if stamp else None


# ── Grouping ────────────────────────────────────────────────────────────────


def group_notes(
    notes: list[Note],
    section_order: list[str],
    summaries: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Group notes into the releases the readers see, newest first.

    Two shapes, because the repo has both futures in it:

    * a **version** group, once release tagging starts: reno hands us the tag
      and every note that shipped under it;
    * a **week** group, which is what the repo produces today: nothing is
      tagged, so reno files everything under one unreleased version. The repo
      merges many times a day; an ISO week is the unit a reader can take in.

    Only sections in `section_order` survive, which is how the internal
    sections (`INTERNAL_SECTIONS`) stay out of every artifact. A group's notes
    are flat, each with its section and area, in section order. Its summary
    comes from `summaries` (releasenotes/summaries.yaml, keyed by group id) and
    falls back to a reno prelude.
    """
    summaries = summaries or {}
    groups: dict[str, dict[str, Any]] = {}
    for note in notes:
        if not any(section in section_order for section in note.sections) and not note.prelude:
            continue
        group = groups.setdefault(*_group_for(note))
        if note.prelude and not group["summary"]:
            group["summary"] = clean(note.prelude)
        for section, entries in note.sections.items():
            if section in section_order:
                group["notes"].extend(
                    {"section": section, "area": note.area, "text": clean(entry)} for entry in entries
                )

    ordered = sorted(groups.values(), key=lambda g: g["_sort"], reverse=True)
    for group in ordered:
        del group["_sort"]
        if group["id"] in summaries:
            group["summary"] = clean(summaries[group["id"]])
        group["notes"].sort(key=lambda item: section_order.index(item["section"]))
    return [group for group in ordered if group["notes"] or group["summary"]]


def _group_for(note: Note) -> tuple[str, dict[str, Any]]:
    """The group id a note belongs to, and the empty group to start it with."""
    if _is_release_version(note.version):
        group_id, kind, start, end, sort = note.version, "version", note.date, None, ("1", note.version)
    elif note.date:
        group_id, start, end = week_of(note.date)
        kind, sort = "week", ("0", start)
    else:
        group_id, kind, start, end, sort = "unreleased", "week", None, None, ("0", "9999-99-99")
    return group_id, {
        "id": group_id,
        "kind": kind,
        "version": note.version if kind == "version" else None,
        "date": start,
        "dateEnd": end,
        "summary": None,
        "notes": [],
        "_sort": sort,
    }


def week_of(day: str) -> tuple[str, str, str]:
    """`2026-09-26` -> (`2026-W39`, Monday `2026-09-21`, Sunday `2026-09-27`)."""
    when = date.fromisoformat(day)
    year, week, weekday = when.isocalendar()
    monday = when - timedelta(days=weekday - 1)
    return f"{year}-W{week:02d}", monday.isoformat(), (monday + timedelta(days=6)).isoformat()


def _is_release_version(version: str) -> bool:
    """True for a real tag; false for reno's unreleased placeholders.

    Untagged repositories get `0.0.0`, a working tree gets `*working-copy*`, and
    commits after a tag get `<tag>-<n>`: none of those is something to print as
    a release heading.
    """
    if version.startswith("*") or "-" in version:
        return False
    return version != "0.0.0"


def summaries_due(groups: list[dict[str, Any]], today: date) -> list[str]:
    """Finished weeks that shipped customer notes and have no summary: invisible on the public page.

    Reported by `publish`, never a lint failure: the summary is one person's
    editorial work after the week, and failing every pull request until it is
    written would make that person everyone's blocker. The page stays honest in
    the meantime, because a week without a summary is simply not listed.
    """
    return [
        group["id"]
        for group in groups
        if group["kind"] == "week"
        and group["notes"]
        and not group["summary"]
        and group["dateEnd"]
        and date.fromisoformat(group["dateEnd"]) < today
    ]


def load_summaries(path: Path) -> dict[str, str]:
    """The editorial summary of each week or version, keyed by its group id."""
    if not path.exists():
        return {}
    content = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return {str(key): value for key, value in content.items() if isinstance(value, str)}


def customer_sections(sections: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """The configured sections a customer reads: all but the internal ones."""
    return [(key, title) for key, title in sections if key not in INTERNAL_SECTIONS]


def collect_strings(groups: list[dict[str, Any]]) -> list[str]:
    """Every English string either artifact shows, in a stable order.

    The customer artifact holds every string the public one does (the public
    page is the summaries), so this is one list and one translation cache.
    """
    strings: list[str] = []
    for group in groups:
        if group.get("summary"):
            strings.append(group["summary"])
        strings.extend(item["text"] for item in group["notes"])
    # dict.fromkeys: de-duplicate without losing the order (a translation is paid
    # for once even when the same sentence appears twice).
    return list(dict.fromkeys(strings))


# ── The two artifacts ───────────────────────────────────────────────────────

GENERATED = (
    "GENERATED FILE, do not edit. Written by scripts/release_notes.py from releasenotes/ and committed "
    "by .github/workflows/release-notes.yml on merge to develop. Regenerate with `task release:changelog`."
)


def _bilingual(text: str, german: dict[str, str]) -> dict[str, str]:
    return {"en": text, "de": german.get(text, text)}


def _heading(group: dict[str, Any]) -> dict[str, Any]:
    """What both artifacts say about a release: which week or version, and when."""
    return {
        "id": group["id"],
        "kind": group["kind"],
        "version": group["version"],
        "date": group["date"],
        "dateEnd": group.get("dateEnd"),
    }


def build_public_changelog(groups: list[dict[str, Any]], german: dict[str, str]) -> dict[str, Any]:
    """The website's artifact: the weeks that have a summary, and only the summary."""
    return {
        "$comment": GENERATED + " The public tier: one summary per week, never a single note.",
        "releases": [
            {**_heading(group), "summary": _bilingual(group["summary"], german)} for group in groups if group["summary"]
        ],
    }


def build_customer_changelog(
    groups: list[dict[str, Any]],
    sections: list[tuple[str, str]],
    german: dict[str, str],
) -> dict[str, Any]:
    """The app's artifact: every customer note of every week, with its section and area."""
    return {
        "$comment": GENERATED + " The customer tier: shown to signed-in members only.",
        "sections": [key for key, _ in sections],
        "areas": list(AREAS),
        "releases": [
            {
                **_heading(group),
                "summary": _bilingual(group["summary"], german) if group["summary"] else None,
                "notes": [
                    {"section": item["section"], "area": item["area"], "text": _bilingual(item["text"], german)}
                    for item in group["notes"]
                ],
            }
            for group in groups
        ],
    }
