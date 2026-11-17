from __future__ import annotations

import json
import logging
import re

from agent.cards.catalog import SYSTEM_CARD_TYPES
from agent.cards.models import answer_card_adapter
from agent.cards.registry import get_card_registry

logger = logging.getLogger(__name__)

_BAR = "｜"
_DSML_MARKER = f"<{_BAR}DSML{_BAR}"

_DSML_TAG_RE = re.compile(rf"</?{_BAR}DSML{_BAR}[^>]*>")

_REGION_START_RE = re.compile(rf"<{_BAR}DSML{_BAR}(?:tool_calls>|invoke\b)")

_EMIT_CARD_PARAM_RE = re.compile(
    rf"<{_BAR}DSML{_BAR}invoke name=\"emit_card\">.*?"
    rf"<{_BAR}DSML{_BAR}parameter name=\"card_json\"[^>]*>",
    re.DOTALL,
)


def _string_step(ch: str, escaped: bool) -> tuple[bool, bool]:
    if escaped:
        return True, False
    if ch == "\\":
        return True, True
    return ch != '"', False


def _extract_balanced_json(text: str, start: int) -> tuple[str | None, int]:
    if start >= len(text) or text[start] != "{":
        return None, start
    depth = 0
    in_string = False
    escaped = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_string:
            in_string, escaped = _string_step(ch, escaped)
            continue
        if ch == '"':
            in_string = True
            continue
        depth += (ch == "{") - (ch == "}")
        if depth == 0:
            return text[start : i + 1], i + 1
    return None, start


def _dsml_token_end(region: str, i: int) -> int | None:
    if region[i] == "<":
        match = _DSML_TAG_RE.match(region, i)
        return match.end() if match else None
    if region[i] == "{":
        _, end = _extract_balanced_json(region, i)
        return end if end > i else None
    return None


def _consume_dsml_region(region: str) -> int:
    i = 0
    last_end = 0
    while i < len(region):
        if region[i].isspace():
            i += 1
            continue
        end = _dsml_token_end(region, i)
        if end is None:
            break
        i = last_end = end
    return last_end


def _salvage_card(card_json: str) -> None:
    try:
        payload = json.loads(card_json, strict=False)
        if not isinstance(payload, dict):
            return
        validated = answer_card_adapter.validate_python(payload).model_dump(exclude_none=True)
        if validated.get("type") in SYSTEM_CARD_TYPES:
            return
        registry = get_card_registry()
        if registry is None:
            return
        registry.add(validated)
        logger.info("Salvaged leaked DSML emit_card '%s'", validated.get("type"))
    except Exception:  # noqa: BLE001 — salvage is best-effort
        logger.warning("Failed to salvage leaked DSML card", exc_info=True)


def strip_and_salvage_dsml_tool_calls(content: str) -> str:
    if not content or _DSML_MARKER not in content:
        return content

    start_match = _REGION_START_RE.search(content)
    if not start_match:
        return content

    region_start = start_match.start()
    region = content[region_start:]

    for param_match in _EMIT_CARD_PARAM_RE.finditer(region):
        card_json, _ = _extract_balanced_json(region, param_match.end())
        if card_json:
            _salvage_card(card_json)

    consumed = _consume_dsml_region(region)
    if consumed <= 0:
        return content

    head = content[:region_start]
    tail = region[consumed:]
    stripped = (head.rstrip() + tail).rstrip()
    return stripped
