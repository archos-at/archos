"""The PDFs the public-sources tests read.

``fixtures/baunvo.pdf`` is a real public PDF: the Baunutzungsverordnung as
gesetze-im-internet.de publishes it (fetched 2026-11-10, 16 pages). A statute
is a free work (§ 5 Abs. 1 UrhG in Germany, § 7 Abs. 1 UrhG in Austria), which
is why it may be a fixture. ``fixtures/baunvo.txt`` is what
:func:`public_sources.pdf.read_pdf` reads from it, pages joined by a form feed:
``python -m public_sources_testing.pdf_fixture`` rewrites it. The workspace's
door spec serves the same two files, so the text the BFF checks a quote against
is the text ingestion extracts; ``test_pdf.py`` fails when they drift.

The small ones are built with ingestion's own test builder
(``knowledge_layer_testing.pdf_fixtures``): § 7 of the Austrian
Urheberrechtsgesetz on two pages, the same statute behind a password, a scan
with no text layer, and bytes that are no PDF.
"""

from __future__ import annotations

from pathlib import Path

from knowledge_layer_testing.pdf_fixtures import build_pdf

FIXTURES = Path(__file__).resolve().parent / "fixtures"
REAL_PDF = FIXTURES / "baunvo.pdf"
REAL_TEXT = FIXTURES / "baunvo.txt"

TITLE = "Urheberrechtsgesetz, § 7 Freie Werke"

_PAGES = (
    (
        "Urheberrechtsgesetz",
        "Freie Werke",
        "§ 7. (1) Gesetze, Verordnungen, amtliche Erlässe, Bekanntmachungen",
        "und Entscheidungen sowie ausschließlich oder vorwiegend zum amtlichen",
        "Gebrauch hergestellte amtliche Werke der im § 2, Z. 1 oder 3,",
        "bezeichneten Art genießen keinen urheberrechtlichen Schutz.",
    ),
    # Abs. 2 on its own page: the sentence the door spec quotes from page 2.
    (
        "(2) Die vom Bundesamt für Eich- und Vermessungswesen hergestellten",
        "oder bearbeiteten (§ 5, Absatz 1) und zur Verbreitung (§ 16)",
        "bestimmten Landkarten sind keine freien Werke.",
    ),
)


def statute_pdf() -> bytes:
    return build_pdf([[("R", 11, line) for line in page] for page in _PAGES])


def scanned_pdf() -> bytes:
    """Pages with no text layer, as a scan without OCR has them."""
    return build_pdf([[], []])


def password_pdf() -> bytes:
    """The statute behind a user password: its /U entry matches no empty password."""
    key = "ab" * 32
    ident = key[:32]
    encrypt = f"/Encrypt << /Filter /Standard /V 1 /R 2 /O <{key}> /U <{key}> /P -4 >> /ID [<{ident}> <{ident}>] /Root"
    return statute_pdf().replace(b"/Root", encrypt.encode(), 1)


def broken_pdf() -> bytes:
    """Bytes that announce a PDF and are none."""
    return b"%PDF-1.4\n1 0 obj << /Type /Catalog >> garbage, no xref, no trailer"


def real_text() -> str:
    """The committed text of the real PDF, without the file's closing newline."""
    return REAL_TEXT.read_text(encoding="utf-8").removesuffix("\n")


if __name__ == "__main__":
    # Rewrites the committed text from the PDF, here: no backend role, so the reader runs in this process.
    from public_sources.pdf import parse_pdf

    REAL_TEXT.write_text((parse_pdf(REAL_PDF.read_bytes()).text or "") + "\n", encoding="utf-8")
