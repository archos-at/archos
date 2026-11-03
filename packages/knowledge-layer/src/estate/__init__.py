"""The office's documents as a read-only filesystem: the estate backend (ADR-0133)."""

from __future__ import annotations

from agent.lazy_exports import lazy_exports

# What code outside this package imports, and from where: the names it imported
# from the submodules when the package was laid out by job, measured. Loaded on
# first use (PEP 562), so importing one submodule does not load the others, and
# read from the submodule every time (`cache=False`), so a test that patches a
# submodule is seen through the package too. A name missing here is imported
# from its submodule, and `scripts/check_package_surfaces.py` counts that.
_LAZY: dict[str, str] = {
    "EstateBackend": ".backend",
    "PagesRefused": ".backend",
    "glob_files": ".backend",
    "no_such_file": ".backend",
    "pages_for_lines": ".backend",
    "parse_pages": ".backend",
    "GrepRefused": ".grep",
    "compile_query": ".grep",
    "render_glob": ".listing",
}

__getattr__ = lazy_exports(__name__, _LAZY, cache=False)

__all__ = [
    "EstateBackend",
    "GrepRefused",
    "PagesRefused",
    "compile_query",
    "glob_files",
    "no_such_file",
    "pages_for_lines",
    "parse_pages",
    "render_glob",
]
