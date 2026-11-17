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

    filename: str
    version: str
    date: str | None
    sections: dict[str, list[str]] = field(default_factory=dict)
    prelude: str | None = None

    area: str = "general"




def read_config_sections(config_path: Path) -> list[tuple[str, str]]:
    data = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    sections = data.get("sections") or []
    return [(entry[0], entry[1]) for entry in sections]


def load_notes_from_reno(repo_root: Path, relnotes_dir_name: str = "releasenotes") -> list[Note]:
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
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return None


def note_added_dates(repo_root: Path, notes_path: str) -> dict[str, str]:
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




def group_notes(
    notes: list[Note],
    section_order: list[str],
    summaries: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
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
    when = date.fromisoformat(day)
    year, week, weekday = when.isocalendar()
    monday = when - timedelta(days=weekday - 1)
    return f"{year}-W{week:02d}", monday.isoformat(), (monday + timedelta(days=6)).isoformat()


def _is_release_version(version: str) -> bool:
    if version.startswith("*") or "-" in version:
        return False
    return version != "0.0.0"


def summaries_due(groups: list[dict[str, Any]], today: date) -> list[str]:
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
    if not path.exists():
        return {}
    content = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return {str(key): value for key, value in content.items() if isinstance(value, str)}


def customer_sections(sections: list[tuple[str, str]]) -> list[tuple[str, str]]:
    return [(key, title) for key, title in sections if key not in INTERNAL_SECTIONS]


def collect_strings(groups: list[dict[str, Any]]) -> list[str]:
    strings: list[str] = []
    for group in groups:
        if group.get("summary"):
            strings.append(group["summary"])
        strings.extend(item["text"] for item in group["notes"])
    return list(dict.fromkeys(strings))



GENERATED = (
    "GENERATED FILE, do not edit. Written by scripts/release_notes.py from releasenotes/ and committed "
    "by .github/workflows/release-notes.yml on merge to develop. Regenerate with `task release:changelog`."
)


def _bilingual(text: str, german: dict[str, str]) -> dict[str, str]:
    return {"en": text, "de": german.get(text, text)}


def _heading(group: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": group["id"],
        "kind": group["kind"],
        "version": group["version"],
        "date": group["date"],
        "dateEnd": group.get("dateEnd"),
    }


def build_public_changelog(groups: list[dict[str, Any]], german: dict[str, str]) -> dict[str, Any]:
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
