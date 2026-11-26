import logging

logger = logging.getLogger(__name__)


def stored_file_name(collection_name: str, document_id: str) -> str:
    try:
        from knowledge_layer.vector_store import DOCUMENT_ID_FIELD
        from knowledge_layer.vector_store import get_store

        records = get_store().scroll(collection_name, {DOCUMENT_ID_FIELD: document_id}, limit=1, fields=["file_name"])
        return next((str((record.payload or {}).get("file_name") or "") for record in records), "")
    except Exception:  # noqa: BLE001 - without the index the document is still addressed by its id
        logger.warning("No stored name for a document in %s", collection_name, exc_info=True)
        return ""
