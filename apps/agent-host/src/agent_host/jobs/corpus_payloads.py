"""Set payload fields on every chunk of named base-corpus files (ADR-0173).

The ``agent`` package does not reach the vector store itself; ``oib_sync.sync``
takes this as ``mark_chunks`` from the API tier, as it takes ``enqueue``. The
one-time legacy backfill marks the corpus that predates ``country_id`` with it.
"""

from __future__ import annotations


def mark_corpus_chunks(payloads: dict[str, dict[str, str]]) -> None:
    """``payloads`` per file name onto the base corpus's chunks; nothing when the collection does not exist."""
    from knowledge_layer.vector_store import get_store

    from agent.oib_sync import COLLECTION_NAME

    store = get_store()
    if store.exists(COLLECTION_NAME):
        store.set_file_payloads(COLLECTION_NAME, payloads)
