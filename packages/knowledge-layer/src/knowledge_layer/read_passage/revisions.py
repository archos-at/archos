from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from .models import PassageTarget


def _newer(document: Any, by_id: dict[str, Any], by_name: dict[str, Any]) -> Any | None:
    newer_id = getattr(document, "superseded_by_id", None)
    if newer_id:
        return by_id.get(str(newer_id))
    return by_name.get(str(getattr(document, "superseded_by", None) or ""))


def _current_revision(document: Any, documents: Sequence[Any]) -> str | None:
    by_id = {str(doc.document_id): doc for doc in documents if getattr(doc, "document_id", None)}
    by_name = {str(getattr(doc, "file_name", "")): doc for doc in documents}
    seen = {id(document)}
    current: str | None = None
    newer = _newer(document, by_id, by_name)
    while newer is not None and id(newer) not in seen:
        current = str(getattr(newer, "file_name", ""))
        seen.add(id(newer))
        newer = _newer(newer, by_id, by_name)
    return current


def _older_revision_notice(targets: Sequence[PassageTarget]) -> str:
    from agent.knowledge.restricted_use import may_name

    older = {(target.file_name, target.current) for target in targets if target.current and may_name(target.collection)}
    if not older:
        return ""
    return "".join(older_revision_line(name, current) for name, current in sorted(older))


def older_revision_line(name: str, current: str) -> str:
    return (
        f"Older Fassung: {name} is replaced by {current} (confirmed); {current} is current. "
        "Say in the answer that you are reading the older Fassung.\n\n"
    )


def _mail_origin_notice(targets: Sequence[PassageTarget]) -> str:
    from agent.knowledge.mail_facts import mail_origin_label
    from agent.knowledge.restricted_use import may_name

    lines = {
        (target.file_name, label)
        for target in targets
        if may_name(target.collection) and (label := mail_origin_label(target.mail_origin))
    }
    return "".join(f"{name} {label}.\n\n" for name, label in sorted(lines))


def _target_notices(targets: Sequence[PassageTarget]) -> str:
    return _older_revision_notice(targets) + _mail_origin_notice(targets)
