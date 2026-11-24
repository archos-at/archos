from __future__ import annotations

import contextvars
import logging
from collections import Counter
from typing import Any

from agent.observability.trace_context import OBSERVATION_LEVEL_ATTRIBUTE
from agent.observability.trace_context import OBSERVATION_STATUS_MESSAGE_ATTRIBUTE

logger = logging.getLogger(__name__)

METADATA_PREFIX = "langfuse.trace.metadata."
TAGS_ATTRIBUTE = "langfuse.trace.tags"
OBSERVATION_OUTPUT_ATTRIBUTE = "langfuse.observation.output"

_MAX_OUTPUT_CHARS = 32_000

_TURN_OUTCOME: contextvars.ContextVar[dict[str, Any] | None] = contextvars.ContextVar("turn_outcome", default=None)


def begin_turn_outcome() -> contextvars.Token[dict[str, Any] | None]:
    return _TURN_OUTCOME.set({})


def end_turn_outcome(token: contextvars.Token[dict[str, Any] | None]) -> None:
    _TURN_OUTCOME.reset(token)


_FACTS = "__turn_facts__"
_TAGS = "__turn_tags__"


def current_turn_outcome() -> dict[str, Any] | None:
    box = _TURN_OUTCOME.get()
    if not box:
        return None
    attributes = {key: value for key, value in box.items() if key not in (_FACTS, _TAGS)}
    facts = box.get(_FACTS) or {}
    attributes.update({f"{METADATA_PREFIX}{key}": value for key, value in facts.items()})
    tags = [*(attributes.get(TAGS_ATTRIBUTE) or []), *(box.get(_TAGS) or [])]
    if tags:
        attributes[TAGS_ATTRIBUTE] = list(dict.fromkeys(tags))
    return attributes or None


def _fill(attributes: dict[str, Any]) -> None:
    box = _TURN_OUTCOME.get()
    if box is None:
        return
    kept = {key: box[key] for key in (_FACTS, _TAGS) if box.get(key)}
    box.clear()
    box.update(attributes)
    box.update(kept)


def record_turn_facts(**facts: Any) -> None:
    try:
        box = _TURN_OUTCOME.get()
        if box is None:
            return
        stored = dict(box.get(_FACTS) or {})
        stored.update({key: value for key, value in facts.items() if value is not None})
        box[_FACTS] = stored
    except Exception:
        logger.debug("Failed to record a turn fact for its trace", exc_info=True)


def record_turn_tag(tag: str) -> None:
    try:
        box = _TURN_OUTCOME.get()
        if box is not None and tag not in (box.get(_TAGS) or []):
            box[_TAGS] = [*(box.get(_TAGS) or []), tag]
    except Exception:
        logger.debug("Failed to record a turn tag for its trace", exc_info=True)


def turn_tagged(tag: str) -> bool:
    box = _TURN_OUTCOME.get()
    return bool(box) and tag in (box.get(_TAGS) or [])


def record_turn_finished(body: Any) -> None:
    try:
        _fill(outcome_attributes(outcome=body.outcome, result=body.result))
    except Exception:
        logger.debug("Failed to record the turn outcome for its trace", exc_info=True)


def record_turn_error(code: str, message: str | None = None) -> None:
    try:
        _fill(error_attributes(code=code, message=message))
    except Exception:
        logger.debug("Failed to record the turn error for its trace", exc_info=True)


def _card_types(cards: list[Any]) -> list[str]:
    kinds = (getattr(keyed, "card", {}).get("type") for keyed in cards)
    return sorted({kind for kind in kinds if isinstance(kind, str) and kind})


def _quote_counts(stamps: list[Any]) -> dict[str, int]:
    return dict(Counter(getattr(stamp, "status", None) for stamp in stamps if getattr(stamp, "status", None)))


def _source_project_id(source: Any) -> str | None:
    project = getattr(source, "project", None)
    project_id = project.get("id") if isinstance(project, dict) else None
    return str(project_id) if project_id else None


def _answer_kind(meta: Any) -> str | None:
    kind = meta.get("kind") if isinstance(meta, dict) else None
    return kind if isinstance(kind, str) and kind else None


