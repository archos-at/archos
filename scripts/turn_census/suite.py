from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import sys
import time
from collections.abc import Callable
from collections.abc import Collection
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
QUESTIONS = ROOT / "tests" / "fixtures" / "derivation" / "loop_eval_questions.yaml"
PRECEDENT_QUESTIONS = ROOT / "tests" / "fixtures" / "precedent" / "precedent_questions.yaml"
NORM_QUESTIONS = {"loop": QUESTIONS, "editions": ROOT / "tests" / "fixtures" / "editions" / "at_edition_questions.yaml"}
sys.path.insert(0, str(HERE))

import fixture_law  # noqa: E402
import turn_input  # noqa: E402
from census import ensure_key  # noqa: E402  (a sibling script, not a package)
from census import kind as call_kind  # noqa: E402
from census import records  # noqa: E402
from census import run_once  # noqa: E402
from census import run_python  # noqa: E402
from census import run_stamp  # noqa: E402
from census import source_packages  # noqa: E402
from census import timed_out  # noqa: E402
from census import tree_pythonpath  # noqa: E402
from cited_files import cited_families  # noqa: E402
from eval_sets import set_module  # noqa: E402
from files_eval import recorded_calls  # noqa: E402
from fixture_bff import lookups_served  # noqa: E402
from fixture_bff import marks_proposed  # noqa: E402
from fixture_bff import proposals_filed  # noqa: E402
from fixture_bff import writes_attempted  # noqa: E402
from suite_cli import parse_args  # noqa: E402
from workspace_eval import run_conversation  # noqa: E402

_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_LOG_SIGNALS = {
    "unverified_quote": "unverified quote (",
    "quote_patch": "quote patch corrected",
    "settled_replaced": "terminal frame replaced the settled answer",
    "summary_gated": "summary gated out",
    "mindmap_dropped": "that only redraw a table",
    "prose_outside": "answer_prose_outside_envelope",
    "envelope_salvaged": "answer_envelope_headless",
    "escalated": "Clarifier: Starting",
    "budget": "status:budget",
    "repeat": "status:repeat",
    "width": "status:width",
}


@dataclass
class Run:
    question_id: str
    run: int
    wall_s: float = 0.0
    final_call_s: float = 0.0
    first_text_s: float = 0.0
    research_calls: int = 0
    post_answer_calls: int = 0
    tool_calls: list[str] = field(default_factory=list)
    tool_args: list[dict] = field(default_factory=list)
    reasoning_tokens: int = 0
    max_reasoning_tokens: int = 0
    output_tokens: int = 0
    input_tokens: int = 0
    cost_usd: float | None = None
    cost_missing: int = 0
    signals: list[str] = field(default_factory=list)
    kind: str = ""
    cited_families: list[str] = field(default_factory=list)
    envelope: dict | None = None
    checks: dict[str, bool] = field(default_factory=dict)
    lookups: list[str] = field(default_factory=list)
    precedent_p: float | None = None
    scenario: str = ""
    holdout: bool = False
    answer: str = ""
    error: str = ""
    door: list[dict] = field(default_factory=list)
    door_offset: int | None = None
    turns: int = 1


_PATCHED_RE = re.compile(r"quote patch corrected (\d+) of \d+")
_PRECEDENT_RE = re.compile(r"Turn decision in \d+ ms: .*precedent=([0-9.]+)")


def precedent_of(log_text: str) -> float | None:
    found = _PRECEDENT_RE.search(log_text)
    return float(found.group(1)) if found else None


def log_signals(log_text: str) -> list[str]:
    found = [name for name, needle in _LOG_SIGNALS.items() if needle in log_text]
    landed = any(int(n) > 0 for n in _PATCHED_RE.findall(log_text))
    if not landed:
        found = [name for name in found if name != "quote_patch"]
    elif "settled_replaced" in found:
        found[found.index("settled_replaced")] = "settled_patched"
    return found


def load_precedent_questions(path: Path = PRECEDENT_QUESTIONS) -> list[dict]:
    import yaml

    return list((yaml.safe_load(path.read_text(encoding="utf-8")) or {}).get("questions") or [])


def set_questions(name: str | None) -> list[dict]:
    if name == "precedent":
        return load_precedent_questions()
    if module := set_module(name):
        return module.load_questions()
    return load_questions(path=NORM_QUESTIONS.get(str(name), QUESTIONS), core_only=False)[0]


def load_questions(path: Path = QUESTIONS, *, core_only: bool = True) -> tuple[list[dict], list[str]]:
    import yaml

    named = next((name for name, file in NORM_QUESTIONS.items() if file == path and name != "loop"), None)
    rows = [{**r, "set": named} if named else r for r in yaml.safe_load(path.read_text("utf-8"))["questions"]]
    runnable, skipped = [], []
    for row in rows:
        if row.get("family") is None:
            skipped.append(str(row["id"]))
        elif not core_only or row.get("suite") == "core":
            runnable.append(row)
    return runnable, skipped


