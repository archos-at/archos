"""The office's documents as a read-only filesystem: the estate backend (ADR-0133)."""

from __future__ import annotations

from agent.lazy_exports import lazy_exports

_LAZY: dict[str, str] = {
    "EstateBackend": ".backend",
    "PagesRefused": ".backend",
    "glob_files": ".backend",
    "no_such_file": ".backend",
    "pages_for_lines": ".backend",
    "parse_pages": ".backend",
    "document_licence": ".render",
    "licensed_passage_sources": ".render",
    "GrepRefused": ".grep",
    "compile_query": ".grep",
    "render_glob": ".listing",
    "_chunk_hit": ".render",
    "_page_hit": ".render",
}

__getattr__ = lazy_exports(__name__, _LAZY, cache=False)

__all__ = [
    "EstateBackend",
    "GrepRefused",
    "PagesRefused",
    "compile_query",
    "document_licence",
    "glob_files",
    "licensed_passage_sources",
    "no_such_file",
    "pages_for_lines",
    "parse_pages",
    "render_glob",
]
