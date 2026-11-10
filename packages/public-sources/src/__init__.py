"""Public legal and geodata sources as configured records (ADR-0162).

A source is a YAML record under ``configs/sources/`` naming a protocol (an
access type) and a format (an engine). Adding a country's statute database or
geodata service is a new record and its recorded fixtures; code is written
only for a new protocol or format. See ``README.md``.
"""

from public_sources.access import ACCESS_TYPES
from public_sources.access import access_for
from public_sources.engines import ENGINES
from public_sources.engines import engine_for
from public_sources.source import Source
from public_sources.source import SourceError
from public_sources.source import get_source
from public_sources.source import load_sources

__all__ = [
    "ACCESS_TYPES",
    "ENGINES",
    "Source",
    "SourceError",
    "access_for",
    "engine_for",
    "get_source",
    "load_sources",
]
