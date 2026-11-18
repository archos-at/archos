from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import fixture_law
from census import run_once
from census import run_stamp
from run_record import Run
from suite_fixtures import precedent_envelope
from suite_fixtures import start_files_bff
from suite_fixtures import start_fixture_bff
from suite_fixtures import start_visual_bff
from suite_fixtures import start_workspace_bff
from turn_observation import observe
from workspace_eval import run_conversation


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
