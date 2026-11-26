from __future__ import annotations

import logging
from collections.abc import Iterable
from collections.abc import Sequence

from . import factory
from .base import BaseIngestor
from .document_metadata_constants import DocumentRef
from .schema import FileStatus

logger = logging.getLogger(__name__)


def _missing_documents(collection: str, wanted: Iterable[DocumentRef]) -> list[DocumentRef]:
    rows = factory.get_available_documents(collection)
    ids = {doc.document_id for doc in rows if doc.document_id}
    names = {doc.file_name for doc in rows}
    unkeyed = {doc.file_name for doc in rows if not doc.document_id}

    def present(ref: DocumentRef) -> bool:
        if ref.document_id:
            return ref.document_id in ids or ref.file_name in unkeyed
        return ref.file_name in names

    return [ref for ref in dict.fromkeys(wanted) if not present(ref)]


def reconcile_collection_summaries(
    ingestor: BaseIngestor,
    collection: str,
    file_names: list[str] | None = None,
    *,
    documents: Sequence[DocumentRef] | None = None,
) -> int:
    if documents is not None or file_names is not None:
        indexed = [*(documents or ()), *(DocumentRef(name, None) for name in file_names or ())]
    else:
        try:
            indexed_files = ingestor.list_files(collection)
        except Exception as e:
            logger.warning("Reconciliation: failed to list indexed files for %s: %s", collection, e)
            return 0
        indexed = [DocumentRef(f.file_name, f.document_id) for f in indexed_files if f.status == FileStatus.SUCCESS]

    if not indexed:
        return 0

    missing = _missing_documents(collection, indexed)
    if not missing:
        return 0

    from .document_classification import fallback_summary_from_text

    sample_fn = getattr(ingestor, "get_document_text_sample", None)

    backfilled = 0
    for file_name, document_id in sorted(missing, key=lambda ref: (ref.file_name, ref.document_id or "")):
        text_sample = None
        if callable(sample_fn):
            try:
                text_sample = sample_fn(collection, file_name, document_id=document_id)
            except Exception as e:
                logger.warning("Reconciliation: failed to sample text for %s in %s: %s", file_name, collection, e)

        summary = fallback_summary_from_text(text_sample) if text_sample else None
        if not summary:
            summary = f"Indexed document: {file_name}"

        factory.register_summary(collection, file_name, summary, document_id=document_id)
        backfilled += 1
        logger.warning(
            "Reconciliation: backfilled missing summary for %s in %s "
            "(primary summary path silently produced no row for an ingested document)",
            file_name,
            collection,
        )

    logger.warning(
        "Reconciliation: backfilled %d/%d document(s) missing summaries in %s",
        backfilled,
        len(indexed),
        collection,
    )
    return backfilled
