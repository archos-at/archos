from __future__ import annotations

import json
from typing import Any

from agent.knowledge.mail_facts import normalise_mail_origin
from agent.knowledge.mail_facts import normalise_mail_thread


def set_mail_thread(store, collection: str, filename: str, thread: dict[str, Any] | None) -> bool:
    normalised = normalise_mail_thread(thread)
    value = json.dumps(normalised, ensure_ascii=False) if normalised else None
    return store._update_column(collection, filename, "mail_thread", value)


def set_mail_origin(store, collection: str, filename: str, origin: dict[str, Any] | None) -> bool:
    normalised = normalise_mail_origin(origin)
    value = json.dumps(normalised, ensure_ascii=False) if normalised else None
    return store._update_column(collection, filename, "mail_origin", value)


def decode_mail(raw: Any, normalise: Any) -> dict[str, Any] | None:
    if not raw:
        return None
    try:
        return normalise(json.loads(raw))
    except TypeError, ValueError:
        return None
