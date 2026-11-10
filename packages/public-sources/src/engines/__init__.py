"""Format engines: bytes into anchored text. One per format, none per country."""

from __future__ import annotations

from public_sources.engines.akn import Akn
from public_sources.engines.base import Engine
from public_sources.engines.base import EngineError
from public_sources.engines.base import ParsedDocument
from public_sources.engines.base import Passage
from public_sources.engines.geojson import GeoJson
from public_sources.engines.html_statute import HtmlStatute
from public_sources.engines.pdf_document import PdfDocument
from public_sources.engines.ris_xml import RisXml

#: Every format a source record may name. A new one is code, written once.
ENGINES: dict[str, type[Engine]] = {cls.name: cls for cls in (RisXml, Akn, HtmlStatute, GeoJson, PdfDocument)}


def engine_type(name: str) -> type[Engine]:
    try:
        return ENGINES[name]
    except KeyError:
        raise ValueError(f"unknown format {name!r}; known: {', '.join(sorted(ENGINES))}") from None


def engine_for(source) -> Engine:
    """The format engine of ``source``, configured from its record."""
    return engine_type(source.format)(source.engine)


__all__ = ["ENGINES", "Engine", "EngineError", "ParsedDocument", "Passage", "engine_for", "engine_type"]
