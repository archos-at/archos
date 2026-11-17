from __future__ import annotations


def mark_corpus_chunks(payloads: dict[str, dict[str, str | bool]]) -> None:
    from knowledge_layer.vector_store import get_store

    from agent.oib_sync import COLLECTION_NAME

    store = get_store()
    if store.exists(COLLECTION_NAME):
        store.set_file_payloads(COLLECTION_NAME, payloads)
