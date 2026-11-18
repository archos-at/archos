from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import asdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
QUESTIONS = ROOT / "tests" / "fixtures" / "derivation" / "loop_eval_questions.yaml"
PRECEDENT_QUESTIONS = ROOT / "tests" / "fixtures" / "precedent" / "precedent_questions.yaml"
NORM_QUESTIONS = {"loop": QUESTIONS, "editions": ROOT / "tests" / "fixtures" / "editions" / "at_edition_questions.yaml"}
sys.path.insert(0, str(HERE))

from answer_checks import check  # noqa: E402
from census import run_stamp  # noqa: E402
from eval_sets import set_module  # noqa: E402
from run_record import Run  # noqa: E402
from suite_cli import parse_args  # noqa: E402
from suite_preflight import _preflight  # noqa: E402
from suite_preflight import corpus_families  # noqa: E402
from suite_preflight import lacking_family  # noqa: E402
from suite_report import render  # noqa: E402
from suite_runs import run_north_star  # noqa: E402
from suite_runs import run_set  # noqa: E402
from turn_observation import observe  # noqa: E402


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


def source_commit() -> str:
    import subprocess

    def git(*args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=False)

    sha = git("rev-parse", "--short", "HEAD").stdout.strip() or "unknown"
    return f"{sha}-dirty" if git("status", "--porcelain", "--untracked-files=no").stdout.strip() else sha


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


def main(argv: list[str] | None = None) -> int:
    os.chdir(ROOT)
    args = parse_args(argv)
    if args.compare:
        return write_compare(*args.compare)
    if args.report:
        baseline = json.loads(args.baseline.read_text()) if args.baseline else None
        return _rerender(args.report, baseline)
    fixture_sets = ("files", "visual", "north-star")
    selected, not_applicable, horizon = _selected(args, fixture_sets)
    if selected is None:
        return 2
    corpus = args.corpus.resolve() if args.corpus else None
    if failed := _preflight(args.out, args.ingest, corpus, needs_corpus=args.set not in ("workspace", *fixture_sets)):
        return failed
    if failed := _seed_fixtures(args, fixture_sets):
        return failed
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


def _selected(
    args: argparse.Namespace, fixture_sets: tuple[str, ...]
) -> tuple[tuple[list[dict], list[str]] | None, list[str], list[str]]:
    not_applicable: list[str] = []
    horizon: list[str] = []
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
    return selected, not_applicable, horizon


def _seed_fixtures(args: argparse.Namespace, fixture_sets: tuple[str, ...]) -> int:
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
