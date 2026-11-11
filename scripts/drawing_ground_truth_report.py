"""Count what the measuring engine does on the ground-truth set, and how its constants behave there.

    .venv/bin/python scripts/drawing_ground_truth_report.py

Prints, as Markdown: per sheet how many probes were answered with a number and how many of those hold the
true value in their interval, why the others were refused, how far measured values lie from the truth as a
share of the half interval stated, and for each constant the same counts at half and at double its value.
It changes no constant: each is set for one pass in this process and put back.

The set is synthetic (``knowledge_layer_testing.ground_truth_sheets``): this measures the engine, not
anybody's drafting. ``packages/agent/tests/drawings/test_ground_truth.py`` holds the release gate.
"""

from __future__ import annotations

import sys
from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
for part in ("packages/agent/src", "packages/knowledge-layer/testing", "packages/agent/tests/testing"):
    sys.path.insert(0, str(ROOT / part))

from agent_testing import ground_truth  # noqa: E402
from agent_testing.ground_truth import Drawn  # noqa: E402
from agent_testing.ground_truth import Result  # noqa: E402
from knowledge_layer_testing.ground_truth_sheets import jittered  # noqa: E402

from agent.drawings import sheet_answers  # noqa: E402
from agent.drawings import sheet_measure  # noqa: E402
from agent.drawings import sheet_probe  # noqa: E402
from agent.drawings import sheet_scale  # noqa: E402

BUCKETS = ((0.0, "0"), (0.25, "up to 0.25"), (0.5, "up to 0.5"), (0.75, "up to 0.75"), (1.0, "up to 1"))
#: How far every point is moved when the set is asked with a less steady hand, how often, and the seed.
HAND_PT = (1.0, 2.0, 3.0, 4.0, 6.0, 9.0)
HAND_COPIES = 5
HAND_SEEDS = (3, 7, 10, 12)
#: Each constant: its name, the modules that hold it, and the two values tried beside its own.
#: A count cannot be halved to 1.5 and a share cannot be doubled past 1: 2 and 1.0 stand in, and the table says so.
CONSTANTS: tuple[tuple[str, tuple[object, ...], float, float], ...] = (
    ("AGREEMENT_TOLERANCE", (sheet_scale,), 0.0025, 0.01),
    ("MIN_AGREEING", (sheet_scale,), 2, 6),
    ("MIN_AGREEING_SHARE", (sheet_scale,), 0.4, 1.0),
    ("SNAP_RADIUS_PT", (sheet_probe, sheet_scale), 3.0, 12.0),
    ("VERDICT_FLOOR_M", (sheet_answers, sheet_measure), 0.01, 0.04),
)


@contextmanager
def constant(name: str, modules: tuple[object, ...], value: float) -> Iterator[None]:
    """``name`` set to ``value`` wherever it is held, for the block, then put back."""
    kept = [getattr(module, name) for module in modules]
    defaults = sheet_answers.decide.__kwdefaults__
    floor = defaults["floor"]
    for module in modules:
        setattr(module, name, value)
    if name == "VERDICT_FLOOR_M":
        defaults["floor"] = value
    try:
        yield
    finally:
        for module, old in zip(modules, kept, strict=True):
            setattr(module, name, old)
        defaults["floor"] = floor


def counts(results: list[Result]) -> tuple[int, int, int, int]:
    """Probes, numbers stated, numbers whose interval does not hold the truth, refusals."""
    stated = sum(result.stated for result in results)
    return len(results), stated, len(ground_truth.outside(results)), len(results) - stated


def per_sheet(drawn: list[Drawn], uncalibrated: list[Result], calibrated: list[Result]) -> list[str]:
    lines = [
        "| sheet | probes | numbers, no calibration | of them outside | numbers, calibrated | of them outside |",
        "|---|---|---|---|---|---|",
    ]
    for name in [item.truth.name for item in drawn] + ["ALL"]:
        mine = [[r for r in results if name in ("ALL", r.sheet)] for results in (uncalibrated, calibrated)]
        (total, stated, wrong, _), (_, stated_c, wrong_c, _) = counts(mine[0]), counts(mine[1])
        lines.append(f"| {name} | {total} | {stated} | {wrong} | {stated_c} | {wrong_c} |")
    return lines


def per_operation(uncalibrated: list[Result], calibrated: list[Result]) -> list[str]:
    lines = ["| operation | probes | numbers, no calibration | numbers, calibrated |", "|---|---|---|---|"]
    for operation in ("clearance", "distance", "path", "area"):
        mine = [[r for r in results if r.probe.operation == operation] for results in (uncalibrated, calibrated)]
        lines.append(f"| {operation} | {len(mine[0])} | {counts(mine[0])[1]} | {counts(mine[1])[1]} |")
    return lines


