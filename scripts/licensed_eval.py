#!/usr/bin/env python3
"""The licensed-seam eval: how well answers use licensed norm text, and whether any of it leaks.

``tests/fixtures/licensed_eval/norms.yaml`` holds norm-like documents with tables (written for
this eval, no real standard's text) and questions read off them. Some table cells are unreadable
on purpose, the way a scanned page reaches the index; a question about one expects the answer to
point to the page and the table and to state no value.

Each question runs as one turn through the real chat-request contract (``llm_factory``) against
OpenRouter: the platform's static system prompt, the question, a ``knowledge_search`` call and its
grounding block as the tool result. Three arms change only how the passage is marked:

- ``public``: unmarked, the text in the transcript, as every office document is today;
- ``seam``: marked ``licensed`` with the ``licensed-seam`` flag on: a reference in the transcript,
  the text expanded inside the call, the reply capped (``common/licensed_text.py``);
- ``off``: marked ``licensed`` with the flag off: listed, no text.

Per run it records whether the expected value is stated, whether an unreadable value is pointed to
and not guessed, the longest stretch of licensed text in the answer against the quote cap, and two
leak checks: the longest licensed stretch any LangChain callback saw (what Langfuse and the agent
runtime's spans are built from) and in the messages a checkpoint would store. ``off`` is the
floor (the model never read the text) and ``public`` the ceiling the seam is measured against.

    .venv/bin/python scripts/licensed_eval.py --out /tmp/licensed-eval            # 2 runs per question and arm
    .venv/bin/python scripts/licensed_eval.py --arm seam --runs 1 --only barrier_mid
    .venv/bin/python scripts/licensed_eval.py --report /tmp/licensed-eval/results.json

Needs OPENROUTER_API_KEY. ``--model`` defaults to ``DEFAULT_MODEL``, else the configs' boot default.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import statistics
import sys
import time
from dataclasses import asdict
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "agent" / "src"))

FIXTURE = ROOT / "tests" / "fixtures" / "licensed_eval" / "norms.yaml"
ARMS = ("public", "seam", "off")
BOOT_MODEL = "openai/gpt-6-luna"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


@dataclass
class Run:
    question: str
    arm: str
    run: int
    seconds: float = 0.0
    answer: str = ""
    value_found: bool | None = None
    pointed: bool | None = None
    guessed: list[str] = field(default_factory=list)
    answer_run: int = 0
    callback_run: int = 0
    checkpoint_run: int = 0
    cap: int = 0
    capped_runs: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    error: str | None = None


# ---------------------------------------------------------------------------
# Measuring
# ---------------------------------------------------------------------------


def _norm(text: str) -> str:
    return " ".join(text.split()).lower()


def longest_licensed_run(text: str, licensed: str) -> int:
    """The longest stretch of ``text`` that also occurs in ``licensed`` (whitespace and case normalised)."""
    a, b = _norm(text), _norm(licensed)
    best, previous = 0, [0] * (len(b) + 1)
    for i in range(1, len(a) + 1):
        current = [0] * (len(b) + 1)
        for j in range(1, len(b) + 1):
            if a[i - 1] == b[j - 1]:
                current[j] = previous[j - 1] + 1
                best = max(best, current[j])
        previous = current
    return best


def _value_pattern(value: str) -> re.Pattern[str]:
    """``100 cm`` matched as ``100 cm``, ``100cm`` or ``1,00 m``-free: the number, then the unit, spaces optional."""
    number, _, unit = value.partition(" ")
    return re.compile(rf"(?<![\d,.]){re.escape(number)}\s*{re.escape(unit)}\b", re.IGNORECASE)


def check(answer: str, expect: dict[str, Any]) -> dict[str, Any]:
    """The answer against the question's expectations: values stated, place pointed to, nothing guessed."""
    result: dict[str, Any] = {}
    if expect.get("values"):
        result["value_found"] = all(_value_pattern(value).search(answer) for value in expect["values"])
    points = expect.get("points_to")
    if points:
        page = re.search(rf"(S\.|Seite|p\.|page|pp\.)\s*{points['page']}\b", answer, re.IGNORECASE)
        label = points["label"].lower() in answer.lower()
        result["pointed"] = bool(page or label)
    result["guessed"] = [value for value in expect.get("not_values", []) if _value_pattern(value).search(answer)]
    return result


# ---------------------------------------------------------------------------
# One turn
# ---------------------------------------------------------------------------


def _hit(document: dict[str, Any], arm: str):
    from agent.common.grounding_block import GroundingHit
    from agent.common.licensed_text import LicenceTerms

    licence = (
        None if arm == "public" else LicenceTerms(licence_class="licensed", quote_max_chars=document["quote_max_chars"])
    )
    return GroundingHit(
        citation_key=f"{document['file_name']}, p.{document['page']}",
        file_name=document["file_name"],
        page=document["page"],
        shelf="office_shelf",
        collection="office-licensed-eval",
        doc_class=None,
        display_title=document["title"],
        folder_path="Normen",
        clause=document["clause"],
        score=0.87,
        content_type="text",
        provenance=None,
        stored_image_index=None,
        status_note=None,
        body=document["text"].strip(),
        licence=licence,
    )


