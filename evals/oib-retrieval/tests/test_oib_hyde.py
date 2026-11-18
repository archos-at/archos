import importlib.util
from pathlib import Path

import pytest
from oib_retrieval import overview

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
GOLDEN_PATH = FIXTURES / "oib_golden_overview.json"


def _overview_recall_baseline() -> dict[str, dict[str, float]]:
    spec = importlib.util.spec_from_file_location(
        "oib_overview_recall_baseline", Path(__file__).with_name("test_oib_overview_recall.py")
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.BASELINE


HYDE_FIRE_SET = frozenset(
    {
        "ov-cross-rl",
        "ov-which-wohngebaeude",
        "ov-begriffe",
        "ex-begriffe-gebaeudeklasse",
        "pa-brandschutz-wohnhaus",
        "pa-fluchtweg-laenge",
        "pa-fluchtweg-breite",
        "pa-zweiter-fluchtweg",
        "pa-tragwerk",
        "pa-trinkwasser",
        "pa-barrierefrei-tuer",
        "pa-schallschutz",
        "pa-u-wert",
    }
)


@pytest.fixture(scope="module")
def entries() -> list[overview.GoldenEntry]:
    return overview.load_golden(GOLDEN_PATH, known_files=frozenset(overview.FIXTURE_TEXTS))


@pytest.fixture(scope="module")
def off_report(entries) -> overview.Report:
    return overview.run(entries)


@pytest.fixture(scope="module")
def no_draft_report(entries) -> overview.Report:
    return overview.run(entries, hyde_drafter=lambda entry: None)


def _cohort(report: overview.Report, label: str) -> overview.CohortScores:
    return next(scores for scores in report.cohorts if scores.label == label)


def _cohort_table(report: overview.Report) -> dict[str, tuple[float, float, float]]:
    return {scores.label: (scores.recall, scores.mrr, scores.empty_share) for scores in report.cohorts}


def _ranked_table(report: overview.Report) -> dict[str, tuple[str, ...]]:
    return {result.entry.id: result.ranked for result in report.results}


def test_hyde_gate_fires_only_for_identifier_free_queries(entries) -> None:
    called: list[str] = []

    def recording_drafter(entry: overview.GoldenEntry) -> str | None:
        called.append(entry.id)
        return None

    overview.run(entries, hyde_drafter=recording_drafter)
    assert set(called) == HYDE_FIRE_SET
    assert len(called) == len(HYDE_FIRE_SET)  # once each, no repeats


def test_hyde_gate_keeps_identifier_shaped_overview_queries_out(entries) -> None:
    assert overview.hyde_fires("was weißt du über die oib 2") is False
    assert overview.hyde_fires("fasse die oib 4 kurz zusammen") is False
    assert overview.hyde_fires("was weißt du über die oib-richtlinien") is True


def test_hyde_on_without_drafts_is_the_baseline(off_report, no_draft_report) -> None:
    off, on = off_report, no_draft_report
    assert _ranked_table(on) == _ranked_table(off)
    assert _cohort_table(on) == _cohort_table(off)
    assert all(not result.hyde_fired for result in on.results)


def test_hyde_drafter_errors_degrade_to_the_baseline(entries, off_report) -> None:

    def failing_drafter(entry: overview.GoldenEntry) -> str | None:
        raise RuntimeError("draft model down")

    off = off_report
    on = overview.run(entries, hyde_drafter=failing_drafter)
    assert _ranked_table(on) == _ranked_table(off)
    assert _cohort_table(on) == _cohort_table(off)


def test_hyde_on_without_drafts_matches_the_pinned_baseline(no_draft_report) -> None:
    report = no_draft_report
    BASELINE = _overview_recall_baseline()

    for cohort, expected in BASELINE.items():
        assert _cohort(report, cohort).recall == pytest.approx(expected["recall"], abs=5e-4), cohort


def test_fusion_keeps_the_original_channel_first() -> None:
    assert overview.fuse_file_channels([["a", "b"], ["b", "c"]]) == ["b", "a", "c"]
    assert overview.fuse_file_channels([["x"], ["x"]]) == ["x"]
    assert overview.fuse_file_channels([[], []]) == []
    assert overview.fuse_file_channels([]) == []


def test_fused_empty_query_stays_empty(entries) -> None:
    report = overview.run(entries, hyde_drafter=lambda entry: entry.question)
    by_id = {result.entry.id: result for result in report.results}
    assert by_id["ov-cross-rl"].ranked == ()
    assert by_id["ov-cross-rl"].recall == 0.0
    assert by_id["ov-cross-rl"].hyde_fired is True


def test_draft_text_never_leaks_into_the_report(entries) -> None:
    canary = "HYDE-CANARY-9137-nichtexistierend"

    def canary_drafter(entry: overview.GoldenEntry) -> str | None:
        return f"{entry.question} {canary}"

    report = overview.run(entries, hyde_drafter=canary_drafter)
    assert canary not in overview.format_report(report)
    for result in report.results:
        assert all(name.endswith(".pdf") for name in result.ranked)
