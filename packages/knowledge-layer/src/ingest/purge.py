"""Deleting chunks for ``LlamaIndexIngestor``, which supplies ``_store``; the adapter is read at call time."""

from __future__ import annotations

from typing import Any

from agent.knowledge import ingest_status_store


class ChunkPurgeMixin:
    _store: Any

    def delete_document(
        self, document_id: str, file_name: str, collection_name: str, *, permanent: bool = False
    ) -> bool:
        """Its chunks by id, and by name only those that carry no id; summaries go for every name they had."""
        from knowledge_layer.vector_store import CHUNK_ID_FIELD
        from knowledge_layer.vector_store import DOCUMENT_ID_FIELD

        from . import adapter as _adapter

        forgotten = ingest_status_store.forget_file(collection_name, file_name)
        by_id: dict[str, Any] = {DOCUMENT_ID_FIELD: {"$eq": document_id}}
        spellings = self._spellings_in(collection_name, file_name)
        unclaimed = {"$and": [{"file_name": {"$in": spellings}}, {DOCUMENT_ID_FIELD: {"$exists": False}}]}
        records = self._store().scroll(
            collection_name,
            {"$or": [by_id, unclaimed]} if spellings else by_id,
            fields=[CHUNK_ID_FIELD, "file_name"],
            page_size=_adapter._LISTING_PAGE,
        )
        chunks = [
            (str((record.payload or {}).get(CHUNK_ID_FIELD) or record.id), str((record.payload or {}).get("file_name")))
            for record in records
        ]
        names = [file_name, *sorted({stored for _, stored in chunks} - {file_name})]
        return self._purge(collection_name, names, chunks, forgotten, permanent=permanent)

    def _spellings_in(self, collection_name: str, file_name: str) -> list[str]:
        from . import adapter as _adapter

        return sorted(
            stored
            for stored in self._store().file_counts(collection_name)
            if stored == file_name or _adapter._stored_name_matches(file_name, stored)
        )

    def _purge(
        self,
        collection_name: str,
        names: list[str],
        chunks: list[tuple[str, str]],
        forgotten: int,
        *,
        permanent: bool,
    ) -> bool:
        from agent.knowledge import unregister_summary

        from . import adapter as _adapter

        file_name = names[0]
        if not chunks:
            if forgotten:
                _adapter.logger.info(f"Removed {forgotten} job record(s) of file {file_name}")
            else:
                _adapter.logger.warning(f"No chunks found for file_name={file_name}; clearing its summary")
            unregister_summary(collection_name, file_name, permanent=permanent)
            return forgotten > 0

        self._store().delete_chunks(collection_name, [chunk_id for chunk_id, _ in chunks])
        _adapter.bump_collection_version(collection_name)
        _adapter.logger.info(f"Deleted {len(chunks)} chunks for file {file_name}")
        for name in names:
            unregister_summary(collection_name, name, permanent=permanent)
        return True
