#!/usr/bin/env python3
"""Memory-shelves eval: on which shelf do the two memory writers file a note?

WHY THIS EXISTS
---------------
The assistant keeps notes on three shelves (ADR-0180): personal (only the
person reads it), project (its members), organization (everyone). Which shelf a
finding goes to is a model's judgement, made in the post-answer reflection pass
(``agent/memory/reflection.py``) and in the in-turn ``remember`` tool
(``agent/memory/register.py``). The harm is a note about a PERSON on a shelf
other people read. This measures how often that happens, on labelled exchanges
(``tests/fixtures/memory_shelves/cases.yaml``).

WHAT RUNS
---------
- ``reflection``: the real ``run_memory_reflection`` per case: production
  prompt, schema, sanitiser and writers.
- ``tool``: the real ``remember`` tool (production description and schema)
  bound to the same model with the case's user message as the turn; whatever it
  calls runs through the tool's real body. One model step: a call the tool
  refused is not handed back for a second try.
Only ``bff_http.post_json`` is faked, so a note counts when it would have been
sent. The fake accepts organization writes, which a default deployment's BFF
refuses and turns into a confirmation card: an organization note here is the
model's intent.

THE MODEL
---------
The LLM entry ``workflow.memory_reflection_llm`` names in
``configs/config_oib_openrouter.yml``, built the way the server builds it and
pinned to zero-data-retention endpoints (ADR-0074). That is the boot fallback;
a deployment's live default is the admin's choice (``--model`` runs another).
In production the chat model, not this one, decides the ``remember`` call.

THE NUMBERS
-----------
(a) leak: a personal matter on the project or organization shelf, over the
    ``must_not_reach_shared`` cases; (b) a project fact filed only as personal;
(c) any note on a nothing-to-keep case; (d) a secret kept on any shelf. Each
as n of N per pass, category and sub-category, with the spread over runs, for
what was written and for what the model proposed before the filters.

USAGE
-----
    task be:eval:memory-shelves
    task be:eval:memory-shelves -- --runs 1 --only per-01 adv-sec-02
    task be:eval:memory-shelves -- --report /tmp/memory_shelves_eval/<time>/results.json

Needs OPENROUTER_API_KEY; no backend, no database. About 420 short calls.
Exit 1 = a leak or a kept secret was written; 3 = a run errored; 0 otherwise.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "packages" / "agent" / "src"))
sys.path.insert(0, str(REPO_ROOT))

from scripts.memory_shelves_eval import passes  # noqa: E402
from scripts.memory_shelves_eval.report import render  # noqa: E402
from scripts.memory_shelves_eval.scoring import summarise  # noqa: E402

CONFIG = REPO_ROOT / "configs" / "config_oib_openrouter.yml"
CASES = REPO_ROOT / "tests" / "fixtures" / "memory_shelves" / "cases.yaml"
PASSES = ("reflection", "tool")
DEFAULT_MAX_COST = 5.0
#: Errored runs after which no further run starts: a rate limit or a refused key is not a result.
MAX_ERRORS = 15


def _expand(value: Any) -> Any:
    """``${NAME:-default}`` as the agent runtime expands it."""
    if not isinstance(value, str):
        return value
    return re.sub(r"\$\{(\w+)(?::-([^}]*))?\}", lambda m: os.environ.get(m.group(1)) or (m.group(2) or ""), value)


def reflection_llm_config() -> tuple[str, dict[str, Any]]:
    """The name and the config of the LLM the reflection stage is built with, env expanded."""
    config = yaml.safe_load(CONFIG.read_text(encoding="utf-8"))
    name = config["workflow"]["memory_reflection_llm"]
    return name, {key: _expand(value) for key, value in config["llms"][name].items() if key != "_type"}


class Usage:
    """Calls, tokens and cost as the provider reported them, and the brake on both."""

    def __init__(self, max_cost: float) -> None:
        self.calls = self.input_tokens = self.output_tokens = self.errors = 0
        self.cost_usd = 0.0
        self.max_cost = max_cost

    @property
    def stopped(self) -> str | None:
        if self.cost_usd >= self.max_cost:
            return f"cost reached USD {self.cost_usd:.2f} (--max-cost {self.max_cost})"
        return f"{self.errors} runs errored" if self.errors >= MAX_ERRORS else None

    def handler(self) -> Any:
        from langchain_core.callbacks import AsyncCallbackHandler

        usage = self

        class Recorder(AsyncCallbackHandler):
            async def on_llm_end(self, response: Any, **_: Any) -> None:
                message = response.generations[0][0].message
                counted = getattr(message, "usage_metadata", None) or {}
                usage.calls += 1
                usage.input_tokens += counted.get("input_tokens", 0)
                usage.output_tokens += counted.get("output_tokens", 0)
                billed = (getattr(message, "response_metadata", None) or {}).get("token_usage") or {}
                usage.cost_usd += float(billed.get("cost") or 0.0)

        return Recorder()

    def as_dict(self) -> dict[str, Any]:
        return {
            "calls": self.calls,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cost_usd": round(self.cost_usd, 4),
        }


async def _build_llm(builder: Any, name: str, llm_config: dict[str, Any], model: str) -> Any:
    """The stage's LLM as the server builds it, on ``model``, pinned to zero data retention."""
    import nat.plugins.langchain.llm  # noqa: F401 - registers the LangChain wrapper for the OpenAI provider
    from agent.common import get_langchain_llm
    from agent.common.openrouter import ZERO_DATA_RETENTION
    from agent.common.openrouter import pin_chat_model
    from nat.llm.openai_llm import OpenAIModelConfig

    await builder.add_llm(name, OpenAIModelConfig(**{**llm_config, "model_name": model}))
    return pin_chat_model(await get_langchain_llm(builder, name), ZERO_DATA_RETENTION)


