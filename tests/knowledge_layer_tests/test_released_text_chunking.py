from __future__ import annotations

import ast
from pathlib import Path

from knowledge_layer import ingest
from knowledge_layer.ingest import clause_documents
from knowledge_layer.ingest import is_released_text
from knowledge_layer.ingest import text_documents_for_pages

RELEASED = "guideline-2-2023-text-80c174ce27a0.pdf"

CONTENTS = (
    "Inhaltsverzeichnis\n"
    "0 Vorbemerkungen ....................................... 2\n"
    "1 Begriffsbestimmungen .................................. 2\n"
    "2 Allgemeine Anforderungen .............................. 2\n"
    "3 Flucht- und Rettungswege .............................. 3\n"
    "4 Brandbekaempfung ...................................... 4\n"
    "Anhang .................................................. 5\n"
)
BODY = (
    "0 Vorbemerkungen\n"
    "Die zitierten Normen gelten in der jeweils genannten Fassung.\n"
    "1 Begriffsbestimmungen\n"
    "Es gelten die Begriffsbestimmungen des Dokuments.\n"
    "2 Allgemeine Anforderungen\n"
    "2.1 Bauprodukte muessen den Anforderungen entsprechen.\n"
    "Richtlinie 2 Ausgabe September 2025 Seite 2 von 5\n"
)
ESCAPE = (
    "3 Flucht- und Rettungswege\n"
    "3.1 Fluchtwege\n"
    "3.1.1 Von jeder Stelle jedes Raumes muss in hoechstens 40 m Gehweglaenge ein Ausgang erreichbar sein.\n"
    "3.1.2 Bei Wohnungen wird abweichend von Punkt 3.1.1 eine groessere Laenge zugelassen.\n"
    "3.1.3 Zwischen Treppenhaeusern und Gaengen sind Tueren gemaess Tabelle 2 anzuordnen.\n"
    "3.1.4 Im Falle von Punkt 3.1.1 c) muss in jedem Geschoss ein zweiter Fluchtweg bestehen.\n"
    "Richtlinie 2 Ausgabe September 2025 Seite 3 von 5\n"
)
FIGHTING = (
    "4 Brandbekaempfung\n"
    "4.1 Gebaeude muessen fuer die Feuerwehr zugaenglich sein.\n"
    "Richtlinie 2 Ausgabe September 2025 Seite 4 von 5\n"
)
ANNEX = (
    "Anhang\n"
    "Muster der Bescheinigung ueber die Pruefung der Brandmeldeanlage mit vielen Feldern.\n"
    "Name des Pruefers, Datum der Pruefung, Ergebnis der Pruefung, Unterschrift und Stempel.\n"
    "Richtlinie 2 Ausgabe September 2025 Seite 5 von 5\n"
)


def _pages(*texts: str) -> list[dict]:
    return [{"page_number": index, "text": text} for index, text in enumerate(texts, start=1)]


def _released() -> list:
    return text_documents_for_pages(_pages(CONTENTS, BODY, ESCAPE, FIGHTING, ANNEX), RELEASED, 1, released_text=True)


def _clause(docs: list, clause_id: str):
    return next(doc for doc in docs if doc.metadata.get("clause_id") == clause_id)


def test_a_released_text_is_cut_on_its_numbered_clauses() -> None:
    docs = _released()
    clauses = [doc.metadata["clause_id"] for doc in docs if doc.metadata.get("chunking") == "clause"]
    assert clauses == ["0", "1", "2", "2.1", "3", "3.1", "3.1.1", "3.1.2", "3.1.3", "3.1.4", "4", "4.1"]
    assert _clause(docs, "3.1.3").metadata["page_label"] == "3"


def test_without_the_records_the_same_file_takes_the_heading_path() -> None:
    docs = text_documents_for_pages(_pages(CONTENTS, BODY, ESCAPE, FIGHTING, ANNEX), RELEASED, 1)
    assert {doc.metadata.get("chunking") for doc in docs} != {"clause", "page"}
    assert not any(doc.metadata.get("chunking") == "clause" for doc in docs)


def test_a_released_text_without_numbered_clauses_keeps_the_heading_path() -> None:
    glossary = _pages("Abstellraum\nEin Raum zum Abstellen.\n", "Brandabschnitt\nEin Bereich eines Gebaeudes.\n")
    docs = text_documents_for_pages(glossary, RELEASED, 1, released_text=True)
    assert docs and not any(doc.metadata.get("chunking") == "clause" for doc in docs)


