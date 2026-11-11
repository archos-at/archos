"""What an ingest read off a document, onto its metadata row: pages, the title block, the photo, the mail.

Split from ``adapter`` (``docs/contributing/code-conventions.md#size-limits``) like
``filed_mail`` and ``chosen_document_type``: ``LlamaIndexIngestor._ingest_job`` calls
:func:`store_read_facts` once the document's summary row exists. Every fact is the
Fassung's own, so a re-upload (``replaced``) clears what the previous one stated
and this one does not.
"""

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
    """Write the facts ``documents`` (the file's chunks) and the job ``config`` state onto the row.

    Returns the title block's facts it read, which the revision step matches Fassungen by.
    """
    # The page count the listing and the tree show: the highest page
    # any chunk reaches. A text file has none, which clears an old count.
    from agent.knowledge import set_document_page_count
    from agent.knowledge.page_count import largest_page

    set_document_page_count(collection_name, file_name, largest_page(doc.metadata for doc in documents))
    # The title block (Plankopf) the vision model read on the first drawing
    # page that has one: Plannummer, Index, Datum. Read from the same
    # analysis as the chunks, so it costs no further call. A re-upload
    # without one clears the old sheet's facts.
    revision_facts = revisions.revision_facts_from_documents(documents)
    if revision_facts or replaced:
        from agent.knowledge import set_document_revision_facts

        set_document_revision_facts(collection_name, file_name, revision_facts)
    if photo is not None and not photo.empty:
        from agent.knowledge import set_document_capture

        set_document_capture(collection_name, file_name, photo.as_metadata())
    # A filed mail (ADR-0137): the Verlauf's newest message and count, or the
    # message an attachment came with. Each Fassung states its own, so a
    # re-upload of the name as an ordinary file clears what the mail said.
    filed_mail.store_mail_facts(collection_name, file_name, config, replaced=replaced)
    return revision_facts