def _usage(entry: dict) -> tuple[int, int, int]:
    usage = entry.get("usage") or {}
    details = usage.get("output_tokens_details") or usage.get("completion_tokens_details") or {}
    return (
        usage.get("input_tokens") or usage.get("prompt_tokens") or 0,
        usage.get("output_tokens") or usage.get("completion_tokens") or 0,
        details.get("reasoning_tokens") or 0,
    )


def turn_cost(rows: list[dict]) -> tuple[float, int]:
    billed = [row["usage"] for row in rows if row.get("usage")]
    costs = [float(usage["cost"]) for usage in billed if isinstance(usage.get("cost"), int | float)]
    return round(sum(costs), 6), len(billed) - len(costs)


def final_answer(log_text: str) -> str:
    plain = _ANSI.sub("", log_text)
    marker = plain.rfind("Workflow Result:")
    if marker < 0:
        return ""
    body = plain[marker + len("Workflow Result:") :]
    return body.split("\n------", 1)[0].strip()


def last_envelope(research: list[dict]) -> tuple[dict | None, int | None]:
    from agent.common.envelope_parsing import extract_answer_envelope

    found, at = None, None
    for position, entry in enumerate(research):
        for item in (entry.get("resp") or {}).get("output", []):
            if item.get("type") != "message":
                continue
            _, meta = extract_answer_envelope("".join(part.get("text", "") for part in item.get("content", [])))
            if meta is not None:
                found, at = meta.model_dump(mode="json"), position
    return found, at


def _no_answer(log_text: str) -> str:
    return "timed out" if timed_out(log_text) else "no Workflow Result in the log"


def _read_calls(run: Run, research: list[dict], answered_at: int | None, t0: float) -> None:
    answering = len(research) - 1 if answered_at is None else answered_at
    run.research_calls = answering + 1
    run.post_answer_calls = len(research) - run.research_calls
    for entry in research:
        tokens_in, tokens_out, reasoning = _usage(entry)
        run.input_tokens += tokens_in
        run.output_tokens += tokens_out
        run.reasoning_tokens += reasoning
        run.max_reasoning_tokens = max(run.max_reasoning_tokens, reasoning)
        for item in (entry.get("resp") or {}).get("output", []):
            if item.get("type") == "function_call":
                run.tool_calls.append(str(item.get("name")))
        run.tool_args.extend(recorded_calls((entry.get("resp") or {}).get("output", [])))
    if not research:
        return
    call = research[answering]
    run.final_call_s = round(call["t_end"] - call["t_start"], 1)
    if first_text := call.get("t_first_text"):
        run.first_text_s = round(first_text - t0, 1)


def observe(
    question: dict, index: int, record: Path, log: Path, door_offset: int | None = None, look_on: bool = True
) -> Run:
    run = Run(
        question_id=str(question["id"]),
        run=index,
        scenario=str(question.get("scenario") or ""),
        holdout=bool(question.get("holdout")),
        door_offset=door_offset,
        turns=len(question.get("turns") or []) or 1,
    )
    rows = sorted(records(record), key=lambda r: r["t_start"])
    log_text = log.read_text(errors="replace") if log.exists() else ""
    if not rows:
        run.error = "timed out" if timed_out(log_text) else "no model calls recorded"
        return run
    research = [entry for entry in rows if call_kind(entry) == "research"]
    envelope, answered_at = last_envelope(research)
    run.wall_s = round(max(row["t_end"] for row in rows) - rows[0]["t_start"], 1)
    _read_calls(run, research, answered_at, rows[0]["t_start"])
    run.cost_usd, run.cost_missing = turn_cost(rows)
    run.signals = log_signals(log_text)
    run.precedent_p = precedent_of(log_text)
    run.answer = final_answer(log_text)
    run.envelope = {"kind": envelope.get("kind"), "cards": envelope.get("cards") or []} if envelope else None
    run.kind = str((envelope or {}).get("kind") or "")
    run.cited_families = cited_families(run.answer)
    requests = record.parent / "requests.jsonl"
    run.lookups = lookups_served(requests, record.stem)
    if "escalated" in run.signals:
        run.kind = run.kind or "handoff"
    run.checks = check(question, run, envelope)
    if question.get("set") == "files":
        from files_eval import files_checks

        run.checks.update(
            files_checks(
                question.get("expect") or {},
                run.tool_args,
                run.answer,
                str(question.get("question") or ""),
                _judge(),
                run.signals,
                run.research_calls,
                proposals_filed(requests, record.stem),
                writes_attempted(requests, record.stem),
                marks_proposed(requests, record.stem),
            )
        )
    if question.get("set") == "visual":
        from visual_eval import visual_checks

        run.checks.update(
            visual_checks(
                question.get("expect") or {},
                run.tool_args,
                question.get("gold") or [],
                run.answer,
                str(question.get("question") or ""),
                _judge(),
                run.signals,
                run.research_calls,
                look_on=look_on,
            )
        )
    if door_offset is not None:
        from fixture_workspace import workspace_calls
        from workspace_eval import workspace_checks

        run.door = workspace_calls(record.parent / "requests.jsonl", record.stem)[door_offset:]
        run.checks.update(
            workspace_checks(
                question.get("expect") or {},
                run.door,
                run.tool_calls,
                run.answer,
                str(question.get("question") or ""),
                _judge(),
                run.signals,
            )
        )
    if "escalated" not in run.signals and not run.answer:
        run.error = _no_answer(log_text)
    return run


