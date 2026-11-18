from __future__ import annotations

import logging
import re
from typing import Any

from agent.common.answer_envelope import TAKEAWAYS_MIN_PROSE_CHARS

from .answer_check import prose_without_references

logger = logging.getLogger(__name__)

_CARD_SUPPRESS_MIN_PROSE_CHARS = 400

_CARD_MARKER_RE = re.compile(r"\[\[card:\d+\]\]")


def _should_suppress_meta_cards(content: str, gated_meta: dict[str, Any] | None) -> bool:
    if not gated_meta:
        return False
    try:
        prose_chars = len(prose_without_references(content))
    except Exception:
        return False
    if prose_chars >= _CARD_SUPPRESS_MIN_PROSE_CHARS:
        return False
    if gated_meta.get("verdict") is not None:
        return False
    return gated_meta.get("kind") not in ("ruling", "work")


def _suppress_cards(content: str, gated_meta: dict[str, Any] | None) -> tuple[str, dict[str, Any] | None, bool]:
    if not _should_suppress_meta_cards(content, gated_meta):
        return content, gated_meta, False
    try:
        from agent.cards.envelope import is_floor_exempt
        from agent.cards.registry import get_card_registry as _get_registry_for_guard

        _guard_registry = _get_registry_for_guard()
        if _guard_registry is not None and any(is_floor_exempt(card) for card in _guard_registry.snapshot()):
            logger.info("Piloti: answer cards suppressed: veto card present, keeping cards and meta")
            return content, gated_meta, False
    except Exception:
        logger.debug("Suppression veto guard skipped", exc_info=True)
    try:
        prose_chars = len(prose_without_references(content))
    except Exception:
        prose_chars = -1
    logger.info(
        "Piloti: answer cards suppressed: prose %d chars under the %d floor with no verdict",
        prose_chars,
        _CARD_SUPPRESS_MIN_PROSE_CHARS,
    )
    try:
        from agent.cards.registry import get_card_registry

        registry = get_card_registry()
        if registry is not None and len(registry) > 0:
            logger.info("Piloti: answer cards suppressed: dropping %d tool-registered card(s)", len(registry))
            registry.clear()
    except Exception:
        logger.debug("Card registry suppression skipped", exc_info=True)
    try:
        stripped = _CARD_MARKER_RE.sub("", content)
        stripped = re.sub(r"\n{3,}", "\n\n", stripped).strip()
        content = stripped
    except Exception:
        pass
    if prose_chars >= TAKEAWAYS_MIN_PROSE_CHARS:
        return content, gated_meta, True
    kept = {key: value for key, value in (gated_meta or {}).items() if key in ("v", "callout")}
    return content, (kept if "callout" in kept else None), True
