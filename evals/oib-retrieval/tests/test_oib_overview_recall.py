import json
import time
from pathlib import Path

import pytest
from oib_retrieval import overview

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
GOLDEN_PATH = FIXTURES / "oib_golden_overview.json"
CLAUSE_INDEX_PATH = FIXTURES / "clause_index.json"

BASELINE = {
    "overview": {"recall": 0.150, "mrr": 0.200, "empty": 0.80},
    "exact-id": {"recall": 0.700, "mrr": 0.367, "empty": 0.20},
    "paraphrase": {"recall": 1.000, "mrr": 0.553, "empty": 0.00},
}


@pytest.fixture(scope="module")
def entries() -> list[overview.GoldenEntry]:
    return overview.load_golden(GOLDEN_PATH, known_files=frozenset(overview.FIXTURE_TEXTS))


@pytest.fixture(scope="module")
def docs() -> list[overview.FixtureDoc]:
    return overview.fixture_docs()


@pytest.fixture(scope="module")
def index(docs):
    return overview.build_index(docs)


@pytest.fixture(scope="module")
def report(entries) -> overview.Report:
    started = time.perf_counter()
    result = overview.run(entries)
    result_elapsed = time.perf_counter() - started
    print("\n" + overview.format_report(result))
    print(f"\n(harness ran {len(result.results)} queries in {result_elapsed:.1f}s)")
    assert result_elapsed < 60, f"harness budget is 60s, took {result_elapsed:.1f}s"
    return result


def _cohort(report: overview.Report, label: str) -> overview.CohortScores:
    return next(scores for scores in report.cohorts if scores.label == label)


def _diff(report: overview.Report) -> str:
    return "\n" + overview.format_report(report)




def test_the_golden_set_has_thirty_entries_ten_per_cohort(entries):
    by_cohort: dict[str, int] = {}
    for entry in entries:
        by_cohort[entry.cohort] = by_cohort.get(entry.cohort, 0) + 1
    assert len(entries) == 30
    assert by_cohort == {"overview": 10, "exact-id": 10, "paraphrase": 10}


def test_every_expected_file_is_a_real_oib_corpus_name(entries):
    from agent.common.norm_registry import oib_doc_class

    fixture_files = set(overview.FIXTURE_TEXTS)
    assert len(fixture_files) == 39, "fixture must cover all 39 data/oib files"
    for entry in entries:
        for name in entry.expected:
            assert name in fixture_files, entry.id
            assert oib_doc_class(name) is not None, f"{entry.id}: {name!r} is not an OIB-corpus name"


def test_the_normative_expected_files_resolve_against_the_clause_index(entries):
    payload = json.loads(CLAUSE_INDEX_PATH.read_text(encoding="utf-8"))
    indexed_files = {
        punkt["file_name"] for rl, punkte in payload.items() if rl != "_unresolved" for punkt in punkte.values()
    }
    assert len(indexed_files) == 12
    normative = {
        name
        for entry in entries
        for name in entry.expected
        if name.startswith("oib-rl_") and "begriff" not in name and "zitierte" not in name
    }
    assert normative, "the golden set must exercise the normative Richtlinien"
    assert normative <= indexed_files, normative - indexed_files


def test_no_expected_file_is_production_excluded(entries):
    excluded = overview.production_excluded()
    assert len(excluded) == 28, "production exclusion list changed shape — re-derive the baseline"
    for entry in entries:
        assert not (set(entry.expected) & excluded), entry.id


def test_the_loader_rejects_a_duplicate_id(tmp_path):
    payload = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    payload["entries"].append(dict(payload["entries"][0]))
    path = tmp_path / "dupe.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="duplicate"):
        overview.load_golden(path)


def test_the_loader_rejects_an_unknown_cohort_and_an_unknown_file(tmp_path):
    payload = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    payload["entries"][0]["cohort"] = "vibes"
    path = tmp_path / "cohort.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="cohort"):
        overview.load_golden(path)

    payload["entries"][0]["cohort"] = "overview"
    payload["entries"][0]["expected_files"] = ["oib-rl_99_ausgabe_mai_2023.pdf"]
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="not in the fixture corpus"):
        overview.load_golden(path, known_files=frozenset(overview.FIXTURE_TEXTS))


