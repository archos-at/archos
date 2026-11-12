"""A released text is cut on its Punkte, because the platform's records say what it is.

The platform stores a released text under ``<manifestationKey>-<hash>.pdf``, a name no
filename reader classes, so ingestion cut it on its headings. A Richtlinie sets its
sub-Punkte as numbered paragraphs in body type, not as headings, and the chunk holding
5.1.1 to 5.1.4 was cited "Pkt. 5.1", where the corpus's own copy of the same bytes, cut
on its Punkte, cites "Pkt. 5.1.1". The records name the file as an edition's text: its
ingest job carries ``knowledge_edition_id`` (ADR-0173). That, not the file name and not
the human-set ``doc_class`` (ADR-0064), routes it to the Punkt chunker.

Synthetic page dicts only: no third-party PDF.
"""

from __future__ import annotations

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
    """The file name says nothing; only the records route it (and a tenant's file never has them)."""
    docs = text_documents_for_pages(_pages(CONTENTS, BODY, ESCAPE, FIGHTING, ANNEX), RELEASED, 1)
    assert {doc.metadata.get("chunking") for doc in docs} != {"clause", "page"}
    assert not any(doc.metadata.get("chunking") == "clause" for doc in docs)


def test_a_released_text_without_numbered_clauses_keeps_the_heading_path() -> None:
    glossary = _pages("Abstellraum\nEin Raum zum Abstellen.\n", "Brandabschnitt\nEin Bereich eines Gebaeudes.\n")
    docs = text_documents_for_pages(glossary, RELEASED, 1, released_text=True)
    assert docs and not any(doc.metadata.get("chunking") == "clause" for doc in docs)


def test_the_job_knows_a_released_text_by_the_edition_its_mark_names() -> None:
    assert is_released_text({"knowledge_edition_id": "edition:rl-2-2023", "country_id": "XA"})
    assert not is_released_text({"country_id": "XA"})
    assert not is_released_text({"knowledge_edition_id": ""})


def test_the_footer_of_any_edition_month_is_furniture() -> None:
    """Matched on May alone, a September edition's footer stayed in its Punkte as text."""
    docs = _released()
    assert not any("Ausgabe September 2025" in doc.text for doc in docs if doc.metadata.get("chunking") == "clause")
    assert _clause(docs, "3.1.1").text.startswith("Richtlinie 2\n")


def test_the_annex_the_contents_page_lists_is_no_part_of_the_last_clause() -> None:
    """Otherwise the forms after the last Punkt were filed, and cited, as that Punkt."""
    docs = _released()
    assert "Muster der Bescheinigung" not in _clause(docs, "4.1").text
    annex = [doc for doc in docs if "Muster der Bescheinigung" in doc.text]
    assert annex and all(doc.metadata.get("chunking") == "page" for doc in annex)
    assert annex[0].metadata["page_label"] == "5"


def test_the_annex_does_not_count_against_the_coverage_gate() -> None:
    """A long annex of forms is back matter, not a sign the document is not Punkt-structured."""
    long_annex = ANNEX + "Feld fuer weitere Angaben zur Anlage und ihrer Wartung im Betrieb.\n" * 60
    docs = clause_documents(_pages(CONTENTS, BODY, ESCAPE, FIGHTING, long_annex), RELEASED, 1)
    assert docs is not None