def _normal(text: str) -> str:
    return text.translate(str.maketrans("₀₁₂₃₄₅₆₇₈₉  ", "0123456789  ")).casefold()


def _family_number(family: str | None) -> str | None:
    match = re.search(r"OIB-RL\s*(\d+(?:\.\d+)?)", str(family or ""), re.IGNORECASE)
    return match.group(1) if match else None


def _card_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [text for item in value.values() for text in _card_strings(item)]
    if isinstance(value, list):
        return [text for item in value for text in _card_strings(item)]
    return []


def _has_shape(shape: str, prose: str, cards: list[Any]) -> bool:
    cards = [card for card in cards if isinstance(card, dict)]
    text = "\n".join([prose, *_card_strings(cards)])
    if shape == "tabs":
        return any(
            card.get("type") == "surface" and any(c.get("component") == "Tabs" for c in card.get("components", []))
            for card in cards
        )
    if shape == "table":
        return bool(re.search(r"^\s*\|.*\|\s*$", text, re.MULTILINE))
    if shape == "diagram":
        return "```mermaid" in text
    blocks = _directive_blocks(text)
    if shape == "plain":
        return not blocks
    if shape in _DIALECT_BLOCKS:
        return shape in blocks
    return False


_DIALECT_BLOCKS = frozenset(
    {"check", "procedure", "cases", "metrics", "compare", "details", "actions", "not-found", "subsumption"}
)
_DIRECTIVE_OPENER = re.compile(r"^[ \t]*:{3,}[ \t]*([A-Za-z][\w-]*)", re.MULTILINE)


def _directive_blocks(text: str) -> set[str]:
    outside = re.sub(r"^[ \t]*(`{3,}|~{3,}).*?^[ \t]*\1[ \t]*$", "", text, flags=re.MULTILINE | re.DOTALL)
    return {name for name in _DIRECTIVE_OPENER.findall(outside) if name in _DIALECT_BLOCKS}


def check(question: dict, run: Run, envelope: dict | None) -> dict[str, bool]:
    checks: dict[str, bool] = {"envelope": envelope is not None}
    if question.get("kind"):
        accepted = [question["kind"], *((question.get("expect") or {}).get("kind_also") or [])]
        checks["kind"] = run.kind in accepted
    module = set_module(question.get("set"))
    if (family := _family_number(question.get("family"))) and getattr(module, "CHECKS_FAMILY", True):
        checks["family_cited"] = family in run.cited_families
    expect = question.get("expect") or {}
    answer = _normal("\n".join([run.answer, *_card_strings((envelope or {}).get("cards") or [])]))
    for item in expect.get("mentions") or []:
        options = item if isinstance(item, list) else [item]
        checks[f"mentions:{options[0]}"] = any(_normal(str(option)) in answer for option in options)
    for item in expect.get("not_mentions") or []:
        checks[f"not:{item}"] = _normal(str(item)) not in answer
    shapes = expect.get("shape")
    if shapes:
        options = shapes if isinstance(shapes, list) else [shapes]
        cards = (envelope or {}).get("cards") or []
        checks[f"shape:{'|'.join(options)}"] = any(_has_shape(option, run.answer, cards) for option in options)
    projects = _office_projects(str(question.get("scenario") or "")) if expect.get("lookup") else None
    checks.update(
        precedent_checks(
            expect, run, answer, question=str(question.get("question") or ""), judge=_judge(), projects=projects
        )
    )
    if callable(
        set_checks := getattr(module, "set_checks", None)
    ):  # after precedent_checks, which clears judge signals
        checks.update(set_checks(question, run, answer, _judge()))
    return checks


def _office_projects(scenario: str) -> list[str]:
    from fixture_bff import DEFAULT_SCENARIO
    from fixture_bff import FixtureOffice

    return FixtureOffice(scenario=scenario or DEFAULT_SCENARIO).project_names()


def _judge() -> Judge | None:
    import judge

    return judge.ask if judge.available() else None


def looked_up(run: Run) -> bool:
    return bool(run.lookups) or any(str(name).endswith("project_lookup") for name in run.tool_calls)


Judge = Callable[[str, str, str], bool | None]

JUDGE_UNAVAILABLE = "judge_unavailable:"
MEANING_CHECKS = ("says_none", "caveat")

