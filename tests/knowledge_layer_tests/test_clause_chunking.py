from __future__ import annotations

import pytest
from knowledge_layer.ingest import clause_documents
from knowledge_layer.ingest import guideline_key


def _pages(*texts: str) -> list[dict]:
    return [{"page_number": index, "text": text} for index, text in enumerate(texts, start=1)]


COVER = "OIB-Richtlinie 2\nBrandschutz\n"

BODY = (
    "1 Begriffsbestimmungen gelten sinngemaess fuer diese Richtlinie.\n"
    "2 Allgemeine Anforderungen an das Brandverhalten von Bauprodukten.\n"
    "2.1 Bauprodukte muessen den Anforderungen der Tabelle 1a entsprechen.\n"
    "2.2 Die Bauteile muessen den erforderlichen Anforderungen genuegen.\n"
)

MORE = (
    "2.3 Oeffnungen in brandabschnittsbildenden Bauteilen sind zulaessig.\n"
    "3 Flucht- und Rettungswege muessen ins Freie fuehren.\n"
    "3.1 Die nutzbare Breite von Fluchtwegen muss mindestens 1,20 m betragen.\n"
)


def _clauses(docs: list) -> dict[str, object]:
    return {doc.metadata["clause_id"]: doc for doc in docs if doc.metadata.get("chunking") == "clause"}


def test_each_numbered_requirement_becomes_its_own_document() -> None:
    docs = clause_documents(_pages(COVER, BODY, MORE), "oib-rl_2_ausgabe_mai_2023.pdf", 1234)
    assert docs is not None
    assert sorted(_clauses(docs)) == ["1", "2", "2.1", "2.2", "2.3", "3", "3.1"]


def test_a_table_row_label_is_rejected_by_outline_succession() -> None:
    table = "1.1 Aussenwand-Waermedaemmverbundsysteme E D D C-d1 C-d1\n"
    docs = clause_documents(_pages(COVER, BODY, table + MORE), "oib-rl_2_ausgabe_mai_2023.pdf", 1234)
    assert docs is not None
    assert "1.1" not in _clauses(docs)


def test_a_wrapped_measurement_line_does_not_park_the_cursor_at_thirty() -> None:
    wrapped = "30 cm und einer Hoehe von 20 cm ausgefuehrt werden.\n"
    docs = clause_documents(_pages(COVER, BODY, wrapped + MORE), "oib-rl_2_ausgabe_mai_2023.pdf", 1234)
    assert docs is not None
    clauses = _clauses(docs)
    assert "30" not in clauses
    assert "3.1" in clauses, "the Punkte after the wrapped line must survive"


def test_a_requirement_split_across_a_page_break_is_joined() -> None:
    head = "2.2 Die Bauteile muessen den erforderlichen\n"
    tail = "Anforderungen der Tabelle 1b genuegen.\n"
    docs = clause_documents(
        _pages(
            COVER,
            BODY.replace("2.2 Die Bauteile muessen den erforderlichen Anforderungen genuegen.\n", head),
            tail + MORE,
        ),
        "oib-rl_2.pdf",
        1,
    )
    assert docs is not None
    doc = _clauses(docs)["2.2"]
    assert "Tabelle 1b" in doc.get_content()
    assert doc.metadata["page_label"] == "2", "citation anchors on the page the Punkt starts"
    assert doc.metadata["page_end"] == "3"


def test_a_line_break_hyphen_is_healed() -> None:
    hyphenated = "2.2 Die Bauteile muessen unterstuet-\nzenden Anforderungen genuegen.\n"
    body = BODY.replace("2.2 Die Bauteile muessen den erforderlichen Anforderungen genuegen.\n", hyphenated)
    docs = clause_documents(_pages(COVER, body, MORE), "oib-rl_2.pdf", 1)
    assert docs is not None
    assert "unterstuetzenden" in _clauses(docs)["2.2"].get_content()


def test_each_document_carries_its_place_in_the_outline() -> None:
    docs = clause_documents(_pages(COVER, BODY, MORE), "oib-rl_2_ausgabe_mai_2023.pdf", 1234)
    assert docs is not None
    child = _clauses(docs)["2.1"]
    assert child.metadata["clause_parent_id"] == "2"
    assert child.metadata["clause_depth"] == 2
    assert child.metadata["guideline"] == "2"
    assert "Brandverhalten" in child.get_content()


