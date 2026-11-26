from __future__ import annotations

from typing import TYPE_CHECKING
from typing import Any

from agent.knowledge.title_block import normalise_revision_facts

if TYPE_CHECKING:
    pass

from agent.knowledge.document_metadata_constants import SUGGESTION_BASES
from agent.knowledge.document_metadata_helpers import dismissed_revision_ids
from agent.knowledge.document_metadata_helpers import dismissed_revisions
from agent.knowledge.document_metadata_helpers import is_refused


def _decode_tags(raw: Any) -> list[str] | None:
    if not raw:
        return None
    import json

    try:
        decoded = json.loads(raw)
    except TypeError, ValueError:
        return None
    if isinstance(decoded, list):
        tags = [t for t in decoded if isinstance(t, str)]
        return tags or None
    return None


def _decode_json(raw: Any, kind: type) -> Any:
    import json

    if not raw:
        return None
    try:
        decoded = json.loads(raw)
    except TypeError, ValueError:
        return None
    return decoded if isinstance(decoded, kind) and decoded else None


def _decode_object(cls, raw: Any) -> dict[str, Any] | None:
    if not raw:
        return None
    import json

    try:
        decoded = json.loads(raw)
    except TypeError, ValueError:
        return None
    if not isinstance(decoded, dict):
        return None
    kept: dict[str, Any] = {}
    for key, expected in cls._CAPTURE_TYPES.items():
        value = decoded.get(key)
        if value is None or isinstance(value, bool) or not isinstance(value, expected):
            continue
        if key == "captured_at" and not value.strip():
            continue
        kept[key] = value
    return kept or None


def _decode_revision_facts(raw: Any) -> dict[str, Any] | None:
    if not raw:
        return None
    import json

    try:
        return normalise_revision_facts(json.loads(raw))
    except TypeError, ValueError:
        return None


def _normalise_suggestion(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    older, confidence = value.get("of"), value.get("confidence")
    reason, basis = value.get("reason"), value.get("basis")
    if not isinstance(older, str) or not older.strip():
        return None
    if isinstance(confidence, bool) or not isinstance(confidence, int | float) or not 0.0 <= confidence <= 1.0:
        return None
    if not isinstance(reason, str) or not reason.strip() or basis not in SUGGESTION_BASES:
        return None
    older_id = value.get("of_id") if isinstance(value.get("of_id"), str) and value["of_id"].strip() else None
    refused_ids = dismissed_revision_ids(value)
    normalised: dict[str, Any] = {
        "of": older,
        "confidence": float(confidence),
        "reason": reason.strip(),
        "basis": basis,
        "dismissed": is_refused(value, older, older_id),
        "dismissed_of": dismissed_revisions(value),
    }
    if older_id:
        normalised["of_id"] = older_id
    if refused_ids:
        normalised["dismissed_of_ids"] = refused_ids
    return normalised


def _decode_suggestion(cls, raw: Any) -> dict[str, Any] | None:
    if not raw:
        return None
    import json

    try:
        return cls._normalise_suggestion(json.loads(raw))
    except TypeError, ValueError:
        return None
