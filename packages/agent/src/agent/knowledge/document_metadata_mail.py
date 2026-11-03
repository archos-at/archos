"""A document's mail records on its metadata row: the Verlauf it is, or the message it came with.

Split from ``document_metadata_store`` the way its other column families are
(``document_metadata_fields``); the store's methods delegate here.
"""

from __future__ import annotations

import json
from typing import Any

from agent.knowledge.mail_facts import normalise_mail_origin
from agent.knowledge.mail_facts import normalise_mail_thread


def set_mail_thread(store, collection: str, filename: str, thread: dict[str, Any] | None) -> bool:
    """Replace only the ``mail_thread`` record of an existing metadata row (sync): this document is a Verlauf.

    ``latest_sent_at`` (the newest message's clamped send time), ``message_count`` and the thread's
    ``locale`` (:func:`~agent.knowledge.mail_facts.normalise_mail_thread`). Written by the ingest of
    each Fassung, so the newest one's count and date stand. A record with no newest message clears the
    column, which is what a re-upload of the name as an ordinary file means. Same UPDATE-only contract
    as ``set_capture``.
    """
    normalised = normalise_mail_thread(thread)
    value = json.dumps(normalised, ensure_ascii=False) if normalised else None
    return store._update_column(collection, filename, "mail_thread", value)


def set_mail_origin(store, collection: str, filename: str, origin: dict[str, Any] | None) -> bool:
    """Replace only the ``mail_origin`` record of an existing metadata row (sync): the message a file came with.

    ``sent_at``, ``received_at``, the sender's display name and domains, the ``sender_trust`` the receive
    step established, the Verlauf's BFF id and the thread's locale
    (:func:`~agent.knowledge.mail_facts.normalise_mail_origin`, which keeps no address). A record
    that names no date or no trust clears the column: an origin that cannot be printed honestly is not
    printed. Same UPDATE-only contract as ``set_capture``.
    """
    normalised = normalise_mail_origin(origin)
    value = json.dumps(normalised, ensure_ascii=False) if normalised else None
    return store._update_column(collection, filename, "mail_origin", value)


def decode_mail(raw: Any, normalise: Any) -> dict[str, Any] | None:
    """Decode a JSON mail record (``mail_thread``, ``mail_origin``) through its normaliser (fail-open)."""
    if not raw:
        return None
    try:
        return normalise(json.loads(raw))
    except TypeError, ValueError:
        return None
