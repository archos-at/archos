from __future__ import annotations

import json
import logging
import re

from pydantic import ValidationError

from agent.common.answer_envelope import ANSWER_KINDS
from agent.common.answer_envelope import CALLOUT_MARKER
from agent.common.answer_envelope import ENVELOPE_FENCE
from agent.common.answer_envelope import AnswerMeta

logger = logging.getLogger(__name__)

_ANSWER_JSON_OPEN_RE = re.compile(rf"```{ENVELOPE_FENCE}[ \t]*\n")
_ANSWER_JSON_FENCE_RE = re.compile(rf"```{ENVELOPE_FENCE}[ \t]*\n(.*?)\n?```", re.DOTALL)
_FENCE_CLOSE_RE = re.compile(r"[ \t]*\n?```")
_CALLOUT_LINE_RE = re.compile(r"^ {0,3}\[\[callout\]\][ \t]*$")
_CALLOUT_INLINE_RE = re.compile(r"\[\[callout\]\]")


def _object_end(raw: str, start: int) -> int | None:
    depth = 0
    in_string = False
    escaped = False
    for i in range(start, len(raw)):
        char = raw[i]
        if in_string:
            in_string, escaped = _string_step(char, escaped)
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
        if char == "}" and depth == 0:
            return i + 1
    return None


def _string_step(char: str, escaped: bool) -> tuple[bool, bool]:
    if escaped:
        return True, False
    if char == "\\":
        return True, True
    if char == '"':
        return False, False
    return True, False


def _envelope_blocks(content: str) -> list[tuple[int, int, str]]:
    blocks: list[tuple[int, int, str]] = []
    position = 0
    while opening := _ANSWER_JSON_OPEN_RE.search(content, position):
        body_start = opening.end()
        brace = content.find("{", body_start)
        if brace != -1 and content[body_start:brace].strip():
            brace = -1
        end = _object_end(content, brace) if brace != -1 else None
        lazy = _ANSWER_JSON_FENCE_RE.match(content, opening.start()) if end is None else None
        if end is None and lazy is None:
            break
        if lazy is not None:
            blocks.append((lazy.start(), lazy.end(), lazy.group(1)))
            position = lazy.end()
            continue
        close = _FENCE_CLOSE_RE.match(content, end)
        block_end = close.end() if close else end
        blocks.append((opening.start(), block_end, content[body_start:end]))
        position = block_end
    return blocks


def _without_blocks(content: str, blocks: list[tuple[int, int, str]]) -> str:
    kept: list[str] = []
    position = 0
    for start, end, _ in blocks:
        kept.append(content[position:start])
        position = end
    kept.append(content[position:])
    return "".join(kept)


def _parse_object(raw: str) -> dict | None:
    try:
        payload = json.loads(raw, strict=False)
        return payload if isinstance(payload, dict) else None
    except json.JSONDecodeError, TypeError:
        pass
    start = raw.find("{")
    if start == -1:
        return None
    end = _object_end(raw, start)
    if end is None:
        return None
    try:
        payload = json.loads(raw[start:end], strict=False)
    except json.JSONDecodeError, TypeError:
        return None
    return payload if isinstance(payload, dict) else None


def _validated_meta(payload: dict) -> AnswerMeta | None:
    try:
        meta = AnswerMeta.model_validate(payload)
    except ValidationError as exc:
        logger.warning("answer envelope anatomy failed validation, dropped: %s", exc)
        return None
    return None if meta.empty else meta


_ANSWER_KEY_RE = re.compile(r'"answer"\s*:\s*(?=")')


def _recover_answer_string(raw: str) -> str | None:
    match = _ANSWER_KEY_RE.search(raw)
    if match is None:
        return None
    try:
        value, _end = json.JSONDecoder(strict=False).raw_decode(raw, match.end())
    except json.JSONDecodeError:
        return None
    return value.strip() if isinstance(value, str) and value.strip() else None


_PROSE_OUTSIDE_WARN_CHARS = 200