def test_text_before_the_first_requirement_is_kept_as_a_page_document() -> None:
    docs = clause_documents(_pages(COVER, BODY, MORE), "oib-rl_2.pdf", 1)
    assert docs is not None
    assert any(doc.metadata.get("chunking") == "page" for doc in docs)


def test_a_document_without_usable_numbering_falls_back_to_none() -> None:
    prose = "Ein Absatz ohne jede Nummerierung.\nNoch ein Absatz.\n"
    assert clause_documents(_pages(prose, prose), "glossar.pdf", 1) is None


def test_a_document_whose_numbering_covers_too_little_falls_back() -> None:
    sparse = "1 Eine einzige Ueberschrift.\n" + ("Sehr viel unnummerierter Fliesstext. " * 80) + "\n"
    assert clause_documents(_pages(sparse), "sparse.pdf", 1) is None


def test_bookkeeping_metadata_is_not_embedded() -> None:
    docs = clause_documents(_pages(COVER, BODY, MORE), "oib-rl_2.pdf", 1)
    assert docs is not None
    excluded = set(docs[-1].excluded_embed_metadata_keys or [])
    assert {"page_end", "clause_depth", "chunking", "file_size"} <= excluded
    assert "clause_id" not in excluded, "the Punkt number is exactly what a user cites"


def test_an_empty_document_does_not_raise() -> None:
    assert clause_documents([], "empty.pdf", 0) is None
    assert clause_documents(_pages("", ""), "empty.pdf", 0) is None


OUTLINE = (
    "0 Vorbemerkungen zu dieser Richtlinie sind zu beachten.\n"
    "1 Allgemeine Bestimmungen gelten fuer alle Gebaeude.\n"
    "2 Begriffsbestimmungen sind der Richtlinie zu entnehmen.\n"
    "3 Gebaeudekategorien werden wie folgt unterschieden.\n"
    "4 Anforderungen an das Gebaeude sind einzuhalten.\n"
    "4.1 Allgemeines zur Nachweisfuehrung des Gebaeudes.\n"
)

UWERT_TABLE = (
    "5 WAENDE (Trennwaende) zwischen Wohneinheiten 0,90\n"
    "6 WAENDE gegen andere Bauwerke 0,50\n"
    "7 WAENDE (Zwischenwaende) innerhalb von Einheiten 0,70\n"
)

OUTLINE_TAIL = (
    "4.2 Niedrigstenergiegebaeude sind nachzuweisen.\n"
    "4.3 Anforderungen an Energiekennzahlen bei Neubau.\n"
    "5 Wahl der eingesetzten Energietraeger ist zu begruenden.\n"
    "5.1 Einsatz hocheffizienter alternativer Energiesysteme.\n"
    "6 Ausweis ueber die Gesamtenergieeffizienz ist auszustellen.\n"
)


def test_a_table_whose_rows_continue_the_outline_does_not_swallow_the_rest() -> None:
    docs = clause_documents(_pages(COVER, OUTLINE, UWERT_TABLE + OUTLINE_TAIL), "oib-rl_6.pdf", 1)
    assert docs is not None
    clauses = _clauses(docs)
    assert "7" not in clauses, "a table row is not a Punkt"
    assert sorted(clauses) == ["0", "1", "2", "3", "4", "4.1", "4.2", "4.3", "5", "5.1", "6"]
    assert "Energietraeger" in clauses["5"].get_content(), "Punkt 5 is the outline's, not the table's"


def test_the_contents_page_settles_which_line_is_the_heading_it_names() -> None:
    toc = (
        "0 Vorbemerkungen ......... 1\n"
        "1 Allgemeine Bestimmungen ......... 1\n"
        "2 Begriffsbestimmungen ......... 2\n"
        "3 Gebaeudekategorien ......... 2\n"
        "4 Anforderungen an das Gebaeude ......... 3\n"
        "5 Wahl der eingesetzten Energietraeger ......... 4\n"
        "6 Ausweis ueber die Gesamtenergieeffizienz ......... 5\n"
    )
    docs = clause_documents(_pages(COVER, toc, OUTLINE, UWERT_TABLE + OUTLINE_TAIL), "oib-rl_6.pdf", 1)
    assert docs is not None
    clauses = _clauses(docs)
    assert "Energietraeger" in clauses["5"].get_content()
    assert "WAENDE" not in clauses["5"].get_content()


