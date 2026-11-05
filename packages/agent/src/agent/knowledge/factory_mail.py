"""The metadata facade's mail setters: a filed E-Mail-Verlauf, and the message an attachment came with.

Split from :mod:`agent.knowledge.factory` (``docs/contributing/code-conventions.md#size-limits``):
the same UPDATE-only setters on the same store, exported from ``agent.knowledge`` beside the
rest. What the two records hold is :mod:`agent.knowledge.mail_facts`.
"""

from typing import Any

from .factory import _get_document_metadata_store
from .factory import _mirror_facts


def set_document_mail_thread(collection: str, filename: str, thread: dict[str, Any] | None) -> bool:
    """Mark a document as a filed E-Mail-Verlauf, with its newest message's date and count; ``None`` clears it.

    The newest message's date is the document's own date, a payload fact (``document_date``), so
    the change is copied onto the file's points. UPDATE-only, like
    :func:`~agent.knowledge.factory.set_document_capture`: ``False`` when the document has no metadata row.
    """
    changed = _get_document_metadata_store().set_mail_thread(collection, filename, thread or None)
    if changed:
        _mirror_facts(collection, [filename])
    return changed


def set_document_mail_origin(collection: str, filename: str, origin: dict[str, Any] | None) -> bool:
    """Record the message a filed attachment came with (sender, domains, trust, date); ``None`` clears it.

    UPDATE-only, like :func:`~agent.knowledge.factory.set_document_capture`: ``False`` when the
    document has no metadata row.
    """
    return _get_document_metadata_store().set_mail_origin(collection, filename, origin or None)