def extract_answer_envelope(content: object) -> tuple[object, AnswerMeta | None]:
    if not isinstance(content, str):
        return content, None

    blocks = _envelope_blocks(content)
    if blocks:
        return _from_blocks(content, blocks)

    bare = _from_bare(content)
    if bare is not None:
        return bare

    headless = _salvage_headless(content)
    if headless is not None:
        return headless

    return content, None


def _from_blocks(content: str, blocks: list[tuple[int, int, str]]) -> tuple[object, AnswerMeta | None]:
    payload = _parse_object(blocks[-1][2])
    if payload is None:
        return _unparseable(content, blocks[-1][2])
    answer = payload.get("answer")
    if isinstance(answer, str) and answer.strip():
        outside = _without_blocks(content, blocks).strip()
        if len(outside) > _PROSE_OUTSIDE_WARN_CHARS:
            logger.warning(
                "answer_prose_outside_envelope: %d chars of prose outside the answer_json fence discarded",
                len(outside),
            )
        return answer.strip(), _validated_meta(payload)
    stripped = _without_blocks(content, blocks).strip()
    if stripped:
        return stripped, _validated_meta(payload)
    logger.warning("answer_json envelope has no usable answer field; leaving the reply untouched")
    return content, None


def _unparseable(content: str, raw: str) -> tuple[object, None]:
    answer = _recover_answer_string(raw)
    if answer:
        logger.warning("answer_json envelope is not parseable JSON; recovered its answer string, dropped the rest")
        return answer, None
    logger.warning("answer_json envelope is not parseable JSON; leaving the reply untouched")
    return content, None


def _from_bare(content: str) -> tuple[str, AnswerMeta | None] | None:
    bare = content.strip()
    if not (bare.startswith("{") and bare.endswith("}")):
        return None
    payload = _parse_object(bare)
    if payload is None:
        return None
    answer = payload.get("answer")
    if isinstance(answer, str) and answer.strip():
        return answer.strip(), _validated_meta(payload)
    return None


_HEADLESS_TAIL_KEYS = frozenset(AnswerMeta.model_fields)

_HEADLESS_TAIL_RE = re.compile(r'"\s*,\s*(?="(?:' + "|".join(sorted(map(re.escape, _HEADLESS_TAIL_KEYS))) + r')"\s*:)')


def _salvage_headless(content: str) -> tuple[str, AnswerMeta | None] | None:
    head = content.lstrip()
    if head.startswith("{") or head.startswith(f"```{ENVELOPE_FENCE}"):
        return None
    body = re.sub(r"\n?```\s*$", "", content.rstrip()).rstrip()
    if not body.endswith("}"):
        return None
    split = _HEADLESS_TAIL_RE.search(body)
    payload = _headless_tail(body[split.end() :]) if split is not None else None
    if split is None or payload is None:
        return None
    prose = body[: split.start()].strip()
    if not prose or prose.count("{") > prose.count("}"):
        return None
    logger.warning(
        "answer_envelope_headless: salvaged an envelope whose opening was missing (%d chars of prose)", len(prose)
    )
    return prose, _validated_meta({**payload, "answer": prose})


def _headless_tail(tail: str) -> dict | None:
    try:
        payload, end = json.JSONDecoder(strict=False).raw_decode("{" + tail)
    except json.JSONDecodeError:
        return None
    if end != len(tail) + 1 or not isinstance(payload, dict) or not payload:
        return None
    if not payload.keys() <= _HEADLESS_TAIL_KEYS:
        return None
    if "kind" in payload and payload["kind"] not in ANSWER_KINDS:
        return None
    return payload


def resolve_callout_marker(prose: str, *, has_callout: bool) -> str:
    if CALLOUT_MARKER not in prose:
        return prose

    kept = False
    lines: list[str] = []
    for line in prose.split("\n"):
        if not _CALLOUT_LINE_RE.match(line):
            lines.append(_CALLOUT_INLINE_RE.sub("", line))
            continue
        if has_callout and not kept:
            kept = True
            lines.append(line)
    return "\n".join(lines)
