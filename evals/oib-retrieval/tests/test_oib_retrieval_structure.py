import pytest
from oib_retrieval import corpus
from oib_retrieval import dense
from oib_retrieval import lexical
from oib_retrieval import structure
from oib_retrieval.qrels import ClauseIndex

pytest.importorskip("llama_index.core", reason="the chunking arms are llama-index Documents")

FILE_NAME = "oib-rl_9_ausgabe_mai_2023.pdf"
HEADER = "Österreichisches Institut für Bautechnik OIB-330.9-001/23 OIB-Richtlinie 9"
FOOTER = "OIB-Richtlinie 9 Ausgabe Mai 2023 Seite {page} von 2"


def _page(number: int, body: str) -> dict:
    return {"page_number": number, "text": f"{HEADER}\n{body.strip()}\n{FOOTER.format(page=number)}"}


@pytest.fixture(scope="module")
def synthetic_pages() -> list[dict]:
    page_one = """
0 Vorbemerkungen
Diese Richtlinie gilt für Gebäude.
1 Begriffsbestimmungen
Es gelten die Begriffsbestimmungen des Dokumentes.
2 Fluchtwege
2.1 Gehweglänge
2.1.1 Von jeder Stelle jedes Raumes muss in höchstens 40 m Gehweglänge ein direkter Ausgang
zu einem sicheren Ort des angrenzenden Geländes im Freien erreichbar sein.
2.1.2 Bei Wohnungen wird die Gehweglänge ab der Wohnungseingangstüre gemessen.
2.2 Breite
2.2.1 Hauptgänge müssen eine lichte Durchgangsbreite von mindestens 1,20 m aufweisen.
"""
    page_two = """
3 Brandabschnitte
3.1 Brandabschnitte in oberirdischen Geschoßen dürfen eine maximale Netto-Grundfläche von
1.600 m² nicht überschreiten.
3.2 Brandabschnitte in unterirdischen Geschoßen dürfen eine maximale Netto-Grundfläche von
800 m² nicht überschreiten.
Impressum
Medieninhaber und Herausgeber: OIB
"""
    return [_page(1, page_one), _page(2, page_two)]


@pytest.fixture(scope="module")
def synthetic_index() -> ClauseIndex:
    def entry(page: int, heading: str) -> dict:
        return {"file_name": FILE_NAME, "pages": [page], "heading": heading}

    return ClauseIndex(
        {
            "9": {
                "0": entry(1, "Vorbemerkungen"),
                "1": entry(1, "Begriffsbestimmungen"),
                "2": entry(1, "Fluchtwege"),
                "2.1": entry(1, "Gehweglänge"),
                "2.1.1": entry(1, "Von jeder Stelle jedes Raumes"),
                "2.1.2": entry(1, "Bei Wohnungen wird die Gehweglänge"),
                "2.2": entry(1, "Breite"),
                "2.2.1": entry(1, "Hauptgänge müssen eine lichte"),
                "3": entry(2, "Brandabschnitte"),
                "3.1": entry(2, "Brandabschnitte in oberirdischen"),
                "3.2": entry(2, "Brandabschnitte in unterirdischen"),
            },
            "_unresolved": {},
        }
    )




def test_every_indexed_clause_is_located_in_the_extracted_line_stream(synthetic_index, synthetic_pages):
    _results, located, _parents, unlocated = structure.measure_document(
        synthetic_index, "9", synthetic_pages, FILE_NAME, 1024
    )
    assert unlocated == []
    assert located == 11


def test_structural_parents_are_counted_from_the_index_and_excluded_from_the_leaves(synthetic_index, synthetic_pages):
    results, _located, parents, _unlocated = structure.measure_document(
        synthetic_index, "9", synthetic_pages, FILE_NAME, 1024
    )
    assert parents == 4
    assert results[corpus.ARM_PAGE].leaf_clauses == 7
    assert results[corpus.ARM_CLAUSE].leaf_clauses == 7


def test_page_chunking_blends_many_clauses_into_one_chunk_so_almost_none_is_citable(synthetic_index, synthetic_pages):
    results, _located, _parents, _unlocated = structure.measure_document(
        synthetic_index, "9", synthetic_pages, FILE_NAME, 1024
    )
    page_arm = results[corpus.ARM_PAGE]
    assert page_arm.contiguous == page_arm.leaf_clauses
    assert page_arm.isolated <= 1
    assert page_arm.clauses_per_chunk > 2.0


def test_clause_chunking_makes_almost_every_clause_its_own_citable_chunk(synthetic_index, synthetic_pages):
    results, _located, _parents, _unlocated = structure.measure_document(
        synthetic_index, "9", synthetic_pages, FILE_NAME, 1024
    )
    clause_arm = results[corpus.ARM_CLAUSE]
    assert clause_arm.isolated == clause_arm.leaf_clauses
    assert clause_arm.clauses_per_chunk == pytest.approx(1.0)
    assert clause_arm.isolated_pct == pytest.approx(100.0)


