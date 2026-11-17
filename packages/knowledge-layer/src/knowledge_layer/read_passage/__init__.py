"""Opening a NAMED passage (`read_passage`): the locator beside the search."""

from __future__ import annotations

from agent.lazy_exports import lazy_exports

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
    "_MAX_PASSAGE_CHUNKS": ".tool",
    "_READ_PASSAGE_DESCRIPTION": ".tool",
    "_addresses": ".tool",
    "_chunk_position": ".tool",
    "_clause_sort_key": ".tool",
    "_current_revision": ".tool",
    "_document_names": ".tool",
    "_fetch_all": ".tool",
    "_matches": ".tool",
    "_outline_block": ".tool",
    "_parse_pages": ".tool",
    "_passage_filters": ".tool",
    "_passage_result": ".tool",
    "_range_order": ".tool",
    "_store_silent_message": ".tool",
    "_without_overlap": ".tool",
}

__getattr__ = lazy_exports(__name__, _LAZY, cache=False)

__all__ = [
    "FamilyUnreadable",
    "LABEL_FILTERS",
    "PassageTarget",
    "RangeRefused",
    "ReadCursor",
    "ReadPassageConfig",
    "_MAX_PASSAGE_CHUNKS",
    "_READ_PASSAGE_DESCRIPTION",
    "_addresses",
    "_chunk_position",
    "_clause_sort_key",
    "_current_revision",
    "_document_names",
    "_fetch_all",
    "_matches",
    "_outline_block",
    "_parse_pages",
    "_passage_filters",
    "_passage_result",
    "_range_order",
    "_store_silent_message",
    "_without_overlap",
    "decode_cursor",
    "encode_cursor",
    "family_overview",
    "older_revision_line",
    "outline_for",
    "read_passage",
]