def refusals(uncalibrated: list[Result], calibrated: list[Result]) -> list[str]:
    first, second = (Counter(r.refusal for r in results if not r.stated) for results in (uncalibrated, calibrated))
    lines = ["| why no number | no calibration | calibrated |", "|---|---|---|"]
    for reason in sorted(first | second, key=lambda reason: -(first[reason] + second[reason])):
        lines.append(f"| {reason} | {first[reason]} | {second[reason]} |")
    return lines


def distribution(results: list[Result]) -> list[str]:
    """How far stated values lie from the truth, as a share of the half interval stated, by provenance."""
    lines = ["| provenance | numbers | " + " | ".join(label for _, label in BUCKETS) + " | over 1 | worst |"]
    lines.append("|---|" + "---|" * (len(BUCKETS) + 3))
    by: dict[str, list[float]] = {}
    for result in results:
        if result.share_of_interval is not None:
            by.setdefault(result.answer.provenance, []).append(result.share_of_interval)
    for provenance, shares in sorted(by.items()):
        cells, below = [], -1.0
        for limit, _ in BUCKETS:
            cells.append(sum(1 for share in shares if below < round(share, 6) <= limit))
            below = limit
        over = sum(1 for share in shares if round(share, 6) > 1.0)
        listed = " | ".join(str(cell) for cell in cells)
        lines.append(f"| {provenance} | {len(shares)} | {listed} | {over} | {max(shares):.3f} |")
    return lines


def verdict_counts(drawn: list[Drawn]) -> tuple[int, int, int]:
    """With a correct calibration: thresholds asked of a stated number, verdicts given, verdicts that are wrong."""
    rows = [row for item in drawn for row in ground_truth.verdicts(item, item.probes(), item.calibrations())]
    given = sum(1 for _, _, answer in rows if answer.outcome.verdict != "undecidable")
    return len(rows), given, sum(1 for row in rows if ground_truth.wrong_verdict(*row))


def by_hand(drawn: list[Drawn]) -> list[str]:
    """The gate with every point moved further than the set moves it, a correct calibration passed."""
    lines = ["| every point moved by up to | probes | numbers | of them outside |", "|---|---|---|---|"]
    for radius in HAND_PT:
        results = [
            result
            for seed in HAND_SEEDS
            for item in drawn
            for result in ground_truth.run([item], True, jittered(item.truth, radius, HAND_COPIES, seed))
        ]
        total, stated, wrong, _ = counts(results)
        lines.append(f"| {radius:g} pt | {total} | {stated} | {wrong} |")
    return lines


def sensitivity(drawn: list[Drawn]) -> list[str]:
    lines = [
        "| constant | value | numbers, no calibration | outside | refused | numbers, calibrated | outside | refused "
        "| verdicts given (calibrated) | wrong verdicts |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for name, modules, low, high in CONSTANTS:
        own = getattr(modules[0], name)
        for value in (low, own, high):
            with constant(name, modules, value):
                fresh = [item.fresh() for item in drawn]
                _, stated, wrong, refused = counts(ground_truth.run(fresh, calibrated=False))
                _, stated_c, wrong_c, refused_c = counts(ground_truth.run(fresh, calibrated=True))
                _, given, wrong_verdicts = verdict_counts(fresh)
            mark = " (as built)" if value == own else ""
            lines.append(
                f"| {name} | {value:g}{mark} | {stated} | {wrong} | {refused} | {stated_c} | {wrong_c} | {refused_c} "
                f"| {given} | {wrong_verdicts} |"
            )
    return lines


def main() -> None:
    drawn = ground_truth.read_set()
    uncalibrated = ground_truth.run(drawn, calibrated=False)
    calibrated = ground_truth.run(drawn, calibrated=True)
    asked, given, wrong = verdict_counts(drawn)
    sections = [
        ("Numbers stated and the release gate, by sheet", per_sheet(drawn, uncalibrated, calibrated)),
        ("By operation", per_operation(uncalibrated, calibrated)),
        ("Why no number was stated", refusals(uncalibrated, calibrated)),
        ("|measured - true| over the half interval stated, no calibration", distribution(uncalibrated)),
        ("|measured - true| over the half interval stated, calibrated", distribution(calibrated)),
        (
            "Verdicts with a correct calibration",
            [f"{asked} thresholds asked of a stated number, {given} verdicts given, {wrong} of them wrong."],
        ),
        ("A less steady hand than the set's (calibrated)", by_hand(drawn)),
        ("The constants at half, as built, and double", sensitivity(drawn)),
    ]
    print(f"# Ground-truth set: {len(drawn)} sheets, {len(uncalibrated)} probes asked twice\n")
    for title, lines in sections:
        print(f"## {title}\n")
        print("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
