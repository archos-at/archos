"""Helpers the public-sources tests share (packages/AGENTS.md: no ``tests/__init__.py``)."""

from __future__ import annotations

from pathlib import Path

import yaml

#: The repository's source records.
SOURCES_DIR = Path(__file__).resolve().parents[4] / "configs" / "sources"


def write_source(root: Path, record: dict, fixtures: dict[str, bytes] | None = None) -> Path:
    """Write ``record`` as ``<root>/<territory>/<name>/source.yml`` with its fixture files; returns the dir."""
    territory, _, name = record["id"].partition("-")
    directory = root / territory / name
    (directory / "fixtures").mkdir(parents=True, exist_ok=True)
    (directory / "source.yml").write_text(yaml.safe_dump(record, allow_unicode=True), encoding="utf-8")
    for file_name, content in (fixtures or {}).items():
        (directory / "fixtures" / file_name).write_bytes(content)
    return directory


def html_source(**overrides) -> dict:
    """A minimal ``web_document`` + ``html_statute`` record for tests."""
    record = {
        "id": "xx-portal",
        "title": "A Land portal",
        "territory": "DE-BY",
        "protocol": "web_document",
        "format": "html_statute",
        "hosts": ["law.example.org"],
        "terms": {"url": "https://law.example.org/terms", "licence": "public_open", "checked": "2026-11-06"},
        "access": {"documents": [{"id": "bo", "url": "https://law.example.org/bo.html"}]},
        "engine": {
            "unit": "//div[@class='norm']",
            "number": ".//h3/span[@class='nr']",
            "heading": ".//h3/span[@class='title']",
            "drop": ["//nav"],
        },
        "fixtures": [
            {
                "name": "the page",
                "operation": "document",
                "args": {"id": "bo"},
                "responses": {"https://law.example.org/bo.html": "bo.html"},
                "expect": {
                    "kind": "document",
                    "anchors": ["art_1", "art_6a"],
                    "contains": ["Abstandsflächen"],
                    "excludes": ["Navigation"],
                },
            }
        ],
    }
    record.update(overrides)
    return record


HTML_PAGE = (
    "<!DOCTYPE html><html><head><title>Bauordnung (Beispiel)</title></head><body>\n"
    "<nav>Navigation Startseite</nav>\n"
    '<div class="norm"><h3><span class="nr">Art. 1</span> <span class="title">Anwendungsbereich</span></h3>'
    "<p>(1) Dieses Gesetz gilt für bauliche Anlagen.</p></div>\n"
    '<div class="norm"><h3><span class="nr">Art. 6a</span> <span class="title">Abstandsflächen</span></h3>'
    "<p>(1) Vor den Außenwänden sind Abstandsflächen freizuhalten.</p></div>\n"
    '<div class="norm"><h3><span class="nr">Art. 6a</span> <span class="title">Abstandsflächen</span></h3>'
    "<p>Duplicate of the table of contents.</p></div>\n"
    "</body></html>"
).encode()


#: The synthetic test country's gazette (ADR-0174): a web_document source as the BFF hands a configured source over.
SYNTHETIC_PAGE = (
    "<html><body><h1>Building Code of Xanadu</h1>"
    '<section><span class="nr">§ 1</span><h2>Scope</h2><p>This code applies to every building in Xanadu.</p></section>'
    "</body></html>"
)
SYNTHETIC_URL = "https://gazette.xa.example/building-code"
SYNTHETIC_TERMS = "https://gazette.xa.example/terms"


def synthetic_source(**overrides) -> dict:
    """The synthetic gazette's record in ``public_sources.source.Source``'s shape, responses inline."""
    record = {
        "id": "xa-gazette",
        "title": "Gazette of Xanadu",
        "territory": "XA",
        "protocol": "web_document",
        "format": "html_statute",
        "hosts": ["gazette.xa.example"],
        "data_flow": "public_only",
        "terms": {"url": SYNTHETIC_TERMS, "licence": "public_open", "attribution": "", "checked": "2026-11-01"},
        "monitor": {"kind": "sha256", "interval_hours": 24, "probe": {"operation": "document", "args": {"id": "code"}}},
        "access": {"documents": [{"id": "code", "url": SYNTHETIC_URL, "title": "Building Code"}]},
        "engine": {"unit": "//section", "number": "./span[@class='nr']", "heading": "./h2", "title": "//h1"},
        "fixtures": [
            {
                "name": "code",
                "operation": "document",
                "args": {"id": "code"},
                "responses": {SYNTHETIC_URL: {"content_type": "text/html; charset=utf-8", "text": SYNTHETIC_PAGE}},
                "expect": {"title": "Building Code of Xanadu", "anchors": ["para_1"], "contains": ["every building"]},
            }
        ],
    }
    record.update(overrides)
    return record
