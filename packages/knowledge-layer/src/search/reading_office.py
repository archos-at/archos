"""The office a search reads as: ``vector_store.reading_office``, named here for the search package's callers.

It lives in ``vector_store`` so the structural reads there (``reads.fetch``,
the folder cards, the visual details) ask the same office a search does,
without importing ``search``.
"""

from __future__ import annotations

from knowledge_layer.vector_store import office_for
from knowledge_layer.vector_store import reading_as

__all__ = ["office_for", "reading_as"]
