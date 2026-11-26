from typing import Any

from .factory import _get_document_metadata_store
from .factory import _mirror_document


def set_document_mail_thread(
    collection: str, filename: str, thread: dict[str, Any] | None, *, document_id: str | None = None
) -> bool:
    changed = _get_document_metadata_store().set_mail_thread(
        collection, filename, thread or None, document_id=document_id
    )
    if changed:
        _mirror_document(collection, filename, document_id)
    return changed


def set_document_mail_origin(
    collection: str, filename: str, origin: dict[str, Any] | None, *, document_id: str | None = None
) -> bool:
    return _get_document_metadata_store().set_mail_origin(collection, filename, origin or None, document_id=document_id)