def test_a_contents_page_that_names_only_the_top_level_still_keeps_the_rest() -> None:
    toc = (
        "0 Vorbemerkungen ......... 1\n"
        "1 Allgemeine Bestimmungen ......... 1\n"
        "2 Begriffsbestimmungen ......... 2\n"
        "3 Gebaeudekategorien ......... 2\n"
        "4 Anforderungen an das Gebaeude ......... 3\n"
    )
    docs = clause_documents(_pages(COVER, toc, OUTLINE, OUTLINE_TAIL), "oib-rl_6.pdf", 1)
    assert docs is not None
    clauses = _clauses(docs)
    assert "4.1" in clauses and "5.1" in clauses, "unlisted Punkte are kept, not filtered out"


def test_an_abbreviation_legend_is_not_a_contents_page() -> None:
    legend = (
        "KD ...... Kellerdecke\n"
        "OD ..... Oberste Geschossdecke\n"
        "AW ..... Aussenwand\n"
        "DF ...... Dachflaeche aus Beton\n"
        "4.2 Niedrigstenergiegebaeude sind nachzuweisen.\n"
    )
    docs = clause_documents(
        _pages(COVER, OUTLINE, legend, OUTLINE_TAIL[len("4.2 Niedrigstenergiegebaeude sind nachzuweisen.\n") :]),
        "oib-rl_6.pdf",
        1,
    )
    assert docs is not None
    assert "4.2" in _clauses(docs), "the legend page is body text and keeps its Punkte"


def test_a_heading_the_corpus_opens_in_lowercase_is_still_a_heading() -> None:
    body = OUTLINE + "4.1.1 kein ENERGIEAUSWEIS erforderlich / keine ANFORDERUNGEN\n"
    docs = clause_documents(_pages(COVER, body, OUTLINE_TAIL), "oib-rl_6.pdf", 1)
    assert docs is not None
    clauses = _clauses(docs)
    assert "4.1.1" in clauses
    assert "ENERGIEAUSWEIS" in clauses["4.1.1"].get_content()
    assert "ENERGIEAUSWEIS" not in clauses["4.1"].get_content(), "it was merged into the Punkt above"


def test_every_chunk_opens_with_the_clause_it_claims_to_be() -> None:
    docs = clause_documents(_pages(COVER, OUTLINE, UWERT_TABLE + OUTLINE_TAIL), "oib-rl_6.pdf", 1)
    assert docs is not None
    clauses = _clauses(docs)
    assert clauses
    for clause_id, doc in clauses.items():
        body = doc.get_content().split("\n\n", 1)[-1].lstrip()
        assert body.startswith(f"{clause_id} "), f"chunk {clause_id} does not open with its own number"


def test_ingestion_cuts_a_numbered_document_on_its_outline() -> None:
    from knowledge_layer.ingest import text_documents_for_pages

    docs = text_documents_for_pages(_pages(COVER, BODY, MORE), "oib-rl_2_ausgabe_mai_2023.pdf", 1234)
    assert {doc.metadata.get("chunking") for doc in docs} == {"clause", "page"}
    assert any(doc.metadata.get("clause_id") == "2.1" for doc in docs)


def test_ingestion_falls_back_to_one_document_per_page_for_everything_else() -> None:
    from knowledge_layer.ingest import text_documents_for_pages

    prose = _pages("Ein Angebot ohne Nummerierung.", "Noch eine Seite Fliesstext.")
    docs = text_documents_for_pages(prose, "angebot.pdf", 99)
    assert len(docs) == 2
    assert [doc.metadata["page_label"] for doc in docs] == ["1", "2"]
    assert all(doc.metadata["content_type"] == "text" for doc in docs)
    assert all("clause_id" not in doc.metadata for doc in docs)


def test_the_chunker_works_under_the_deployed_import_path() -> None:
    import subprocess
    import sys

    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from knowledge_layer.ingest.clause_chunking import clause_documents;"
            "from knowledge_layer.ingest.chunk_metadata import apply_metadata_exclusions;"
            "print('ok')",
        ],
        capture_output=True,
        check=False,
        text=True,
        env={"PATH": "/usr/bin:/bin", "PYTHONPATH": "src"},
        cwd=str(__import__("pathlib").Path(__file__).resolve().parents[2]),
    )
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    ("file_name", "key"),
    [
        ("oib-rl_2.1_ausgabe_mai_2023.pdf", "2.1"),
        ("oib-rl_2_leitfaden_ausgabe_mai_2023.pdf", "2-leitfaden"),
        ("oib-richtlinie_2.2_ausgabe_mai_2023.pdf", "2.2"),
    ],
)
def test_the_guideline_key_reads_every_published_spelling(file_name: str, key: str) -> None:
    assert guideline_key(file_name) == key
