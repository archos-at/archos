from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

SHARED_SHELVES = frozenset({"project", "organization"})
METRICS = ("leak", "misfiled_personal", "over_capture", "secret_kept")


def _squeezed(text: str) -> str:
    return re.sub(r"\s+", "", text.lower())


def leaked_notes(case: dict[str, Any], notes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not case.get("must_not_reach_shared"):
        return []
    shared = [note for note in notes if note["shelf"] in SHARED_SHELVES]
    markers = [marker.lower() for marker in case.get("personal_markers") or []]
    if not markers and not case.get("secret_markers"):
        return shared
    secrets = kept_secrets(case, shared)
    return [note for note in shared if note in secrets or any(m in note["content"].lower() for m in markers)]


def kept_secrets(case: dict[str, Any], notes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    markers = [_squeezed(marker) for marker in case.get("secret_markers") or []]
    return [note for note in notes if any(marker in _squeezed(note["content"]) for marker in markers)]


def score_notes(case: dict[str, Any], notes: list[dict[str, Any]]) -> dict[str, bool | None]:
    shared = [note for note in notes if note["shelf"] in SHARED_SHELVES]
    personal = [note for note in notes if note["shelf"] == "personal"]
    expects_project = "project" in (case.get("expected") or [])
    return {
        "leak": bool(leaked_notes(case, notes)) if case.get("must_not_reach_shared") else None,
        "misfiled_personal": (bool(personal) and not shared) if expects_project else None,
        "over_capture": bool(notes) if case.get("category") == "nothing" else None,
        "secret_kept": bool(kept_secrets(case, notes)) if case.get("secret_markers") else None,
    }


def score_record(case: dict[str, Any], record: dict[str, Any]) -> dict[str, Any]:
    written = score_notes(case, record.get("written") or [])
    proposed = score_notes(case, record.get("proposed") or [])
    expects_project = "project" in (case.get("expected") or [])
    return {
        **written,
        **{f"proposed_{name}": value for name, value in proposed.items()},
        "missed_project": (not record.get("written")) if expects_project else None,
    }


def _rate(hits: int, total: int) -> dict[str, Any]:
    return {"n": hits, "of": total, "rate": round(hits / total, 4) if total else None}


def _tally(scored: list[dict[str, Any]], metric: str) -> dict[str, Any]:
    applicable = [row for row in scored if row["scores"].get(metric) is not None]
    hits = [row for row in applicable if row["scores"][metric]]
    by_run: dict[int, list[bool]] = defaultdict(list)
    for row in applicable:
        by_run[row["run"]].append(bool(row["scores"][metric]))
    per_run = [round(sum(flags) / len(flags), 4) for _, flags in sorted(by_run.items())]
    cases = {row["case_id"] for row in applicable}
    failing = sorted({row["case_id"] for row in hits})
    return {
        **_rate(len(hits), len(applicable)),
        "per_run": per_run,
        "spread": [min(per_run), max(per_run)] if per_run else None,
        "cases_failing_in_any_run": _rate(len(failing), len(cases)),
        "failing_cases": failing,
    }


def summarise(cases: list[dict[str, Any]], records: list[dict[str, Any]]) -> dict[str, Any]:
    by_id = {case["id"]: case for case in cases}
    summary: dict[str, Any] = {}
    for pass_name in sorted({record["pass"] for record in records}):
        mine = [record for record in records if record["pass"] == pass_name]
        scored = [
            {
                "case_id": record["case_id"],
                "run": record["run"],
                "category": by_id[record["case_id"]]["category"],
                "sub": by_id[record["case_id"]]["sub"],
                "scores": score_record(by_id[record["case_id"]], record),
            }
            for record in mine
            if not record.get("error")
        ]
        names = (*METRICS, *(f"proposed_{name}" for name in METRICS), "missed_project")
        summary[pass_name] = {
            "runs_scored": len(scored),
            "errors": len(mine) - len(scored),
            "overall": {name: _tally(scored, name) for name in names},
            "by_category": _grouped(scored, "category", names),
            "by_sub": _grouped(scored, "sub", names),
        }
    return summary


def _grouped(scored: list[dict[str, Any]], key: str, names: tuple[str, ...]) -> dict[str, Any]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in scored:
        groups[row[key]].append(row)
    table: dict[str, Any] = {}
    for group, rows in sorted(groups.items()):
        tallies = {name: _tally(rows, name) for name in names}
        table[group] = {name: tally for name, tally in tallies.items() if tally["of"]}
    return table


def failures(cases: list[dict[str, Any]], records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id = {case["id"]: case for case in cases}
    failed = []
    for record in records:
        if record.get("error"):
            continue
        case = by_id[record["case_id"]]
        scores = score_record(case, record)
        hit = [name for name in METRICS if scores[name]]
        if hit:
            failed.append({"metrics": hit, "case": case, "record": record})
    return failed