def _level_for(outcome: str) -> str:
    return "WARNING" if outcome == "cancelled" else "DEFAULT"


def _work_counts(meta: Any) -> dict[str, int | None]:
    work = meta.get("work") if isinstance(meta, dict) else None
    if not isinstance(work, dict):
        return {}
    return {
        f"work_{section}": len(work.get(section) or []) or None for section in ("done", "proposed", "blocked", "next")
    }


def outcome_metadata(*, outcome: str, result: Any) -> dict[str, Any]:
    removed = getattr(result, "citations_removed", None)
    quotes = _quote_counts(list(getattr(result, "quote_stamps", None) or []))
    precedents = [pid for pid in map(_source_project_id, getattr(result, "sources", None) or []) if pid]
    facts: dict[str, Any] = {
        "turn_outcome": outcome,
        "answer_route": getattr(result, "routing_decision", None),
        "answer_confidence": getattr(result, "answer_confidence", None),
        "answer_confidence_capped": getattr(result, "answer_confidence_capped_reason", None),
        "answer_sources": len(getattr(result, "sources", None) or []),
        "answer_precedent_sources": len(precedents) or None,
        "answer_precedent_projects": len(set(precedents)) or None,
        "answer_cards": len(getattr(result, "cards", None) or []),
        "answer_card_types": _card_types(list(getattr(result, "cards", None) or [])) or None,
        "answer_chars": len(getattr(result, "text", "") or ""),
        "citations_removed": removed.count if removed is not None else 0,
        "quotes_verbatim": quotes.get("verbatim"),
        "quotes_not_found": quotes.get("not_found"),
        "research_truncated": True if getattr(result, "research_truncated", False) else None,
        "skills_activated": list(getattr(result, "skills_activated", None) or []) or None,
        "reasoning_effort": getattr(result, "reasoning_effort", None),
        "handed_off_to_run": True if getattr(result, "run", None) is not None else None,
        "answer_kind": _answer_kind(getattr(result, "answer_meta", None)),
        **_work_counts(getattr(result, "answer_meta", None)),
    }
    return {key: value for key, value in facts.items() if value is not None}


def outcome_tags(metadata: dict[str, Any]) -> list[str]:
    tags = [f"outcome:{metadata['turn_outcome']}"]
    for key, prefix in (
        ("answer_route", "route"),
        ("answer_confidence", "confidence"),
        ("answer_confidence_capped", "capped"),
    ):
        if metadata.get(key):
            tags.append(f"{prefix}:{metadata[key]}")
    if metadata.get("citations_removed"):
        tags.append("citations-removed")
    if metadata.get("quotes_not_found"):
        tags.append("quote-not-found")
    if metadata.get("research_truncated"):
        tags.append("research-truncated")
    if metadata.get("handed_off_to_run"):
        tags.append("handed-off")
    if metadata.get("answer_precedent_sources"):
        tags.append("cited-precedent")
    if metadata.get("answer_kind") == "work":
        tags.append("kind:work")
    return tags


def outcome_attributes(*, outcome: str, result: Any) -> dict[str, Any]:
    metadata = outcome_metadata(outcome=outcome, result=result)
    attributes: dict[str, Any] = {f"{METADATA_PREFIX}{key}": value for key, value in metadata.items()}
    attributes[TAGS_ATTRIBUTE] = outcome_tags(metadata)
    attributes[OBSERVATION_LEVEL_ATTRIBUTE] = _level_for(outcome)
    text = getattr(result, "text", "") or ""
    if text.strip():
        attributes[OBSERVATION_OUTPUT_ATTRIBUTE] = text[:_MAX_OUTPUT_CHARS]
    return attributes


def error_attributes(*, code: str, message: str | None = None) -> dict[str, Any]:
    attributes: dict[str, Any] = {
        f"{METADATA_PREFIX}turn_outcome": "error",
        f"{METADATA_PREFIX}error_code": code,
        TAGS_ATTRIBUTE: ["outcome:error", f"error:{code}"],
        OBSERVATION_LEVEL_ATTRIBUTE: "ERROR",
    }
    if message:
        attributes[OBSERVATION_STATUS_MESSAGE_ATTRIBUTE] = message[:500]
    return attributes