async def _one(
    pass_name: str, case: dict[str, Any], run: int, call: Any, usage: Usage, gate: asyncio.Semaphore
) -> dict:
    record: dict[str, Any] = {"pass": pass_name, "case_id": case["id"], "run": run, "proposed": [], "written": []}
    async with gate:
        if usage.stopped:
            return {**record, "error": f"not started: {usage.stopped}"}
        try:
            record.update(await call(case))
        except Exception as exc:  # noqa: BLE001 - one failed call is a recorded error, never a clean run
            usage.errors += 1
            record["error"] = f"{type(exc).__name__}: {str(exc)[:400]}"
    print(f"  {pass_name:10} {case['id']:11} run {run}: {_brief(record)}", flush=True)
    return record


def _brief(record: dict[str, Any]) -> str:
    if record.get("error"):
        return f"ERROR {record['error'][:120]}"
    return ", ".join(f"{note['shelf']}/{note['kind']}" for note in record["written"]) or "nothing written"


async def run_all(args: argparse.Namespace, cases: list[dict[str, Any]], usage: Usage) -> list[dict[str, Any]]:
    from nat.builder.workflow_builder import WorkflowBuilder

    name, llm_config = reflection_llm_config()
    if args.max_tokens:
        llm_config["max_tokens"] = args.max_tokens
    gate = asyncio.Semaphore(args.workers)
    async with WorkflowBuilder() as builder, passes.remember_tool() as tool:
        llm = (await _build_llm(builder, name, llm_config, args.model)).with_config(callbacks=[usage.handler()])
        calls = {
            "reflection": lambda case: passes.reflect_once(llm, case),
            "tool": lambda case: passes.remember_once(llm, tool, case),
        }
        with passes.faked_turn():
            return await asyncio.gather(
                *(
                    _one(pass_name, case, run, calls[pass_name], usage, gate)
                    for pass_name in args.passes
                    for run in range(1, args.runs + 1)
                    for case in cases
                )
            )


def _commit() -> str:
    done = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"], check=False, cwd=REPO_ROOT, capture_output=True, text=True
    )
    return done.stdout.strip() or "unknown"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--model", default=None, help="OpenRouter model id (default: the stage's boot fallback)")
    parser.add_argument("--runs", type=int, default=3, help="Runs per case and pass (default 3)")
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--passes", nargs="+", choices=PASSES, default=list(PASSES))
    parser.add_argument("--only", nargs="*", default=[], help="Case ids to run")
    parser.add_argument("--cases", type=Path, default=CASES)
    parser.add_argument(
        "--out", type=Path, default=None, help="Report directory (default /tmp/memory_shelves_eval/<time>)"
    )
    parser.add_argument(
        "--max-tokens",
        type=int,
        default=None,
        help="Output-token ceiling in place of the config's (a provider prices a request by its ceiling)",
    )
    parser.add_argument("--max-cost", type=float, default=DEFAULT_MAX_COST, help="USD after which no run starts")
    parser.add_argument("--report", type=Path, help="Re-render a results.json; no model")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.report:
        print(render(json.loads(args.report.read_text(encoding="utf-8"))))
        return 0
    if not os.environ.get("OPENROUTER_API_KEY"):
        print("OPENROUTER_API_KEY is not set; every run is a model call.", file=sys.stderr)
        return 2
    cases = yaml.safe_load(args.cases.read_text(encoding="utf-8"))["cases"]
    cases = [case for case in cases if not args.only or case["id"] in args.only]
    name, llm_config = reflection_llm_config()
    model_source = "the config's boot fallback" if not args.model else "--model"
    args.model = args.model or llm_config["model_name"]
    print(f"{len(cases)} cases x {args.runs} runs x {args.passes} on {args.model} ({name}: {model_source})", flush=True)
    usage = Usage(args.max_cost)
    records = asyncio.run(run_all(args, cases, usage))
    results = {
        "meta": {
            "model": args.model,
            "model_source": f"{name}, {model_source}",
            "llm_config": {key: value for key, value in llm_config.items() if key != "api_key"},
            "max_tokens_override": args.max_tokens,
            "runs": args.runs,
            "commit": _commit(),
            "finished": time.strftime("%Y-%m-%d %H:%M:%S"),
            "tool_pass_system": passes.TOOL_PASS_SYSTEM,
            "usage": usage.as_dict(),
        },
        "cases": cases,
        "records": records,
        "summary": summarise(cases, records),
    }
    out = args.out or Path("/tmp/memory_shelves_eval") / time.strftime("%Y%m%d-%H%M%S")
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps(results, indent=1, ensure_ascii=False), encoding="utf-8")
    text = render(results)
    (out / "report.md").write_text(text, encoding="utf-8")
    print(text)
    print(f"\nWrote {out / 'results.json'} and {out / 'report.md'}")
    overall = [results["summary"][pass_name]["overall"] for pass_name in results["summary"]]
    if any(tally["leak"]["n"] or tally["secret_kept"]["n"] for tally in overall):
        return 1
    return 3 if any(record.get("error") for record in records) else 0


if __name__ == "__main__":
    sys.exit(main())
