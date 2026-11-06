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
