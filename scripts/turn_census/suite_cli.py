"""The answer suite's command line: its flags, and the combinations it refuses before any work.

Split out of ``suite.py`` (``docs/contributing/code-conventions.md#size-limits``);
``suite.main`` reads its arguments here and does the rest.
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

CASES_HELP = (
    "--set golden: the golden cases, a file in the records format (configs/knowledge-packs/*-golden-cases.json)"
)


def build_parser(description: str | None) -> argparse.ArgumentParser:
    """The suite's flags."""
    parser = argparse.ArgumentParser(description=description, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--all", action="store_true", help="every question with a family, not only `suite: core`")
    parser.add_argument("--only", nargs="*", help="question ids to run")
    parser.add_argument("--runs", type=int, default=2)
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--out", type=Path, default=Path("/tmp/answer_suite") / time.strftime("%Y%m%d-%H%M%S"))
    parser.add_argument(
        "--baseline",
        type=Path,
        help="an earlier results.json (or --arm all directory) to compare against; also writes compare.md",
    )
    parser.add_argument("--report", type=Path, help="re-render a results.json; no model calls")
    parser.add_argument("--ingest", action="store_true", help="sync the OIB corpus into Qdrant first")
    parser.add_argument(
        "--corpus",
        type=Path,
        help="with --ingest: the base corpus is this directory's PDFs (e.g. data/oib), not the object store",
    )
    parser.add_argument("--override", nargs=2, action="append", metavar=("KEY", "VALUE"))
    parser.add_argument(
        "--set",
        choices=("loop", "editions", "golden", "precedent", "workspace", "files", "visual", "north-star"),
        default="loop",
        help=(
            "loop: the norm questions; editions: which OIB-RL edition binds per Land and day (edition_eval.py); "
            "golden: a country's golden cases, from --cases (golden_eval.py); "
            "precedent: questions in a fixture office's project (fixture_bff.py); "
            "workspace: office work through the MCP door (fixture_workspace.py); "
            "files: questions about a fixture project's own files (files_eval.py); "
            "visual: questions answered by looking at a drawing (visual_eval.py); "
            "north-star: the exemplars of docs/architecture/north-star-answers.md (north_star_eval.py)"
        ),
    )
    parser.add_argument("--cases", type=Path, help=CASES_HELP)
    parser.add_argument(
        "--look",
        choices=("on", "off"),
        default="on",
        help="--set visual: off sets VIEW_IMAGES_ENABLED=0 for the run, the paired arm for what looking is worth",
    )
    parser.add_argument(
        "--arm",
        choices=("semantic", "grep", "hybrid", "all", "search", "navigate", "both"),
        default="hybrid",
        help=(
            "--set files (ADR-0133): semantic = ranked search only; grep = list, read and literal search; "
            "hybrid = as shipped; all = the three in turn, each into its own directory under --out. "
            "search, navigate and both are the earlier names of the three"
        ),
    )
    parser.add_argument(
        "--compare",
        nargs=2,
        type=Path,
        metavar=("BEFORE", "AFTER"),
        help="compare two runs (each a results.json or an --arm all directory) arm by arm; no model calls",
    )
    return parser


def parse_args(argv: list[str] | None, *, description: str | None) -> argparse.Namespace:
    """``argv`` as the suite's arguments; exits with the usage line on a combination it cannot run."""
    parser = build_parser(description)
    args = parser.parse_args(argv)
    if args.corpus is not None and not args.ingest:
        parser.error("--corpus is what --ingest reads; give both")
    if args.arm != "hybrid" and args.set != "files":
        parser.error("--arm is for --set files")
    if (args.cases is not None) != (args.set == "golden"):
        parser.error("--set golden reads its cases from --cases; give both")
    if args.cases is not None and not args.cases.exists():
        parser.error(f"--cases {args.cases} does not exist")
    if args.cases is not None:
        import golden_eval

        # Before any question is loaded, a --report's among them: the set reads its rows from this file.
        golden_eval.CASES_FILE = args.cases.resolve()
    if args.look != "on" and args.set != "visual":
        parser.error("--look is for --set visual")
    if args.baseline is not None and not args.baseline.exists():
        parser.error(f"--baseline {args.baseline} does not exist")
    return args