def test_the_job_knows_a_released_text_by_the_edition_its_mark_names() -> None:
    assert is_released_text({"knowledge_edition_id": "edition:rl-2-2023", "country_id": "XA"}, "oib_knowledge")
    assert not is_released_text({"country_id": "XA"}, "oib_knowledge")
    assert not is_released_text({"knowledge_edition_id": ""}, "oib_knowledge")


def test_an_office_copy_of_an_edition_is_no_released_text() -> None:
    edition = {"knowledge_edition_id": "edition:onorm-b-1600-2017"}
    for office_collection in ("archiv_org_1", "proj_7f3a", "s_session_1"):
        assert not is_released_text(edition, office_collection), office_collection


def test_the_ingest_job_passes_its_config_and_collection_to_the_choice() -> None:
    source = Path(ingest.__file__).with_name("adapter.py").read_text(encoding="utf-8")
    calls = [
        node
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Call) and getattr(node.func, "id", None) in {"text_documents_for_pages", "_chunk"}
    ]
    released = [call for call in calls if len(call.args) == 4]
    assert len(released) == 1
    choice = released[0].args[3]
    assert isinstance(choice, ast.Call) and [ast.unparse(arg) for arg in choice.args] == ["config", "collection_name"]


def test_the_footer_of_any_edition_month_is_furniture() -> None:
    docs = _released()
    assert not any("Ausgabe September 2025" in doc.text for doc in docs if doc.metadata.get("chunking") == "clause")
    assert _clause(docs, "3.1.1").text.startswith("Richtlinie 2\n")


def test_the_annex_the_contents_page_lists_is_no_part_of_the_last_clause() -> None:
    docs = _released()
    assert "Muster der Bescheinigung" not in _clause(docs, "4.1").text
    annex = [doc for doc in docs if "Muster der Bescheinigung" in doc.text]
    assert annex and all(doc.metadata.get("chunking") == "page" for doc in annex)
    assert annex[0].metadata["page_label"] == "5"


def test_the_annex_does_not_count_against_the_coverage_gate() -> None:
    long_annex = ANNEX + "Feld fuer weitere Angaben zur Anlage und ihrer Wartung im Betrieb.\n" * 60
    docs = clause_documents(_pages(CONTENTS, BODY, ESCAPE, FIGHTING, long_annex), RELEASED, 1)
    assert docs is not None


def test_a_sentence_that_starts_with_the_annex_word_stays_in_the_last_clause() -> None:
    fighting = FIGHTING.replace(
        "4.1 Gebaeude muessen fuer die Feuerwehr zugaenglich sein.\n",
        "4.1 Der Nachweis ist nach dem Muster in\nAnhang 1 auszustellen und muss die Pruefung nennen.\n",
    )
    docs = text_documents_for_pages(_pages(CONTENTS, BODY, ESCAPE, fighting, ANNEX), RELEASED, 1, released_text=True)
    assert "Anhang 1 auszustellen" in _clause(docs, "4.1").text
    assert "Muster der Bescheinigung" not in _clause(docs, "4.1").text


def test_a_list_of_tables_after_the_contents_opens_no_back_matter() -> None:
    tables = (
        "Tabellenverzeichnis\n"
        "Tabelle 1: Gehweglaengen .............................. 3\n"
        "Tabelle 2: Mindestwerte ............................... 4\n"
    )
    fighting = FIGHTING.replace("sein.\n", "sein.\nTabelle 2: Mindestwerte\nBreite der Zufahrt 3 m.\n")
    docs = text_documents_for_pages(
        _pages(CONTENTS, tables, BODY, ESCAPE, fighting, ANNEX), RELEASED, 1, released_text=True
    )
    assert "Breite der Zufahrt 3 m" in _clause(docs, "4.1").text


def test_an_edition_named_in_the_text_is_no_footer() -> None:
    escape = ESCAPE.replace("3.1.4 Im Falle", "Siehe den Leitfaden Ausgabe Wien 2020\n3.1.4 Im Falle")
    docs = text_documents_for_pages(_pages(CONTENTS, BODY, escape, FIGHTING, ANNEX), RELEASED, 1, released_text=True)
    assert "Leitfaden Ausgabe Wien 2020" in _clause(docs, "3.1.3").text


def test_an_annex_heading_with_its_title_on_the_same_line_opens_the_back_matter() -> None:
    annex = ANNEX.replace("Anhang\n", "Anhang Muster der Bescheinigung Seite 1\n")
    docs = text_documents_for_pages(_pages(CONTENTS, BODY, ESCAPE, FIGHTING, annex), RELEASED, 1, released_text=True)
    assert "Anhang Muster" not in _clause(docs, "4.1").text
