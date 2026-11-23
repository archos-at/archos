from __future__ import annotations

import re
from pathlib import Path

from answer_checks import _judge
from answer_checks import check
from census import kind as call_kind
from census import records
from census import timed_out
from cited_files import cited_families
from files_eval import recorded_calls
from fixture_bff import lookups_served
from fixture_bff import marks_proposed
from fixture_bff import proposals_filed
from fixture_bff import writes_attempted
from run_record import Run

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


def _entry_envelope(entry: dict) -> dict | None:
    from agent.common.envelope_parsing import extract_answer_envelope

    found = None
    for item in (entry.get("resp") or {}).get("output", []):
        if item.get("type") != "message":
            continue
        _, meta = extract_answer_envelope("".join(part.get("text", "") for part in item.get("content", [])))
        if meta is not None:
            found = meta.model_dump(mode="json")
    return found


def last_envelope(research: list[dict]) -> tuple[dict | None, int | None]:
    found, at = None, None
    for position, entry in enumerate(research):
        envelope = _entry_envelope(entry)
        if envelope is not None:
            found, at = envelope, position
    return found, at


def _no_answer(log_text: str) -> str:
    return "timed out" if timed_out(log_text) else "no Workflow Result in the log"


def _function_names(entry: dict) -> list[str]:
    return [
        str(item.get("name"))
        for item in (entry.get("resp") or {}).get("output", [])
        if item.get("type") == "function_call"
    ]


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
        run.tool_calls.extend(_function_names(entry))
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
    _fixture_checks(run, question, record, requests, door_offset, look_on)
    if "escalated" not in run.signals and not run.answer:
        run.error = _no_answer(log_text)
    return run


def _fixture_checks(
    run: Run, question: dict, record: Path, requests: Path, door_offset: int | None, look_on: bool
) -> None:
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