def test_the_clause_arm_is_strictly_better_on_the_citable_unit_property(synthetic_index, synthetic_pages):
    results, _located, _parents, _unlocated = structure.measure_document(
        synthetic_index, "9", synthetic_pages, FILE_NAME, 1024
    )
    assert results[corpus.ARM_CLAUSE].isolated > results[corpus.ARM_PAGE].isolated


def test_text_after_the_imprint_is_not_absorbed_into_the_last_clause(synthetic_index, synthetic_pages):
    results, _located, _parents, _unlocated = structure.measure_document(
        synthetic_index, "9", synthetic_pages, FILE_NAME, 1024
    )
    assert results[corpus.ARM_CLAUSE].contiguous == results[corpus.ARM_CLAUSE].leaf_clauses




def test_the_clause_arm_emits_more_and_smaller_chunks_than_the_page_arm(synthetic_pages):
    page_chunks = corpus._chunks_from_documents(
        corpus.page_documents(synthetic_pages, FILE_NAME, 1024), FILE_NAME, corpus.ARM_PAGE
    )
    clause_chunks = corpus._chunks_from_documents(
        corpus.clause_or_page_documents(synthetic_pages, FILE_NAME, 1024), FILE_NAME, corpus.ARM_CLAUSE
    )
    assert len(clause_chunks) > len(page_chunks)
    assert all(chunk.page > 0 for chunk in clause_chunks)
    assert {chunk.arm for chunk in clause_chunks} == {corpus.ARM_CLAUSE}


def test_ranked_chunks_collapse_to_distinct_units_keeping_the_first_occurrence():
    chunks = [
        corpus.Chunk(chunk_id="a", text="", file_name="x.pdf", page=5, arm="punkt"),
        corpus.Chunk(chunk_id="b", text="", file_name="x.pdf", page=5, arm="punkt"),
        corpus.Chunk(chunk_id="c", text="", file_name="x.pdf", page=6, arm="punkt"),
    ]
    assert corpus.dedupe_to_units(chunks) == [("x.pdf", 5), ("x.pdf", 6)]
    assert corpus.dedupe_to_units(chunks, limit=1) == [("x.pdf", 5)]


def test_the_production_exclusion_list_still_covers_every_change_log_pdf():
    excluded = corpus.production_excluded_file_names()
    corpus_dir = corpus.default_corpus_dir()
    if not any(corpus_dir.glob("*.pdf")):
        pytest.skip("no OIB corpus in this checkout — see data/oib/README.md")
    assert excluded, "production config declares no exclude_file_names — the Änderungen filter is gone"
    change_logs = {path.name for path in corpus_dir.glob("aenderungen_*.pdf")}
    assert change_logs, "no aenderungen_* files found — the forbidden-hit metric would measure nothing"
    assert change_logs <= excluded




@pytest.fixture(scope="module")
def lexical_corpus(synthetic_pages) -> lexical.LexicalIndex:
    chunks = corpus._chunks_from_documents(
        corpus.clause_or_page_documents(synthetic_pages, FILE_NAME, 1024), FILE_NAME, corpus.ARM_CLAUSE
    )
    return lexical.build_index(chunks)


def test_a_german_question_retrieves_the_clause_that_answers_it(lexical_corpus):
    hits = lexical.search(lexical_corpus, "Wie lang darf die Gehweglänge zum Ausgang sein?", 5)
    assert hits, "the German lexical channel must fire on a German question"
    assert any("40 m Gehweglänge" in hit.text for hit in hits)


def test_german_morphology_variants_of_one_need_reach_the_same_clause(lexical_corpus):
    first = lexical.search(lexical_corpus, "Gehweglänge", 3)
    second = lexical.search(lexical_corpus, "Gehweglängen", 3)
    assert first and second
    assert first[0].chunk_id == second[0].chunk_id


def test_the_lexical_channel_is_silent_for_an_english_question_by_construction(lexical_corpus):
    assert lexical.selected_terms(lexical_corpus, "What is the maximum escape route length?") == []
    assert lexical.search(lexical_corpus, "What is the maximum escape route length?", 5) == []


def test_the_tsquery_handed_to_postgres_ors_the_surviving_lexemes(lexical_corpus):
    query = lexical.tsquery_for(lexical_corpus, "Gehweglänge Ausgang")
    assert " | " in query
    assert query.count("'") % 2 == 0


def test_the_document_frequency_ceiling_is_not_applied_to_a_collection_this_small(lexical_corpus):
    from agent.common.german_text import DEFAULT_DF_CEILING_MIN_TOTAL
    from agent.common.german_text import select_terms

    assert lexical_corpus.total < DEFAULT_DF_CEILING_MIN_TOTAL
    assert lexical.search(lexical_corpus, "Richtlinie", 5) != []

    assert select_terms(["richtlini"], {"richtlini": 90}, 100, df_ceiling_ratio=0.2, min_total=1) == []
    assert select_terms(["gehweglang"], {"gehweglang": 3}, 100, df_ceiling_ratio=0.2, min_total=1) == ["gehweglang"]