def test_the_loader_rejects_an_expected_file_production_filters_out(tmp_path):
    payload = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    payload["entries"][0]["expected_files"] = ["aenderungen_oib-rl_2_ausgabe_mai_2023.pdf"]
    path = tmp_path / "excluded.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="exclude_file_names"):
        overview.load_golden(
            path, known_files=frozenset(overview.FIXTURE_TEXTS) | {"aenderungen_oib-rl_2_ausgabe_mai_2023.pdf"}
        )




def test_the_broad_overview_query_reaches_neither_deterministic_channel(index):
    assert overview.sparse_terms_for(index, "was weißt du über die oib 2") == []
    assert (
        overview.exact_files_for(overview.exact_terms_for("was weißt du über die oib 2"), overview.fixture_docs()) == []
    )


def test_the_precise_rewrite_of_the_same_intent_fires(index):
    assert overview.exact_terms_for("OIB-Richtlinie 2") == ["OIB-Richtlinie 2"]
    assert overview.exact_terms_for("OIB-RL 2") == ["OIB-RL"]
    assert overview.sparse_terms_for(index, "Brandschutz im Wohnhaus") != []




def test_the_cutoff_is_production_top_k(report):
    assert report.k == 16, (
        f"cutoff is {report.k}, not 16: production retuned top_k, so every threshold below "
        "was derived at the wrong depth — re-derive BASELINE" + _diff(report)
    )


def test_overview_cohort_is_still_the_unsolved_cohort(report):
    scores = _cohort(report, "overview")
    assert scores.recall <= 0.20, _diff(report)
    assert scores.empty_share >= 0.70, _diff(report)


def test_the_exemplar_overview_query_still_does_not_retrieve(report):
    by_id = {result.entry.id: result for result in report.results}
    assert by_id["ov-rl2"].recall == 0.0, _diff(report)
    assert by_id["ov-rl2"].ranked == ()


def test_exact_id_cohort_recall_has_a_floor(report):
    scores = _cohort(report, "exact-id")
    assert scores.recall >= 0.60, _diff(report)
    assert scores.mrr >= 0.30, _diff(report)
    by_id = {result.entry.id: result for result in report.results}
    assert by_id["ex-filename-rl2"].recall == 0.0, _diff(report)
    assert by_id["ex-rl2"].recall == 1.0, _diff(report)


def test_paraphrase_cohort_recall_has_a_floor(report):
    scores = _cohort(report, "paraphrase")
    assert scores.recall >= 0.90, _diff(report)
    assert scores.mrr >= 0.45, _diff(report)




def test_the_vector_channel_is_recorded(report):
    recorded = overview.load_recorded_vector()
    assert recorded, "vector fixture missing — re-record with `task be:eval:record-vector`"
    assert recorded["model"] == "openai/text-embedding-3-large", (
        f"recorded with {recorded['model']!r}, which is not the deployed embedding model "
        "(deploy/compose/docker-compose.yaml) — re-record"
    )
    assert len(recorded["rankings"]) == len(report.results)
    assert recorded["corpus_fingerprint"]


def test_the_vector_channel_is_what_answers_the_overview_cohort(report):
    scores = _cohort(report, "overview")
    assert scores.vector_recall >= 0.85, _diff(report)
    assert scores.recall <= 0.20, _diff(report)
    assert _cohort(report, "all").vector_recall >= 0.90, _diff(report)


def test_the_oib_n_questions_must_not_share_one_ranking(report):
    siblings = [r for r in report.results if r.entry.id.startswith("ov-rl")]
    assert len(siblings) >= 5, "the sibling set is what makes this test work"

    ranked = [r.ranked for r in siblings if r.ranked]
    if len(ranked) > 1:
        assert len(set(ranked)) > 1, (
            "every 'oib N' question produced the SAME deterministic ranking — the channel "
            "returned the corpus rather than searching it" + _diff(report)
        )

    vector = [r.vector_ranked for r in siblings if r.vector_ranked]
    assert len(set(vector)) == len(vector), (
        "the vector channel returned identical rankings for different guidelines" + _diff(report)
    )


def test_overview_is_the_weakest_cohort(report):
    recalls = {scores.label: scores.recall for scores in report.cohorts if scores.label != "all"}
    assert recalls["overview"] < recalls["exact-id"], _diff(report)
    assert recalls["overview"] < recalls["paraphrase"], _diff(report)


def test_rankings_are_deterministic(entries, report):
    first = [result.ranked for result in report.results]
    second = [result.ranked for result in overview.run(entries).results]
    assert first == second