_SOURCE_PROJECT = re.compile(
    r"^\s*(?:[-*]\s*)?\[\d+\]\s*\[KB\]\s+[^\n]*?\(([^()\n]+)\)(?:,\s*p\.\s*\d+)?\s*$", re.MULTILINE
)


def sourced_projects(answer: str) -> list[str]:
    return [" ".join(name.split()) for name in _SOURCE_PROJECT.findall(answer)]


def _cited(options: list[Any], question: str, answer: str) -> bool:
    asked = _normal(question)
    return any(_normal(str(option)) in answer for option in options if _normal(str(option)) not in asked)


def precedent_checks(
    expect: dict,
    run: Run,
    answer: str,
    *,
    question: str = "",
    judge: Judge | None = None,
    projects: Collection[str] | None = None,
) -> dict[str, bool]:
    checks: dict[str, bool] = {}
    run.signals[:] = [signal for signal in run.signals if not signal.startswith(JUDGE_UNAVAILABLE)]
    lookup = expect.get("lookup")
    if lookup == "required":
        checks["looked_up"] = looked_up(run)
    elif lookup == "forbidden":
        checks["no_lookup"] = not looked_up(run)
    for group in expect.get("cites") or []:
        options = group if isinstance(group, list) else [group]
        checks[f"cites:{options[0]}"] = _cited(options, question, answer)
    for name in expect.get("not_cites") or []:
        checks[f"not_cites:{name}"] = _normal(str(name)) not in answer
    if projects is not None:
        known = {_normal(" ".join(name.split())) for name in projects}
        checks["real_projects"] = all(_normal(name) in known for name in sourced_projects(run.answer))
    for kind in MEANING_CHECKS:
        if not expect.get(kind):
            continue
        verdict = judge(kind, question, run.answer) if judge is not None and run.answer.strip() else None
        checks[kind] = bool(verdict)
        if verdict is None and run.answer.strip():
            run.signals.append(f"{JUDGE_UNAVAILABLE}{kind}")
    return checks


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
        for key, share in row["checks"].items():
            if share < 1:
                failing.append(f"- **{question_id}** `{key}` held in {share:.0%} of runs")
        for error in row["errors"]:
            failing.append(f"- **{question_id}** run error: {error}")
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


def corpus_families() -> set[str] | None:
    from agent import corpus_store
    from agent.common.norm_registry import oib_family_member

    try:
        names = corpus_store.list_files()
    except Exception:  # noqa: BLE001 - no database configured is "unknown", not a failure
        return None
    return {member for name in names if (member := oib_family_member(name))}


def lacking_family(question: dict, families: set[str] | None) -> str | None:
    family = _family_number(question.get("family"))
    if family is None or families is None or family in families:
        return None
    return f"OIB-RL {family}"


def source_commit() -> str:
    import subprocess

    def git(*args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=False)

    sha = git("rev-parse", "--short", "HEAD").stdout.strip() or "unknown"
    return f"{sha}-dirty" if git("status", "--porcelain", "--untracked-files=no").stdout.strip() else sha


def _ingest_corpus(poll_seconds: float = 5.0, timeout_seconds: float = 3600.0) -> str | None:
    from agent import corpus_store
    from agent import oib_sync

    def run_corpus_job_here(prepared) -> bool:
        oib_sync._get_oib_ingestor().run_prepared(prepared)
        return True

    print("ingesting the corpus:", oib_sync.sync(enqueue=run_corpus_job_here))
    unfinished = (oib_sync.JobProgress.WAITING, oib_sync.JobProgress.RUNNING)
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        result = oib_sync.sync(enqueue=run_corpus_job_here)
        rows = corpus_store.list_files()
        waiting = [
            name
            for name, row in rows.items()
            if row.needs_ingestion(oib_sync.CHUNK_FORMAT_VERSION) and oib_sync.progress_of(row) in unfinished
        ]
        if not waiting:
            print("ingested the corpus:", result)
            return f"{result.failed} file(s) could not be ingested" if result.failed else None
        print(f"ingesting: {len(waiting)} file(s) left")
        time.sleep(poll_seconds)
    return f"the corpus was not ingested within {timeout_seconds:.0f} s"


def use_local_corpus(directory: Path) -> int:
    import hashlib
    import shutil

    from agent import corpus_store

    prefix = "base-corpus/"

    def request_upload_url(name: str) -> tuple[str, str]:
        return name, prefix + name

    def put_object(name: str, data: bytes) -> None:
        stored = directory / name
        if hashlib.sha256(stored.read_bytes()).hexdigest() != hashlib.sha256(data).hexdigest():
            raise corpus_store.CorpusStoreError(f"{name} in {directory} is not the file being stored")

    def delete_object(name: str) -> None:
        raise corpus_store.CorpusStoreError(f"--corpus never deletes from {directory}")

    def download_object(storage_key: str, out) -> None:
        with (directory / storage_key.removeprefix(prefix)).open("rb") as source:
            shutil.copyfileobj(source, out)

    corpus_store._request_upload_url = request_upload_url
    corpus_store._put_object = put_object
    corpus_store._delete_object = delete_object
    corpus_store._download_object = download_object
    pdfs = sorted(path for path in directory.glob("*.pdf") if corpus_store.is_valid_name(path.name))
    for pdf in pdfs:
        corpus_store.put(pdf.name, pdf.read_bytes())
    return len(pdfs)


