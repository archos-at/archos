from __future__ import annotations

from typing import Any

from . import filed_mail
from . import revisions


def store_read_facts(
    collection_name: str,
    file_name: str,
    documents: list[Any],
    *,
    photo: Any,
    config: dict,
    replaced: bool,
) -> dict[str, Any] | None:
    from agent.knowledge import set_document_page_count
    from agent.knowledge.page_count import largest_page

    set_document_page_count(collection_name, file_name, largest_page(doc.metadata for doc in documents))
    revision_facts = revisions.revision_facts_from_documents(documents)
    if revision_facts or replaced:
        from agent.knowledge import set_document_revision_facts

        set_document_revision_facts(collection_name, file_name, revision_facts)
    if photo is not None and not photo.empty:
        from agent.knowledge import set_document_capture

        set_document_capture(collection_name, file_name, photo.as_metadata())
    filed_mail.store_mail_facts(collection_name, file_name, config, replaced=replaced)
    return revision_facts
