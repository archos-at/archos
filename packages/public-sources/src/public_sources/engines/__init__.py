from __future__ import annotations

from public_sources.engines.akn import Akn
from public_sources.engines.base import Engine
from public_sources.engines.base import EngineError
from public_sources.engines.base import ParsedDocument
from public_sources.engines.base import Passage
from public_sources.engines.geojson import GeoJson
from public_sources.engines.html_statute import HtmlStatute
from public_sources.engines.pdf_document import PdfDocument
from public_sources.engines.ris_xml import IN_FORCE_UNTIL as RIS_IN_FORCE_UNTIL
from public_sources.engines.ris_xml import RisXml

ENGINES: dict[str, type[Engine]] = {cls.name: cls for cls in (RisXml, Akn, HtmlStatute, GeoJson, PdfDocument)}


def engine_type(name: str) -> type[Engine]:
    try:
        return ENGINES[name]
    except KeyError:
        raise ValueError(f"unknown format {name!r}; known: {', '.join(sorted(ENGINES))}") from None


def engine_for(source) -> Engine:
    return engine_type(source.format)(source.engine)


__all__ = [
    "ENGINES",
    "RIS_IN_FORCE_UNTIL",
    "Engine",
    "EngineError",
    "ParsedDocument",
    "Passage",
    "engine_for",
    "engine_type",
]
