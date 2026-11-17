from __future__ import annotations

import statistics
from collections.abc import Callable
from pathlib import Path
from typing import Any

from census import run_once
from fixture_bff import ROOT
from fixture_workspace import workspace_calls

QUESTIONS = ROOT / "tests" / "fixtures" / "workspace" / "workspace_questions.yaml"
MEANING_CHECKS = ("pending", "asks")
DOOR_PREFIX = "workspace__"


def load_questions(path: Path = QUESTIONS) -> list[dict]:
    import yaml

    rows = list((yaml.safe_load(path.read_text(encoding="utf-8")) or {}).get("questions") or [])
    for row in rows:
        row["question"] = turns_of(row)[-1]
    return rows


def turns_of(question: dict) -> list[str]:
    turns = question.get("turns")
    return [str(turn) for turn in turns] if turns else [str(question["question"])]




def _operation(call: dict[str, Any]) -> str | None:
    name = (call.get("arguments") or {}).get("name")
    return str(name) if name else None


def _structured(call: dict[str, Any]) -> dict[str, Any]:
    result = call.get("result") or {}
    structured = result.get("structuredContent")
    return structured if isinstance(structured, dict) else {}


def proposals(calls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {"operation": _operation(call), "input": (call.get("arguments") or {}).get("input") or {}}
        for call in calls
        if call.get("tool") == "call-operation" and _structured(call).get("decision") == "propose"
    ]


def reads(calls: list[dict[str, Any]]) -> list[str]:
    return [
        name
        for call in calls
        if call.get("tool") == "call-operation"
        and not (call.get("result") or {}).get("isError")
        and _structured(call).get("decision") != "propose"
        and (name := _operation(call))
    ]


def door_metrics(calls: list[dict[str, Any]]) -> dict[str, int]:
    metrics = {"searches": 0, "search_misses": 0, "describes": 0, "calls": 0, "refused": 0, "proposals": 0}
    for call in calls:
        tool = call.get("tool")
        result = call.get("result") or {}
        if tool == "search-operations":
            metrics["searches"] += 1
            metrics["search_misses"] += 1 if not _structured(call).get("operations") else 0
        elif tool == "describe-operation":
            metrics["describes"] += 1
        elif tool == "call-operation":
            metrics["calls"] += 1
            metrics["refused"] += 1 if result.get("isError") else 0
            metrics["proposals"] += 1 if _structured(call).get("decision") == "propose" else 0
    return metrics


def _value_at(data: Any, path: str) -> Any:
    for part in path.split("."):
        if not isinstance(data, dict):
            return None
        data = data.get(part)
    return data


def _matches(expected: Any, actual: Any) -> bool:
    options = expected if isinstance(expected, list) else [expected]
    return actual is not None and any(str(actual).strip().casefold() == str(o).strip().casefold() for o in options)


def proposed(expected: dict[str, Any], filed: list[dict[str, Any]], tool_calls: list[str]) -> bool:
    if expected.get("or_tool") and any(name.endswith(str(expected["or_tool"])) for name in tool_calls):
        return True
    for proposal in filed:
        if proposal["operation"] != expected["operation"]:
            continue
        if all(
            _matches(value, _value_at(proposal["input"], path)) for path, value in (expected.get("input") or {}).items()
        ):
            return True
    return False


def used(expected: str | list[str], calls: list[dict[str, Any]], tool_calls: list[str]) -> bool:
    options = [str(option) for option in (expected if isinstance(expected, list) else [expected])]
    called = {_operation(call) for call in calls if call.get("tool") == "call-operation"}
    return any(option in called or any(name.endswith(option) for name in tool_calls) for option in options)


Judge = Callable[[str, str, str], "bool | None"]


def workspace_checks(
    expect: dict[str, Any],
    calls: list[dict[str, Any]],
    tool_calls: list[str],
    answer: str,
    question: str,
    judge: Judge | None,
    signals: list[str],
) -> dict[str, bool]:
    checks: dict[str, bool] = {}
    done = reads(calls)
    for operation in expect.get("reads") or []:
        checks[f"reads:{operation}"] = operation in done
    filed = proposals(calls)
    for item in expect.get("proposes") or []:
        key = f"proposes:{item['operation']}"
        key = key if key not in checks else f"{key}#{sum(k.startswith(key) for k in checks) + 1}"
        checks[key] = proposed(item, filed, tool_calls)
    for item in expect.get("uses") or []:
        first = item[0] if isinstance(item, list) else item
        checks[f"uses:{first}"] = used(item, calls, tool_calls)
    if expect.get("no_write"):
        checks["no_write"] = not filed
    if expect.get("no_workspace"):
        checks["no_workspace"] = not calls and not any(DOOR_PREFIX in name for name in tool_calls)
    for operation in expect.get("no_repeat") or []:
        checks[f"no_repeat:{operation}"] = operation not in [
            _operation(c) for c in calls if c.get("tool") == "call-operation"
        ]
    for kind in expect.get("judge") or []:
        verdict = judge(kind, question, answer) if judge is not None and answer.strip() else None
        checks[f"judge:{kind}"] = bool(verdict)
        if verdict is None and answer.strip():
            signals.append(f"judge_unavailable:{kind}")
    return checks




def run_conversation(
    question: dict,
    index: int,
    out: Path,
    conversation: str,
    overrides: list[list[str]] | None,
    extra: dict[str, str] | None,
) -> tuple[Path, int]:
    turns = turns_of(question)
    for number, text in enumerate(turns[:-1], start=1):
        run_once(text, out, conversation, overrides, extra, name=f"{conversation}-t{number}")
    before = len(workspace_calls(out / "requests.jsonl", conversation))
    return run_once(turns[-1], out, conversation, overrides, extra), before


def report_lines(runs: list[Any], meta: dict[str, Any] | None = None) -> list[str]:
    ok = [run for run in runs if not run.error]
    if not ok:
        return ["## Workspace", "", "No run finished."]
    held = [all(run.checks.values()) for run in ok if run.checks]
    metrics = [door_metrics(run.door) for run in ok]
    searches = sum(m["searches"] for m in metrics)
    misses = sum(m["search_misses"] for m in metrics)
    median = statistics.median
    return [
        "## Workspace",
        "",
        f"- runs where every check held: {sum(held)}/{len(held)} ({sum(held) / max(1, len(held)):.0%})",
        f"- checks held: {sum(sum(run.checks.values()) for run in ok)}/{sum(len(run.checks) for run in ok)}",
        f"- rounds (research calls to the answer), median: {median([run.research_calls for run in ok]):g}, "
        f"mean {sum(run.research_calls for run in ok) / len(ok):.2f}",
        f"- door calls per run, mean: {sum(len(run.door) for run in ok) / len(ok):.2f} "
        f"(searches {searches}, of which found nothing {misses}; describes "
        f"{sum(m['describes'] for m in metrics)}; calls {sum(m['calls'] for m in metrics)}, refused "
        f"{sum(m['refused'] for m in metrics)}, proposals {sum(m['proposals'] for m in metrics)})",
        f"- input tokens per run, median: {median([run.input_tokens for run in ok]):g}; output "
        f"{median([run.output_tokens for run in ok]):g}; reasoning {median([run.reasoning_tokens for run in ok]):g}",
        f"- wall seconds per run, median: {median([run.wall_s for run in ok]):g}; answering call "
        f"{median([run.final_call_s for run in ok]):g}",
        "",
    ]