def _block(document: dict[str, Any], arm: str) -> str:
    from agent.common.grounding_block import GroundingBlock
    from agent.common.grounding_block import render_grounding_block

    block = GroundingBlock(
        preamble="Found 1 result in the office's Büroablage.",
        degraded_banner="",
        hits=(_hit(document, arm),),
        lanes=(),
        tool="knowledge_search",
    )
    return render_grounding_block(block)


def _system_prompt() -> str:
    from agent.agents.piloti.prompt import bundled_static_block
    from agent.agents.piloti.prompt import render_static_block

    return render_static_block(bundled_static_block().text)


def _messages(question: dict[str, Any], block: str) -> list:
    from langchain_core.messages import AIMessage
    from langchain_core.messages import HumanMessage
    from langchain_core.messages import SystemMessage
    from langchain_core.messages import ToolMessage

    call = {"name": "knowledge_search", "args": {"query": question["question"]}, "id": "call_search"}
    return [
        SystemMessage(content=_system_prompt()),
        HumanMessage(content=question["question"]),
        AIMessage(content="", tool_calls=[call]),
        ToolMessage(content=block, tool_call_id="call_search"),
    ]


def _model(model: str):
    from langchain_openai import ChatOpenAI

    from agent.common.llm_factory import enforce_chat_request_contract
    from agent.common.openrouter import PLATFORM_FIXED
    from agent.common.openrouter import pin_chat_model

    llm = ChatOpenAI(
        model=model,
        api_key=os.environ["OPENROUTER_API_KEY"],
        base_url=OPENROUTER_BASE_URL,
        streaming=True,
        reasoning_effort="low",
        max_retries=2,
        stream_usage=True,
    )
    return pin_chat_model(enforce_chat_request_contract(llm), PLATFORM_FIXED)


def _recorder():
    from langchain_core.callbacks import AsyncCallbackHandler
    from langchain_core.load import dumpd

    def strings(value: Any) -> list[str]:
        if isinstance(value, str):
            return [value]
        if isinstance(value, dict):
            return [text for item in value.values() for text in strings(item)]
        if isinstance(value, list | tuple):
            return [text for item in value for text in strings(item)]
        return []

    class Recorder(AsyncCallbackHandler):
        def __init__(self) -> None:
            self.seen: list[str] = []

        async def on_chat_model_start(self, serialized, messages, **kwargs):
            self.seen.extend(strings(dumpd(messages)))

        async def on_llm_new_token(self, token, **kwargs):
            self.seen.append(token)

        async def on_llm_end(self, response, **kwargs):
            self.seen.extend(strings(dumpd(response.generations)))

    return Recorder(), strings


async def run_one(question: dict[str, Any], document: dict[str, Any], arm: str, index: int, model: str) -> Run:
    """One question, one arm, one run, measured."""
    from langchain_core.load import dumpd

    from agent.common.grounding_block import begin_grounding_capture
    from agent.common.grounding_block import end_grounding_capture

    licensed = document["text"].strip()
    record = Run(question=question["id"], arm=arm, run=index, cap=document["quote_max_chars"])
    recorder, strings = _recorder()
    token = begin_grounding_capture(licensed_text=arm != "off")
    started = time.monotonic()
    try:
        messages = _messages(question, _block(document, arm))
        record.checkpoint_run = longest_licensed_run("\n".join(strings(dumpd(messages))), licensed)
        reply = await _model(model).ainvoke(messages, config={"callbacks": [recorder]})
        record.answer = str(reply.content)
        usage = reply.usage_metadata or {}
        record.input_tokens, record.output_tokens = usage.get("input_tokens", 0), usage.get("output_tokens", 0)
    except Exception as error:  # noqa: BLE001 - one failed run is a row in the report, not a dead eval
        record.error = f"{type(error).__name__}: {error}"[:300]
    finally:
        end_grounding_capture(token)
        record.seconds = round(time.monotonic() - started, 2)
    record.callback_run = longest_licensed_run("\n".join(recorder.seen), licensed)
    record.answer_run = longest_licensed_run(record.answer, licensed)
    record.capped_runs = record.answer.count("[…]")
    if record.error is None:  # a failed call answered nothing: it is an error, not a wrong answer
        for key, value in check(record.answer, question["expect"]).items():
            setattr(record, key, value)
    return record


# ---------------------------------------------------------------------------
# The report
# ---------------------------------------------------------------------------


def _share(values: list[bool | None]) -> str:
    counted = [value for value in values if value is not None]
    return f"{sum(counted)}/{len(counted)}" if counted else "–"


