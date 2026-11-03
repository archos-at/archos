"""Opening a NAMED passage (`read_passage`): the locator beside the search."""

from __future__ import annotations

from agent.lazy_exports import lazy_exports

# What code outside this package imports, and from where: the names it imported
# from the submodules when the package was laid out by job, measured. Loaded on
# first use (PEP 562), so importing one submodule does not load the others, and
# read from the submodule every time (`cache=False`), so a test that patches a
# submodule is seen through the package too. A name missing here is imported
# from its submodule, and `scripts/check_package_surfaces.py` counts that.
_LAZY: dict[str, str] = {
    "FamilyUnreadable": ".tool",
    "LABEL_FILTERS": ".tool",
    "PassageTarget": ".tool",
    "RangeRefused": ".tool",
    "ReadCursor": ".tool",
    "ReadPassageConfig": ".tool",
    "decode_cursor": ".tool",
    "encode_cursor": ".tool",
    "family_overview": ".tool",
    "older_revision_line": ".tool",
    "outline_for": ".tool",
    "read_passage": ".tool",
}

__getattr__ = lazy_exports(__name__, _LAZY, cache=False)

__all__ = [
    "FamilyUnreadable",
    "LABEL_FILTERS",
    "PassageTarget",
    "RangeRefused",
    "ReadCursor",
    "ReadPassageConfig",
    "decode_cursor",
    "encode_cursor",
    "family_overview",
    "older_revision_line",
    "outline_for",
    "read_passage",
]
