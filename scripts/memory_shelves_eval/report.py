"""The memory-shelves eval's Markdown report, rendered from ``results.json`` alone."""

from __future__ import annotations

from typing import Any

from .scoring import METRICS
from .scoring import SHARED_SHELVES
from .scoring import failures

_TITLES = {
    "leak": "(a) leak: a personal matter on a shared shelf",
    "misfiled_personal": "(b) project fact filed only as personal",
    "over_capture": "(c) over-capture on nothing-to-keep",
    "secret_kept": "(d) secret kept, on any shelf",
}


def _cell(tally: dict[str, Any] | None) -> str:
    if not tally or not tally["of"]:
        return "n/a"
    low, high = tally["spread"]
    cases = tally["cases_failing_in_any_run"]
    return (
        f"{tally['n']}/{tally['of']} ({tally['rate']:.1%}; runs {low:.1%}-{high:.1%}; cases {cases['n']}/{cases['of']})"
    )


def _metric_table(summary: dict[str, Any], prefix: str = "") -> list[str]:
    passes = sorted(summary)
    lines = ["| metric | " + " | ".join(passes) + " |", "|---|" + "---|" * len(passes)]
    for name in METRICS:
        cells = [_cell(summary[pass_name]["overall"].get(prefix + name)) for pass_name in passes]
        lines.append(f"| {_TITLES[name]} | " + " | ".join(cells) + " |")
    return lines


def _group_table(summary: dict[str, Any], key: str) -> list[str]:
    lines = [
        "| pass | group | " + " | ".join(METRICS) + " | missed_project |",
        "|---|---|" + "---|" * (len(METRICS) + 1),
    ]
    for pass_name in sorted(summary):
        for group, tallies in summary[pass_name][key].items():
            cells = [_cell(tallies.get(name)) for name in (*METRICS, "missed_project")]
            lines.append(f"| {pass_name} | {group} | " + " | ".join(cells) + " |")
    return lines


def _notes(notes: list[dict[str, Any]]) -> list[str]:
    lines = []
    for note in notes:
        result = f" -> tool said: {note['result']}" if note.get("result") else ""
        lines.append(f"  - `{note['shelf']}` / `{note.get('kind')}`: {note['content']}{result}")
    return lines or ["  - (none)"]


def _failure_section(cases: list[dict[str, Any]], records: list[dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    for failure in sorted(
        failures(cases, records), key=lambda f: (f["record"]["pass"], f["case"]["id"], f["record"]["run"])
    ):
        case, record = failure["case"], failure["record"]
        lines += [
            f"### {record['pass']} / {case['id']} / run {record['run']}: {', '.join(failure['metrics'])}",
            f"- category `{case['category']}` / `{case['sub']}`",
            f"- user: {case['user']}",
            f"- assistant: {case['assistant']}",
            "- proposed by the model:",
            *_notes(record.get("proposed") or []),
            "- written after the production filters:",
            *_notes(record.get("written") or []),
            "",
        ]
    return lines or ["None.", ""]


def _mixed_section(cases: list[dict[str, Any]], records: list[dict[str, Any]]) -> list[str]:
    """Every shared note on a case that also holds a personal matter: the markers are stems, so read these."""
    mixed = {case["id"] for case in cases if case.get("personal_markers")}
    lines: list[str] = []
    for record in sorted(records, key=lambda r: (r["pass"], r["case_id"], r["run"])):
        shared = [note for note in record.get("written") or [] if note["shelf"] in SHARED_SHELVES]
        if record["case_id"] in mixed and shared:
            lines.append(f"- {record['pass']} / {record['case_id']} / run {record['run']}")
            lines += _notes(shared)
    return lines or ["None."]


def render(results: dict[str, Any]) -> str:
    meta, cases, records, summary = results["meta"], results["cases"], results["records"], results["summary"]
    usage = meta.get("usage") or {}
    errors = [record for record in records if record.get("error")]
    lines = [
        "# Memory shelves eval",
        "",
        f"Model `{meta['model']}` ({meta.get('model_source')}), {len(cases)} cases x {meta['runs']} runs, "
        f"passes: {', '.join(sorted(summary))}. Commit `{meta.get('commit')}`, {meta.get('finished')}.",
        f"Model calls {usage.get('calls', 0)}, input tokens {usage.get('input_tokens', 0)}, "
        f"output tokens {usage.get('output_tokens', 0)}, cost USD {usage.get('cost_usd', 0):.4f}. "
        f"Errored runs: {len(errors)}.",
        "",
        "Each cell: failing runs / scored runs (rate; lowest-highest rate over the run indexes; "
        "cases failing in at least one run / cases).",
        "",
        "## What was written (after the production filters)",
        "",
        *_metric_table(summary),
        "",
        "## What the model proposed (before the filters)",
        "",
        *_metric_table(summary, "proposed_"),
        "",
        "## By category",
        "",
        *_group_table(summary, "by_category"),
        "",
        "## By sub-category",
        "",
        *_group_table(summary, "by_sub"),
        "",
        "## Every failing run, verbatim",
        "",
        *_failure_section(cases, records),
        "## Shared notes on cases that mix a project fact with a personal matter (read by hand)",
        "",
        *_mixed_section(cases, records),
        "",
        "## Errors",
        "",
        *([f"- {r['pass']} / {r['case_id']} / run {r['run']}: {r['error']}" for r in errors] or ["None."]),
        "",
    ]
    return "\n".join(lines)
