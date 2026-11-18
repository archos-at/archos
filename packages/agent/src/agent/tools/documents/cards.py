from __future__ import annotations

import logging

from pydantic import ValidationError

from agent.cards.models import answer_card_adapter
from agent.cards.registry import get_card_registry

from .media_types import shown_content_type

logger = logging.getLogger(__name__)

MAX_TITLE_CHARS = 120


def draft_title(path: str, content: str) -> str:
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            heading = stripped.lstrip("#").strip()
            if heading:
                return heading[:MAX_TITLE_CHARS]
    return path.rsplit("/", 1)[-1]


_FILED_FIELDS = {
    "grid_filed_document_id": "document_id",
    "grid_filed_version_id": "version_id",
    "grid_filed_state": "version_state",
}


def _filed_fields(filing: dict[str, str] | None) -> dict[str, str]:
    if not filing:
        return {}
    fields = {name: filing[key] for key, name in _FILED_FIELDS.items() if filing.get(key)}
    return fields if len(fields) == len(_FILED_FIELDS) else {}


def emit_draft_card(
    *,
    path: str,
    content: str,
    version: int,
    filing: dict[str, str] | None = None,
    title: str | None = None,
    size: int | None = None,
) -> bool:
    registry = get_card_registry()
    if registry is None:
        return False
    card = {
        "type": "document_draft",
        "title": title or draft_title(path, content),
        "path": path,
        "bytes": size if size is not None else len(content.encode("utf-8")),
        "version": version,
        **({"media_type": media_type} if (media_type := shown_content_type(path)) else {}),
        **_filed_fields(filing),
    }
    try:
        validated = answer_card_adapter.validate_python(card).model_dump(exclude_none=True)
    except ValidationError:
        logger.exception("Failed to build document_draft card for %s", path)
        return False
    earlier = next(
        (
            index
            for index, shown in enumerate(registry.snapshot())
            if shown.get("type") == "document_draft" and shown.get("path") == path
        ),
        None,
    )
    if earlier is None:
        registry.add(validated)
    else:
        registry.replace(earlier, validated)
    logger.info("Emitted document_draft card (path=%s version=%d)", path, version)
    return True
