from __future__ import annotations

import os
from pathlib import Path

import pytest
from oib_retrieval.qdrant_parity import runner
from oib_retrieval.qdrant_parity import sample

REPO = Path(__file__).resolve().parents[3]
HARD_CASES = REPO / "evals" / "oib-retrieval" / "fixtures" / "qdrant_lexical_hard_cases.json"


def _server_url() -> str:
    url = os.environ.get("QDRANT_TEST_URL", "").strip()
    if url:
        return url
    if os.environ.get("CI"):
        pytest.fail("QDRANT_TEST_URL is unset on CI: the Qdrant service container is missing")
    pytest.skip("QDRANT_TEST_URL not set; start a Qdrant 1.19 server to run these")


@pytest.fixture(scope="module")
def report():
    return runner.run(sample.inputs(HARD_CASES), qdrant_url=_server_url(), rounds=1, variant_names="all")


def test_the_store_holds_every_chunk(report):
    assert report["corpus"]["qdrant_count"] == len(sample.TEXTS)


def test_find_text_returns_what_a_full_regex_scan_returns_for_every_phrase(report):
    differing = [row["phrase"] for row in report["exact"] if not row["identical"]]
    assert differing == []
    assert all(row["regex_scan"] for row in report["exact"] if row["phrase"] in ("REI 90", "Geschoss"))


def test_the_retriever_answers_from_the_store_without_embedding_and_honours_the_base_filter(report):
    golden = report["hybrid"]["golden_all"]
    assert golden["queries"] and golden["recall"]["60"] > 0
    assert report["hybrid"]["latency_ms"]["n"] > 0


def test_the_phrase_index_keeps_numbers_and_codes(report):
    rows = {row["phrase"]: row for row in report["exact"]}
    for phrase in ("REI 90", "5.1.1", "§ 8", "EI2 30-C"):
        assert rows[phrase]["phrase_index_misses"] == 0, phrase
        assert rows[phrase]["phrase_index_extra"] == 0, phrase


def test_every_gate_has_a_verdict_and_the_unmeasurable_ones_say_so(report):
    gates = {verdict["gate"]: verdict["status"] for verdict in report["verdicts"]}
    assert {"G1b lexical", "G2 latency", "G1 answer quality"} <= set(gates)
    assert gates["G1 answer quality"] == "not measured"
    assert gates["G6 dimension"] == "not measured", "64-d sample vectors cannot speak for 3072-d"


def test_the_report_renders(report):
    markdown = runner.render_markdown(report)
    assert "| G2 latency |" in markdown and "qdrant_bm25" in markdown


def test_the_ranking_sweep_measures_every_variant_against_the_baseline(report):
    from oib_retrieval.qdrant_parity import decompound
    from oib_retrieval.qdrant_parity import variants

    sweep = report["variants"]
    catalogue = variants.catalogue()
    ordinary = [name for name, setting in catalogue.items() if not isinstance(setting, decompound.Variant)]
    split = [name for name in catalogue if name not in ordinary] if decompound.available() else []
    assert list(sweep) == [*ordinary, variants.REPEAT, *split]
    assert "diff" not in sweep[variants.BASELINE]
    assert all("diff" in result for name, result in sweep.items() if name != variants.BASELINE)
    assert "## Ranking sweep" in runner.render_markdown(report)


def test_every_variant_serves_the_true_cosine_as_the_score(report):
    errors = {name: result["cosine_error"]["max"] for name, result in report["variants"].items()}
    assert all(error < 1e-4 for error in errors.values()), errors