def _arm_row(arm: str, runs: list[Run]) -> str:
    mine = [run for run in runs if run.arm == arm]
    if not mine:
        return ""
    leaks = sum(1 for run in mine if arm != "public" and max(run.callback_run, run.checkpoint_run) > run.cap)
    over_cap = sum(1 for run in mine if arm != "public" and run.answer_run > run.cap)
    seconds = statistics.median(run.seconds for run in mine)
    tokens = statistics.median(run.input_tokens for run in mine)
    return (
        f"| {arm} | {_share([run.value_found for run in mine])} | {_share([run.pointed for run in mine])} "
        f"| {sum(1 for run in mine if run.guessed)} | {max(run.answer_run for run in mine)} | {over_cap} "
        f"| {max(run.callback_run for run in mine)} | {max(run.checkpoint_run for run in mine)} | {leaks} "
        f"| {seconds:.1f} | {tokens:.0f} | {sum(1 for run in mine if run.error)} |"
    )


def report(runs: list[Run], meta: dict[str, Any]) -> str:
    """The report as Markdown: one row per arm, then one row per question and arm."""
    lines = [
        "# Licensed-seam eval",
        "",
        f"Model `{meta['model']}`, {meta['runs']} run(s) per question and arm, commit `{meta['commit']}`.",
        "",
        "| Arm | Value stated | Unreadable value pointed to | Runs that guessed "
        "| Longest licensed stretch in an answer | Answers over the cap | Longest in a callback "
        "| Longest in the checkpoint | Leak runs | Median s | Median input tokens | Errors |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|",
        *(row for arm in ARMS if (row := _arm_row(arm, runs))),
        "",
        "A leak is a `seam` or `off` run in which a callback or the checkpointed messages held a licensed stretch "
        "longer than the quote cap. `public` is the ceiling: the text is in the transcript there by design.",
        "",
        "| Question | Arm | Value | Pointed | Guessed | Answer stretch / cap | Callback | Checkpoint | s |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for run in sorted(runs, key=lambda item: (item.question, ARMS.index(item.arm), item.run)):
        lines.append(
            f"| {run.question} | {run.arm} | {_mark(run.value_found)} | {_mark(run.pointed)} "
            f"| {', '.join(run.guessed) or '–'} "
            f"| {run.answer_run} / {run.cap} | {run.callback_run} | {run.checkpoint_run} | {run.seconds} |"
            + (f" error: {run.error}" if run.error else "")
        )
    return "\n".join(lines) + "\n"


def _mark(value: bool | None) -> str:
    return "–" if value is None else ("yes" if value else "no")


# ---------------------------------------------------------------------------
# The command
# ---------------------------------------------------------------------------


def _commit() -> str:
    import subprocess

    def git(*argv: str) -> str:
        return subprocess.run(["git", *argv], capture_output=True, text=True, cwd=ROOT, check=False).stdout.strip()

    head, dirty = git("rev-parse", "--short", "HEAD"), git("status", "--porcelain", "--untracked-files=no")
    return head + ("-dirty" if dirty else "")


async def _run_all(args: argparse.Namespace, fixture: dict[str, Any]) -> list[Run]:
    documents = {document["id"]: document for document in fixture["documents"]}
    questions = [q for q in fixture["questions"] if not args.only or q["id"] in args.only]
    arms = ARMS if args.arm == "all" else (args.arm,)
    limit = asyncio.Semaphore(args.workers)

    async def one(question: dict[str, Any], arm: str, index: int) -> Run:
        async with limit:
            return await run_one(question, documents[question["document"]], arm, index, args.model)

    jobs = [one(q, arm, index) for q in questions for arm in arms for index in range(args.runs)]
    return list(await asyncio.gather(*jobs))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=Path("/tmp/licensed-eval"))
    parser.add_argument("--arm", choices=(*ARMS, "all"), default="all")
    parser.add_argument("--runs", type=int, default=2)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--only", nargs="*", default=[])
    parser.add_argument("--model", default=os.environ.get("DEFAULT_MODEL") or BOOT_MODEL)
    parser.add_argument("--report", type=Path, help="re-render a results.json without model calls")
    args = parser.parse_args()
    if args.report:
        saved = json.loads(args.report.read_text())
        print(report([Run(**run) for run in saved["runs"]], saved["meta"]))
        return 0
    if not os.environ.get("OPENROUTER_API_KEY"):
        print("OPENROUTER_API_KEY is not set; every run is a model call.", file=sys.stderr)
        return 2
    fixture = yaml.safe_load(FIXTURE.read_text())
    runs = asyncio.run(_run_all(args, fixture))
    meta = {"model": args.model, "runs": args.runs, "commit": _commit()}
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "results.json").write_text(json.dumps({"meta": meta, "runs": [asdict(run) for run in runs]}, indent=1))
    text = report(runs, meta)
    (args.out / "report.md").write_text(text)
    print(text)
    return 1 if any(run.arm != "public" and max(run.callback_run, run.checkpoint_run) > run.cap for run in runs) else 0


if __name__ == "__main__":
    sys.exit(main())
