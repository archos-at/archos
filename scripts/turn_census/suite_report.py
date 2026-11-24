from __future__ import annotations

import statistics
from collections.abc import Sequence
from typing import Any

from answer_checks import JUDGE_UNAVAILABLE
from answer_checks import MEANING_CHECKS
from eval_sets import set_module
from run_record import Run


def _spread(values: list[float]) -> str:
    if not values:
        return "–"
    median = statistics.median(values)
    if len(values) == 1:
        return f"{median:g}"
    return f"{median:g} ({min(values):g}–{max(values):g})"


def summarize(runs: list[Run]) -> dict[str, dict[str, Any]]:
    by_question: dict[str, list[Run]] = {}
    for run in runs:
        by_question.setdefault(run.question_id, []).append(run)
    summary: dict[str, dict[str, Any]] = {}
    for question_id, group in by_question.items():
        ok = [run for run in group if not run.error]
        keys = sorted({key for run in ok for key in run.checks})
        summary[question_id] = {
            "runs": len(group),
            "errors": [run.error for run in group if run.error],
            "wall_s": [run.wall_s for run in ok],
            "final_call_s": [run.final_call_s for run in ok],
            "first_text_s": [run.first_text_s for run in ok if run.first_text_s],
            "research_calls": [run.research_calls for run in ok],
            "reasoning_tokens": [run.reasoning_tokens for run in ok],
            "max_reasoning_tokens": [run.max_reasoning_tokens for run in ok],
            "signals": sorted({signal for run in ok for signal in run.signals}),
            "checks": {key: sum(run.checks.get(key, False) for run in ok) / max(1, len(ok)) for key in keys},
        }
    return summary


def _delta(now: list[float], then: list[float] | None) -> str:
    if not now or not then:
        return ""
    change = statistics.median(now) - statistics.median(then)
    return f" ({change:+.0f})" if abs(change) >= 1 else ""


def render(
    runs: list[Run], skipped: list[str], meta: dict, baseline: dict | None = None, not_in_corpus: Sequence[str] = ()
) -> str:
    summary = summarize(runs)
    before = summarize([Run(**row) for row in baseline["runs"]]) if baseline else {}
    lines = [
        "# Answer suite",
        "",
        f"{meta.get('started', '')} · commit `{meta.get('commit', '?')}` · model config `{meta.get('config', '')}` · "
        f"{meta.get('runs_per_question', '')} run(s) per question"
        + (f" · overrides {meta['overrides']}" if meta.get("overrides") else "")
        + (f" · fixture search: {meta['fixture_search']}" if meta.get("fixture_search") else ""),
        "",
        "Median (min–max). Seconds follow reasoning tokens at ~85 tok/s; the spike column is the "
        "largest single call, which is where run-to-run variance comes from."
        + (" Deltas in brackets are against the baseline's medians." if baseline else ""),
        "",
        "| Question | Wall s | First text s | Research calls | Reasoning tokens | Spike | Final call s "
        "| Checks | Signals |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    failing: list[str] = []
    for question_id, row in summary.items():
        prior = before.get(question_id, {})
        held = list(row["checks"].values())
        score = f"{sum(v == 1 for v in held)}/{len(held)}" if held else "–"
        lines.append(
            f"| {question_id} | {_spread(row['wall_s'])}{_delta(row['wall_s'], prior.get('wall_s'))} "
            f"| {_spread(row['first_text_s']) if row['first_text_s'] else '–'} "
            f"| {_spread(row['research_calls'])} "
            f"| {_spread(row['reasoning_tokens'])}{_delta(row['reasoning_tokens'], prior.get('reasoning_tokens'))} "
            f"| {_spread(row['max_reasoning_tokens'])} | {_spread(row['final_call_s'])} | {score} "
            f"| {', '.join(row['signals']) or '–'} |"
        )
        failing += _failing_lines(question_id, row)
    ok = [run for run in runs if not run.error]
    lines += [
        "",
        f"**All runs:** wall {_spread([r.wall_s for r in ok])} s · research calls "
        f"{_spread([r.research_calls for r in ok])} · reasoning tokens {_spread([r.reasoning_tokens for r in ok])}",
        "",
        "## Each kind of check, over every run",
        "",
        *aggregate_lines(ok),
        "",
        *split_lines(ok),
        "## Checks that did not always hold",
        "",
        *(failing or ["None."]),
    ]
    if module := set_module(meta.get("set")):
        lines += ["", *module.report_lines(runs, meta)]
    if skipped:
        lines += ["", f"Skipped, need a project: {', '.join(skipped)}."]
    if not_in_corpus:
        lines += ["", f"Skipped, the ingested corpus lacks the Richtlinie: {', '.join(not_in_corpus)}."]
    return "\n".join(lines) + "\n"


def _failing_lines(question_id: str, row: dict[str, Any]) -> list[str]:
    lines = [
        f"- **{question_id}** `{key}` held in {share:.0%} of runs" for key, share in row["checks"].items() if share < 1
    ]
    lines += [f"- **{question_id}** run error: {error}" for error in row["errors"]]
    return lines


def split_lines(runs: list[Run]) -> list[str]:
    if not any(run.holdout or run.scenario for run in runs):
        return []
    lines = ["## Tuned, held out, and per scenario", ""]
    for label, part in (
        ("Tuned questions", [run for run in runs if not run.holdout]),
        ("Held-out questions", [run for run in runs if run.holdout]),
    ):
        lines += [f"**{label}** ({len(part)} runs):", "", *aggregate_lines(part), ""]
    for scenario in sorted({run.scenario or "default" for run in runs}):
        part = [run for run in runs if (run.scenario or "default") == scenario]
        lines += [f"**Scenario `{scenario}`** ({len(part)} runs):", "", *aggregate_lines(part), ""]
    return lines


def aggregate_lines(runs: list[Run]) -> list[str]:
    held: dict[str, list[bool]] = {}
    for run in runs:
        for key, value in run.checks.items():
            held.setdefault(key.split(":", 1)[0], []).append(value)
    lines = [f"- `{kind}`: {sum(values)}/{len(values)}" for kind, values in sorted(held.items())]
    asked = sum(len(held.get(kind, [])) for kind in MEANING_CHECKS)
    unavailable = [signal for run in runs for signal in run.signals if signal.startswith(JUDGE_UNAVAILABLE)]
    if asked:
        by_kind = ", ".join(
            f"{kind} {unavailable.count(JUDGE_UNAVAILABLE + kind)}"
            for kind in MEANING_CHECKS
            if JUDGE_UNAVAILABLE + kind in unavailable
        )
        lines.append(
            f"- judge could not answer: {len(unavailable)} of {asked} meaning checks"
            + (f" ({by_kind})" if by_kind else "")
        )
    return lines or ["None."]
