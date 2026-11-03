"""A filed mail's facts on the way into the index (ADR-0137).

The job config carries them from ``POST /v1/ingest``: ``source_format`` for an
E-Mail-Verlauf's chunks, and the ``mail_thread`` / ``mail_origin`` records for
its metadata row and an attachment's. Split from ``adapter`` like
``chunk_metadata`` and ``chosen_document_type``.
"""

from __future__ import annotations


def source_format_from_config(config: dict) -> str | None:
    """The format a job config states for its document: ``mail`` for a filed E-Mail-Verlauf, else ``None``.

    ``POST /v1/ingest`` sets it only from ``mail_thread``; anything else in the key
    is not a format this pipeline knows, and stamping it would invent a lane.
    """
    from agent.common.source_kinds import MAIL_SOURCE_FORMAT

    return MAIL_SOURCE_FORMAT if config.get("source_format") == MAIL_SOURCE_FORMAT else None


def store_mail_facts(collection_name: str, file_name: str, config: dict, *, replaced: bool) -> None:
    """Write the job's ``mail_thread`` and ``mail_origin`` onto the document's metadata row.

    The store normalises both (``agent.knowledge.mail_facts``): an origin with
    no date or no trust is not stored, and no key beyond the known ones is kept.
    A record the job does not carry is written only to clear one a replaced
    Fassung of the same name had.
    """
    from agent.knowledge import set_document_mail_origin
    from agent.knowledge import set_document_mail_thread

    thread, origin = config.get("mail_thread"), config.get("mail_origin")
    if thread or replaced:
        set_document_mail_thread(collection_name, file_name, thread if isinstance(thread, dict) else None)
    if origin or replaced:
        set_document_mail_origin(collection_name, file_name, origin if isinstance(origin, dict) else None)