def test_the_hashed_embedder_is_deterministic_and_unit_normalised():
    import numpy as np

    embedder = dense.HashedEmbedder()
    first = embedder.encode_documents(["Gehweglänge von höchstens 40 m"])
    second = embedder.encode_documents(["Gehweglänge von höchstens 40 m"])
    assert np.array_equal(first, second)
    assert float(np.linalg.norm(first[0])) == pytest.approx(1.0, abs=1e-6)


def test_the_dense_index_returns_the_requested_depth_in_descending_similarity(synthetic_pages):
    chunks = corpus._chunks_from_documents(
        corpus.clause_or_page_documents(synthetic_pages, FILE_NAME, 1024), FILE_NAME, corpus.ARM_CLAUSE
    )
    embedder = dense.HashedEmbedder()
    index = dense.build_dense_index(embedder, chunks)
    hits = index.search(embedder, "Brandabschnitte in unterirdischen Geschoßen", 3)
    assert len(hits) == 3
    assert "unterirdischen" in hits[0].text


def test_asking_for_an_unknown_embedder_is_an_error_not_a_silent_fallback():
    with pytest.raises(ValueError):
        dense.make_embedder("text-embedding-3-large")




def test_the_hybrid_path_runs_through_the_production_fusion_and_merge(synthetic_pages):
    from oib_retrieval import runner

    chunks = corpus._chunks_from_documents(
        corpus.clause_or_page_documents(synthetic_pages, FILE_NAME, 1024), FILE_NAME, corpus.ARM_CLAUSE
    )
    embedder = dense.HashedEmbedder()
    dense_index = dense.build_dense_index(embedder, chunks)
    lexical_index = lexical.build_index(chunks)
    question = "Wie lang darf die Gehweglänge zum Ausgang sein?"

    fused = runner._hybrid(
        dense_index.search(embedder, question, 10),
        lexical.search(lexical_index, question, 10),
        10,
    )
    assert fused, "fusion must not swallow both channels"
    assert len(fused) == len(set(fused)), "the fused ranking must be distinct units"
    assert all(isinstance(unit[1], int) and unit[1] > 0 for unit in fused)


def test_the_production_diversity_cap_limits_pages_taken_from_one_document(synthetic_pages):
    from oib_retrieval import runner

    chunks = corpus._chunks_from_documents(
        corpus.clause_or_page_documents(synthetic_pages, FILE_NAME, 1024), FILE_NAME, corpus.ARM_CLAUSE
    )
    embedder = dense.HashedEmbedder()
    dense_index = dense.build_dense_index(embedder, chunks)
    settings = corpus.production_retrieval_settings()
    cap = settings.max_chunks_per_document
    hits = dense_index.search(embedder, "Brandabschnitte", 20)
    fused = runner._hybrid(hits, [], 20, max_per_document=cap)
    assert 0 < len(fused) <= 20
    assert len(hits) > cap, "the fixture must offer more chunks than the cap, or this proves nothing"
    first_pass = fused[:cap]
    assert all(unit[0] == FILE_NAME for unit in first_pass)
    assert len({unit[1] for unit in first_pass}) == len(first_pass), "the cap must not repeat a page"




def test_a_numbered_table_derails_clause_chunking_and_the_metric_shows_it():
    body_one = """
1 Allgemeines
Diese Richtlinie gilt für Gebäude.
2 Anforderungen
2.1 Beim Neubau dürfen folgende Wärmedurchgangskoeffizienten nicht überschritten werden:
1 WÄNDE gegen Außenluft 0,35
2 WÄNDE gegen unbeheizte Dachräume 0,35
3 WÄNDE erdberührt 0,40
4 FENSTER gegen Außenluft 1,40
5 TÜREN gegen Außenluft 1,70
"""
    body_two = """
2.2 Sommerlicher Wärmeschutz ist beim Neubau von Wohngebäuden einzuhalten.
2.3 Die Luftdichtheit der Gebäudehülle ist nachzuweisen.
"""
    pages = [_page(1, body_one), _page(2, body_two)]
    index = ClauseIndex(
        {
            "6": {
                "1": {"file_name": FILE_NAME, "pages": [1], "heading": "Allgemeines"},
                "2": {"file_name": FILE_NAME, "pages": [1], "heading": "Anforderungen"},
                "2.1": {"file_name": FILE_NAME, "pages": [1], "heading": "Beim Neubau"},
                "2.2": {"file_name": FILE_NAME, "pages": [2], "heading": "Sommerlicher Wärmeschutz"},
                "2.3": {"file_name": FILE_NAME, "pages": [2], "heading": "Die Luftdichtheit"},
            },
            "_unresolved": {},
        }
    )
    results, located, _parents, unlocated = structure.measure_document(index, "6", pages, FILE_NAME, 1024)

    assert located == 5
    assert unlocated == []
    clause_arm = results[corpus.ARM_CLAUSE]
    assert clause_arm.isolated < clause_arm.leaf_clauses
