from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from .models import PassageTarget


def _current_revision(document: Any, documents: Sequence[Any]) -> str | None:
    by_name = {str(getattr(doc, "file_name", "")): doc for doc in documents}
    seen = {str(getattr(document, "file_name", ""))}
    current: str | None = None
    next_name = getattr(document, "superseded_by", None)
    while next_name and next_name in by_name and next_name not in seen:
        current = next_name
        seen.add(next_name)
        next_name = getattr(by_name[next_name], "superseded_by", None)
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
