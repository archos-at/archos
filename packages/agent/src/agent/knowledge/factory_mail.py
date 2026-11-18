from typing import Any

from .factory import _get_document_metadata_store
from .factory import _mirror_facts


def set_document_mail_thread(collection: str, filename: str, thread: dict[str, Any] | None) -> bool:
    changed = _get_document_metadata_store().set_mail_thread(collection, filename, thread or None)
    if changed:
        _mirror_facts(collection, [filename])
    return changed


def set_document_mail_origin(collection: str, filename: str, origin: dict[str, Any] | None) -> bool:
    return _get_document_metadata_store().set_mail_origin(collection, filename, origin or None)
