from __future__ import annotations

from pathlib import Path

from knowledge_layer_testing.pdf_fixtures import build_pdf

# baunvo.pdf is a statute fetched 2026-11-10 from gesetze-im-internet.de; statutes are free works (§ 5 Abs. 1 UrhG DE, § 7 Abs. 1 UrhG AT).
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
    (
        "(2) Die vom Bundesamt für Eich- und Vermessungswesen hergestellten",
        "oder bearbeiteten (§ 5, Absatz 1) und zur Verbreitung (§ 16)",
        "bestimmten Landkarten sind keine freien Werke.",
    ),
)


def statute_pdf() -> bytes:
    return build_pdf([[("R", 11, line) for line in page] for page in _PAGES])


def scanned_pdf() -> bytes:
    return build_pdf([[], []])


def password_pdf() -> bytes:
    key = "ab" * 32
    ident = key[:32]
    encrypt = f"/Encrypt << /Filter /Standard /V 1 /R 2 /O <{key}> /U <{key}> /P -4 >> /ID [<{ident}> <{ident}>] /Root"
    return statute_pdf().replace(b"/Root", encrypt.encode(), 1)


def broken_pdf() -> bytes:
    return b"%PDF-1.4\n1 0 obj << /Type /Catalog >> garbage, no xref, no trailer"


def real_text() -> str:
    return REAL_TEXT.read_text(encoding="utf-8").removesuffix("\n")


if __name__ == "__main__":
    from public_sources.pdf import parse_pdf

    REAL_TEXT.write_text((parse_pdf(REAL_PDF.read_bytes()).text or "") + "\n", encoding="utf-8")