def _corpus_ready() -> bool:
    try:
        from knowledge_layer.vector_store import get_store

        from agent.oib_sync import COLLECTION_NAME

        return get_store().count(COLLECTION_NAME) > 0
    except Exception as exc:  # noqa: BLE001 - any failure is "not ready", said out loud
        print(f"corpus check failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False


def inventory_database() -> Path | None:
    url = os.environ.get("SUMMARY_DB") or "sqlite+aiosqlite:///./summaries.db"
    prefix = "sqlite+aiosqlite:///"
    if not url.startswith(prefix):
        return None
    path = Path(url[len(prefix) :])
    return (path if path.is_absolute() else ROOT / path).resolve()


def foreign_imports(out: Path) -> list[str]:
    import subprocess

    names = ("agent", *source_packages())
    probe = f"import {', '.join(names)}; print({', '.join(f'{name}.__file__' for name in names)}, sep=chr(10))"
    env = {**os.environ, "PYTHONPATH": tree_pythonpath(out)}
    shown = subprocess.run(
        [run_python(), "-P", "-c", probe], cwd=ROOT, env=env, capture_output=True, text=True, check=False
    )
    if shown.returncode != 0:
        return [f"import failed: {shown.stderr.strip().splitlines()[-1] if shown.stderr.strip() else shown.returncode}"]
    root = ROOT.resolve()
    return [
        f"{name}: {path}"
        for name, path in zip(names, shown.stdout.splitlines(), strict=False)
        if not Path(path).resolve().is_relative_to(root)
    ]


def inventory_ready(path: Path | None) -> bool:
    if path is None:
        return True  # not SQLite: the deployment's own store, not ours to check
    import sqlite3
    from contextlib import closing

    try:
        with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as db:
            (count,) = db.execute(
                "SELECT count(*) FROM document_metadata WHERE collection = 'oib_knowledge'"
            ).fetchone()
    except sqlite3.Error:
        return False
    return count > 0


def run_suite(
    questions: list[dict],
    runs: int,
    out: Path,
    workers: int,
    overrides: list[list[str]] | None,
    stamp: str | None = None,
    env_for: Any = None,
    conversations: bool = False,
    look_on: bool = True,
) -> list[Run]:
    out.mkdir(parents=True, exist_ok=True)
    stamp = stamp or run_stamp()
    jobs = [(question, index) for question in questions for index in range(1, runs + 1)]

    def one(job: tuple[dict, int]) -> Run:
        question, index = job
        conversation = f"suite-{stamp}-{question['id']}-{index}"
        try:
            extra = env_for(conversation, question) if env_for else None
            if conversations:
                record, before = run_conversation(question, index, out, conversation, overrides, extra)
                offset = None if question.get("set") in ("files", "visual") else before
                result = observe(
                    question, index, record, record.with_suffix(".log"), door_offset=offset, look_on=look_on
                )
            else:
                record = run_once(str(question["question"]).strip(), out, conversation, overrides, extra)
                result = observe(question, index, record, record.with_suffix(".log"))
        except Exception as exc:  # noqa: BLE001 - one run's failure is that run's, not the suite's
            result = Run(question_id=str(question["id"]), run=index, error=f"{type(exc).__name__}: {exc}")
        print(f"  {question['id']} #{index}: {result.wall_s}s, {result.research_calls} call(s)", flush=True)
        return result

    pool = ThreadPoolExecutor(max_workers=workers)
    try:
        return list(pool.map(one, jobs))
    finally:
        pool.shutdown(wait=True, cancel_futures=True)


def precedent_envelope(
    office: dict, conversation_id: str, secret: str, current: dict | None = None, extra: dict | None = None
) -> tuple[str, str]:
    import base64
    import hashlib
    import hmac

    current = current or office["current"]
    raw = json.dumps(
        {
            "organizationId": office["organizationId"],
            "userId": office["userId"],
            "projectId": current["id"],
            "conversationId": conversation_id,
            "issuedAt": int(time.time() * 1000),
            "contextTransport": "bff",
            "federalState": current.get("facts", {}).get("federal_state"),
            **(extra or {}),
        },
        ensure_ascii=False,
    )
    header = base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")
    signature = hmac.new(secret.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()
    return header, signature


def start_workspace_bff(out: Path) -> tuple[Any, Any]:
    import secrets

    from fixture_bff import FixtureBFF
    from fixture_workspace import FixtureWorkspace

    token = secrets.token_hex(16)
    workspace = FixtureWorkspace()
    bff = FixtureBFF(token, out / "requests.jsonl", workspace=workspace).start()
    office = workspace.office
    project = next(p for p in office["projects"] if p["id"] == office["current"])

    def env_for(conversation_id: str, question: dict) -> dict[str, str]:
        header, signature = precedent_envelope(
            {"organizationId": office["organizationId"], "userId": office["userId"]},
            conversation_id,
            token,
            {"id": project["id"]},
        )
        return {
            "FRONTEND_INTERNAL_URL": bff.url,
            "INTERNAL_API_TOKEN": token,
            "EVAL_ENVELOPE": header,
            "EVAL_ENVELOPE_SIG": signature,
        }

    return bff, env_for


def start_files_bff(out: Path) -> tuple[Any, Any]:
    import secrets

    from fixture_bff import FixtureBFF
    from fixture_files import FilesWorkspace

    token = secrets.token_hex(16)
    workspace = FilesWorkspace()
    bff = FixtureBFF(token, out / "requests.jsonl", workspace=workspace).start()

    def env_for(conversation_id: str, question: dict) -> dict[str, str]:
        header, signature = precedent_envelope(
            workspace.office, conversation_id, token, {"id": workspace.project_id}, extra=workspace.envelope_fields
        )
        return {
            "FRONTEND_INTERNAL_URL": bff.url,
            "INTERNAL_API_TOKEN": token,
            "EVAL_ENVELOPE": header,
            "EVAL_ENVELOPE_SIG": signature,
            **turn_input.env_for(question),
        }

    return bff, env_for


def start_visual_bff(out: Path, look: bool = True) -> tuple[Any, Any]:
    import secrets

    from fixture_bff import FixtureBFF
    from fixture_visual import VisualWorkspace

    token = secrets.token_hex(16)
    workspace = VisualWorkspace.rendered(out / "drawings")
    bff = FixtureBFF(token, out / "requests.jsonl", workspace=workspace).start()

    def env_for(conversation_id: str, question: dict) -> dict[str, str]:
        header, signature = precedent_envelope(
            workspace.office, conversation_id, token, {"id": workspace.project_id}, extra=workspace.envelope_fields
        )
        return {
            "FRONTEND_INTERNAL_URL": bff.url,
            "INTERNAL_API_TOKEN": token,
            "EVAL_ENVELOPE": header,
            "EVAL_ENVELOPE_SIG": signature,
            **workspace.env(bff.url, look),
            **turn_input.env_for(question),
        }

    return bff, env_for


def start_fixture_bff(out: Path) -> tuple[Any, Any]:
    import secrets

    from fixture_bff import FixtureBFF
    from fixture_bff import production_embedder

    token = secrets.token_hex(16)
    bff = FixtureBFF(token, out / "requests.jsonl", embed=production_embedder()).start()

    def env_for(conversation_id: str, question: dict) -> dict[str, str]:
        from fixture_bff import DEFAULT_SCENARIO

        office = bff.assign(conversation_id, str(question.get("scenario") or DEFAULT_SCENARIO))
        header, signature = precedent_envelope(office.office, conversation_id, token, office.current)
        return {
            "FRONTEND_INTERNAL_URL": bff.url,
            "INTERNAL_API_TOKEN": token,
            "EVAL_ENVELOPE": header,
            "EVAL_ENVELOPE_SIG": signature,
        }

    return bff, env_for


def recording(folder: Path, stamp: str | None, run: Run) -> Path | None:
    if stamp:
        found = folder / f"suite-{stamp}-{run.question_id}-{run.run}.jsonl"
        return found if found.exists() else None
    exact = re.compile(rf"suite-\d{{6}}-\d+-{re.escape(run.question_id)}-{run.run}\.jsonl")
    candidates = [path for path in folder.glob("suite-*.jsonl") if exact.fullmatch(path.name)]
    return max(candidates, key=lambda path: path.stat().st_mtime, default=None)


def _rerender(report: Path, baseline: dict | None) -> int:
    data = json.loads(report.read_text())
    runs = [Run(**row) for row in data["runs"]]
    chosen = data["meta"].get("set")
    by_id = {str(q["id"]): q for q in set_questions(chosen)}
    for index, run in enumerate(runs):
        question = by_id.get(run.question_id)
        if question is None:
            continue
        found = recording(report.parent, data["meta"].get("stamp"), run)
        if found is not None:
            runs[index] = observe(
                question,
                run.run,
                found,
                found.with_suffix(".log"),
                door_offset=run.door_offset,
                look_on=data["meta"].get("look") != "off",
            )
        elif not run.error:
            run.checks = check(question, run, run.envelope)
    print(render(runs, data.get("skipped", []), data["meta"], baseline, data.get("not_in_corpus", [])))
    return 0


def _preflight(out: Path, ingest: bool, corpus: Path | None = None, needs_corpus: bool = True) -> int:
    if not ensure_key():
        print("OPENROUTER_API_KEY is not set; the suite needs the real models.", file=sys.stderr)
        return 2
    foreign = foreign_imports(out)
    if foreign:
        print(
            "The runs would not measure this checkout: " + "; ".join(foreign) + ". Run the suite with this "
            "checkout's interpreter (task setup inside it), or measure from the checkout that holds the code.",
            file=sys.stderr,
        )
        return 2
    if not needs_corpus:
        return 0
    if ingest:
        if corpus is not None:
            print(f"the corpus is {use_local_corpus(corpus)} PDF(s) from {corpus}")
        problem = _ingest_corpus()
        if problem:
            print(problem, file=sys.stderr)
    if not _corpus_ready():
        print(
            "The OIB corpus is not ingested into the Qdrant at QDRANT_URL. Upload the PDFs "
            "(scripts/upload_oib_corpus.py) and run with --ingest.",
            file=sys.stderr,
        )
        return 2
    summary_db = os.environ.get("SUMMARY_DB", "")
    if summary_db and "://" not in summary_db:
        print(
            f"SUMMARY_DB is a path, not a database URL: {summary_db}. "
            "Use sqlite+aiosqlite:////absolute/path/summaries.db.",
            file=sys.stderr,
        )
        return 2
    database = inventory_database()
    if not inventory_ready(database):
        print(
            f"The document inventory at {database} lists no corpus documents: runs would have no inventory, "
            "no family overviews and no quote checks. Point SUMMARY_DB at the database the ingest wrote "
            "(sqlite+aiosqlite:////absolute/path/summaries.db).",
            file=sys.stderr,
        )
        return 2
    return 0


def select_questions(
    only: list[str] | None, every: bool, path: Path = QUESTIONS
) -> tuple[list[dict], list[str]] | None:
    if not only:
        return load_questions(path=path, core_only=not every)
    runnable, needs_project = load_questions(path=path, core_only=False)
    wanted = set(only)
    questions = [q for q in runnable if wanted & {str(q["id"]), str(q.get("group"))}]
    missing = wanted - {str(q["id"]) for q in questions} - {str(q.get("group")) for q in questions}
    if skipped := sorted(missing & set(needs_project)):
        print(
            f"Needs a project, which the suite has no backend for; nothing was run: {', '.join(skipped)}",
            file=sys.stderr,
        )
    if unknown := sorted(missing - set(needs_project)):
        print(f"No such question: {', '.join(unknown)}", file=sys.stderr)
    return None if missing else (questions, [])


def _warn_if_dirty(commit: str) -> None:
    if commit.endswith("-dirty"):
        print(
            "suite: the working tree has uncommitted changes; runs measure whatever it holds when they start.",
            file=sys.stderr,
        )


def run_set(questions: list[dict], args: argparse.Namespace, stamp: str, meta: dict) -> list[Run]:
    bff, env_for = (
        start_fixture_bff(args.out)
        if args.set == "precedent"
        else start_workspace_bff(args.out)
        if args.set == "workspace"
        else start_files_bff(args.out)
        if args.set == "files"
        else start_visual_bff(args.out, args.look == "on")
        if args.set == "visual"
        else fixture_law.start_law_bff(args.out, precedent_envelope)
    )
    if bff is not None and args.set not in ("files", "visual", "loop"):
        meta["fixture_search"] = "embeddings" if bff.embed is not None else "tokens only (no embedding key)"
    try:
        runs = run_suite(
            questions,
            args.runs,
            args.out,
            args.workers,
            args.override,
            stamp,
            env_for,
            args.set in ("workspace", "files", "visual"),
            args.look == "on",
        )
    finally:
        if bff is not None:
            bff.stop()
    return runs


def run_north_star(questions: list[dict], args: argparse.Namespace, stamp: str) -> list[Run]:
    from north_star_eval import by_fixture

    runs: list[Run] = []
    for fixture, group in by_fixture(questions).items():
        bff, env_for = start_files_bff(args.out) if fixture == "files" else start_visual_bff(args.out)
        try:
            runs += run_suite(group, args.runs, args.out, args.workers, args.override, stamp, env_for, True, True)
        finally:
            bff.stop()
    return runs


def main(argv: list[str] | None = None) -> int:
    os.chdir(ROOT)
    args = parse_args(argv)
    if args.compare:
        return write_compare(*args.compare)
    if args.report:
        baseline = json.loads(args.baseline.read_text()) if args.baseline else None
        return _rerender(args.report, baseline)
    not_applicable: list[str] = []
    horizon: list[str] = []
    fixture_sets = ("files", "visual", "north-star")
    if args.set in ("precedent", "workspace", "golden", *fixture_sets):
        rows = set_questions(args.set)
        if args.set == "files":
            from files_eval import split_applicable

            rows, not_applicable = split_applicable(rows)
        if args.set == "north-star":
            from north_star_eval import split

            rows, not_applicable, horizon = split(rows)
        selected = ([q for q in rows if not args.only or str(q["id"]) in set(args.only)], [])
    else:
        selected = select_questions(args.only, args.all, NORM_QUESTIONS[args.set])
    if selected is None:
        return 2
    corpus = args.corpus.resolve() if args.corpus else None
    if failed := _preflight(args.out, args.ingest, corpus, needs_corpus=args.set not in ("workspace", *fixture_sets)):
        return failed
    if args.set in fixture_sets:
        from fixture_files import seed_problem

        if problem := seed_problem():
            print(problem, file=sys.stderr)
            return 2
    if args.set in ("visual", "north-star"):
        from fixture_files import seed
        from fixture_visual import load_project

        print(f"seeded {sum(seed(load_project()).values())} chunk(s) of the visual project")
    if args.set in ("files", "north-star"):
        from fixture_files import seed

        print(f"seeded {sum(seed().values())} chunk(s) of the office-file project")
    questions, skipped = selected
    families = corpus_families() if args.set not in ("workspace", *fixture_sets) else None
    not_in_corpus = [f"{q['id']} ({lacking})" for q in questions if (lacking := lacking_family(q, families))]
    questions = [q for q in questions if lacking_family(q, families) is None]
    commit = source_commit()
    _warn_if_dirty(commit)
    arms = arms_for(args)
    stamp = run_stamp()
    for arm in arms:
        arm_args = argparse.Namespace(
            **{
                **vars(args),
                "out": args.out / arm if len(arms) > 1 else args.out,
                "override": [*arm_pairs(arm), *(args.override or [])],
                "arm": arm,
            }
        )
        arm_stamp = f"{stamp}-{arm}" if len(arms) > 1 else stamp
        meta = {
            "started": time.strftime("%Y-%m-%d %H:%M"),
            "commit": commit,
            "config": "configs/config_oib_openrouter.yml",
            "runs_per_question": args.runs,
            "overrides": arm_args.override,
            "stamp": arm_stamp,
            "set": args.set,
            "arm": arm,
            "look": args.look if args.set == "visual" else None,
            "not_applicable": not_applicable,
            "horizon": horizon,
        }
        measure(questions, arm_args, arm_stamp, meta, skipped, not_in_corpus, baseline_for(args.baseline, arm))
    if len(arms) > 1:
        from compare import arms_report
        from compare import load

        (args.out / "arms.md").write_text(arms_report(load(args.out)), encoding="utf-8")
        print(f"Written: {args.out / 'arms.md'}")
    if args.baseline:
        write_compare(args.baseline, args.out)
    return 0


def arms_for(args: argparse.Namespace) -> list[str | None]:
    if args.set != "files":
        return [None]
    from files_eval import arms_of

    return list(arms_of(args.arm))


def arm_pairs(arm: str | None) -> list[list[str]]:
    if arm is None:
        return []
    from files_eval import arm_overrides
    from files_eval import configured_tools

    return arm_overrides(arm, configured_tools())


def baseline_for(baseline: Path | None, arm: str | None) -> dict | None:
    if baseline is None:
        return None
    candidates = [baseline] if baseline.is_file() else [baseline / str(arm) / "results.json", baseline / "results.json"]
    found = next((path for path in candidates if path.is_file()), None)
    return json.loads(found.read_text(encoding="utf-8")) if found else None


def measure(
    questions: list[dict],
    args: argparse.Namespace,
    stamp: str,
    meta: dict,
    skipped: list[str],
    not_in_corpus: list[str],
    baseline: dict | None,
) -> list[Run]:
    arm = f" (arm {meta['arm']})" if meta.get("arm") else ""
    print(f"{len(questions)} question(s) × {args.runs} run(s){arm}, {args.workers} at a time → {args.out}")
    args.out.mkdir(parents=True, exist_ok=True)
    if args.set == "north-star":
        runs = run_north_star(questions, args, stamp)
    else:
        runs = run_set(questions, args, stamp, meta)
    results = {"meta": meta, "skipped": skipped, "not_in_corpus": not_in_corpus, "runs": [asdict(r) for r in runs]}
    (args.out / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1))
    report = render(runs, skipped, meta, baseline, not_in_corpus)
    (args.out / "report.md").write_text(report)
    print(report)
    print(f"Written: {args.out / 'report.md'}, {args.out / 'results.json'}")
    return runs


def write_compare(before: Path, after: Path) -> int:
    from compare import compare_report
    from compare import load

    try:
        report = compare_report(load(before), load(after))
    except (FileNotFoundError, ValueError) as exc:
        print(f"compare: {exc}", file=sys.stderr)
        return 2
    target = (after if after.is_dir() else after.parent) / "compare.md"
    target.write_text(report, encoding="utf-8")
    print(report)
    print(f"Written: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
