"""The format engines read their format, whoever publishes it."""

from __future__ import annotations

import pytest
from public_sources.engines import EngineError
from public_sources.engines.akn import Akn
from public_sources.engines.html_statute import HtmlStatute
from public_sources.engines.html_statute import anchor_for
from public_sources.engines.ris_xml import RisXml
from public_sources_testing import HTML_PAGE
from public_sources_testing import SOURCES_DIR

RPG = (SOURCES_DIR / "ch" / "fedlex" / "fixtures" / "rpg_20260701_de.xml").read_bytes()

_UK_STYLE = (
    b'<?xml version="1.0"?>'
    b'<akomaNtoso xmlns="http://docs.oasis-open.org/legaldocml/ns/akn/3.0"><act><meta><identification>'
    b'<FRBRWork><FRBRuri value="/akn/uk/act/2026/1"/></FRBRWork>'
    b'<FRBRExpression><FRBRuri value="/akn/uk/act/2026/1/eng@2026-03-01"/>'
    b'<FRBRdate date="2026-03-01" name="valid"/></FRBRExpression>'
    b"</identification></meta><preface><docTitle>Building Act 2026</docTitle></preface><body>"
    b'<section eId="sec_1"><num>1</num><heading>Meaning of building</heading>'
    b"<content><p>In this Act a building is any structure.</p></content></section>"
    b'<section eId="sec_2"><num>2</num><heading>Fire safety</heading>'
    b"<content><p>Every building has an escape route.</p></content></section>"
    b"</body></act></akomaNtoso>"
)


def test_akn_reads_fedlex_articles_with_their_eids_and_without_footnotes():
    document = Akn({"unit": "article", "language": "de", "version_date_name": "jolux:dateApplicability"}).document(RPG)
    assert document.title == "Bundesgesetz vom 22. Juni 1979 über die Raumplanung (Raumplanungsgesetz, RPG)"
    assert document.version == "2026-07-01"
    article = document.passage("art_16_b")
    assert article is not None
    assert (article.number, article.heading) == ("Art. 16b", "Benutzungsverbot und Beseitigung")
    assert article.text.startswith("1 Bauten und Anlagen, die nicht mehr zonenkonform verwendet werden")
    assert "Eingefügt durch" not in article.text and "AS 2000" not in article.text


def test_the_same_engine_reads_a_uk_style_act_by_configuration_alone():
    document = Akn({"unit": "section"}).document(_UK_STYLE)
    assert document.title == "Building Act 2026"
    assert document.uri == "/akn/uk/act/2026/1/eng@2026-03-01"
    assert document.version == "2026-03-01"
    assert [(p.anchor, p.heading) for p in document.passages] == [
        ("sec_1", "Meaning of building"),
        ("sec_2", "Fire safety"),
    ]
    assert document.passages[1].text == "Every building has an escape route."


def test_akn_refuses_what_is_not_akoma_ntoso():
    with pytest.raises(EngineError):
        Akn().document(b"<html><body>no</body></html>")
    with pytest.raises(EngineError):
        Akn().document(b"not xml")


def test_akn_does_not_resolve_external_entities():
    hostile = b"""<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]>
<akomaNtoso xmlns="http://docs.oasis-open.org/legaldocml/ns/akn/3.0"><act><body>
<article eId="art_1"><num>1</num><content><p>&x;</p></content></article></body></act></akomaNtoso>"""
    document = Akn().document(hostile)
    assert "root:" not in document.passages[0].text


def test_html_statute_anchors_by_number_and_keeps_one_copy_of_each():
    engine = HtmlStatute(
        {
            "unit": "//div[@class='norm']",
            "number": ".//span[@class='nr']",
            "heading": ".//span[@class='title']",
            "drop": ["//nav"],
        }
    )
    document = engine.document(HTML_PAGE, url="https://law.example.org/bo.html")
    assert document.title == "Bauordnung (Beispiel)"
    assert [(p.anchor, p.number, p.heading) for p in document.passages] == [
        ("art_1", "Art. 1", "Anwendungsbereich"),
        ("art_6a", "Art. 6a", "Abstandsflächen"),
    ]
    assert document.passages[1].text == "(1) Vor den Außenwänden sind Abstandsflächen freizuhalten."


@pytest.mark.parametrize(
    ("number", "anchor"),
    [("§ 6a", "para_6a"), ("Art. 16b", "art_16b"), ("Artikel 3", "art_3"), ("Section 12", "sec_12"), ("Anlage", "")],
)
def test_anchor_for(number, anchor):
    assert anchor_for(number) == anchor


def test_ris_xml_reads_the_document_inside_content_without_the_screen_reader_twins():
    page = (SOURCES_DIR / "at" / "ris" / "fixtures" / "document_lwi40000066.html").read_bytes()
    document = RisXml({"content_selector": "#content", "drop_selectors": [".sr-only"]}).document(page)
    text = document.passages[0].text
    assert "Art. 3" in text and "Litera a" not in text and "Zum Inhalt" not in text and "Impressum" not in text


def test_akn_eids_are_the_anchors_at_any_unit_the_record_names():
    # A citation to an Absatz resolves to `document + art_16_b/para_1`: the eId
    # Fedlex wrote, kept verbatim, at whatever level the record makes a passage.
    document = Akn({"unit": "paragraph", "language": "de"}).document(RPG)
    anchors = [p.anchor for p in document.passages]
    assert "art_16_b/para_1" in anchors and "art_16_b/para_2" in anchors
    assert anchors.index("art_1/para_1") < anchors.index("art_16_b/para_1")
    assert len(anchors) == len(set(anchors)), "an eId is unique within the document"
    absatz = document.passage("art_16_b/para_2")
    assert absatz is not None and absatz.number == "2"
    assert absatz.text.startswith("Wurde die Bewilligung befristet")
