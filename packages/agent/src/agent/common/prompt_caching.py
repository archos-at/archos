from __future__ import annotations

import hashlib
import json
import logging
import re
from collections.abc import Iterator
from collections.abc import Mapping
from collections.abc import Sequence
from contextlib import contextmanager
from contextvars import ContextVar
from contextvars import Token
from typing import Any

from langchain_core.messages import HumanMessage
from langchain_core.messages import SystemMessage

logger = logging.getLogger(__name__)

SESSION_ID_FIELD = "session_id"

PROMPT_CACHE_KEY_FIELD = "prompt_cache_key"

CACHE_CONTROL_FIELD = "cache_control"

PROMPT_CACHE_OPTIONS_FIELD = "prompt_cache_options"
_NO_CACHE_WRITES = {"mode": "explicit"}

AUTOMATIC_WRITE_FAMILIES = ("openai",)
_AUTOMATIC_WRITES_FROM = (5, 6)
_GPT_VERSION = re.compile(r"gpt-(\d+)(?:\.(\d+))?")

_AUTOMATIC_CACHE = {"type": "ephemeral"}

EXPLICIT_CACHE_FAMILIES = ("anthropic",)

BLOCK_BREAKPOINT_FAMILIES = ("anthropic", "openai", "google")

_KEY_PREFIX = "grid"

_DIGEST_CHARS = 24

_STABLE_PREFIX: ContextVar[str | None] = ContextVar("prompt_cache_stable_prefix", default=None)


_ONE_SHOT: ContextVar[bool] = ContextVar("prompt_cache_one_shot", default=False)


@contextmanager
def one_shot_calls() -> Iterator[None]:
    token = _ONE_SHOT.set(True)
    try:
        yield
    finally:
        _ONE_SHOT.reset(token)


def _without_cache_writes(extra_body: Any, model: str | None) -> dict[str, Any] | None:
    merged: dict[str, Any] = dict(extra_body) if isinstance(extra_body, Mapping) else {}
    if writes_automatically(model):
        merged.setdefault(PROMPT_CACHE_OPTIONS_FIELD, dict(_NO_CACHE_WRITES))
    return merged or None


def writes_automatically(model: str | None) -> bool:
    if _family(model) not in AUTOMATIC_WRITE_FAMILIES:
        return False
    match = _GPT_VERSION.search(model or "")
    return bool(match) and (int(match.group(1)), int(match.group(2) or 0)) >= _AUTOMATIC_WRITES_FROM


def begin_stable_prefix(prefix: str | None) -> Token[str | None]:
    return _STABLE_PREFIX.set(prefix or None)


def end_stable_prefix(token: Token[str | None]) -> None:
    _STABLE_PREFIX.reset(token)


def _cacheable_prefix(system_prompt: str) -> str:
    prefix = _STABLE_PREFIX.get()
    if prefix and system_prompt.startswith(prefix):
        return prefix
    return system_prompt


def _canonical(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
    except TypeError, ValueError:
        return repr(value)


def stable_prefix_digest(*parts: Any) -> str:
    joined = "\x1e".join(_canonical(part) for part in parts)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:_DIGEST_CHARS]


def prompt_cache_key(
    *,
    system_prompt: str | None,
    tools: Any = None,
    organization_id: str | None = None,
    model: str | None = None,
) -> str:
    digest = stable_prefix_digest(organization_id or "-", model or "-", system_prompt or "", tools)
    return f"{_KEY_PREFIX}-{digest}"


def with_prompt_cache_routing(extra_body: Any, key: str) -> dict[str, Any]:
    merged: dict[str, Any] = dict(extra_body) if isinstance(extra_body, Mapping) else {}
    merged.setdefault(SESSION_ID_FIELD, key)
    merged.setdefault(PROMPT_CACHE_KEY_FIELD, key)
    return merged


def _family(model: str | None) -> str:
    return (model or "").lstrip("~").partition("/")[0]


def needs_cache_marker(model: str | None) -> bool:
    return _family(model) in EXPLICIT_CACHE_FAMILIES


def cached_system_message(text: str) -> SystemMessage:
    return SystemMessage(content=[{"type": "text", "text": text, CACHE_CONTROL_FIELD: dict(_AUTOMATIC_CACHE)}])


def cached_context_message(text: str) -> HumanMessage:
    return HumanMessage(content=[{"type": "text", "text": text, CACHE_CONTROL_FIELD: dict(_AUTOMATIC_CACHE)}])


def _without_breakpoint(content: Any) -> Any:
    if not isinstance(content, list) or not any(isinstance(b, dict) and CACHE_CONTROL_FIELD in b for b in content):
        return content
    blocks = [
        {k: v for k, v in block.items() if k != CACHE_CONTROL_FIELD} if isinstance(block, dict) else block
        for block in content
    ]
    if len(blocks) == 1 and blocks[0].get("type") == "text" and set(blocks[0]) == {"type", "text"}:
        return blocks[0]["text"]
    return blocks


def strip_block_breakpoints(messages: Any, model: str | None, *, openrouter: bool = True) -> Any:
    if openrouter and _family(model) in BLOCK_BREAKPOINT_FAMILIES:
        return messages
    if not isinstance(messages, list):
        return messages
    out = []
    changed = False
    for message in messages:
        content = getattr(message, "content", None)
        stripped = _without_breakpoint(content)
        if stripped is content:
            out.append(message)
            continue
        out.append(message.model_copy(update={"content": stripped}))
        changed = True
    return out if changed else messages


def with_cache_marker(extra_body: Any, model: str | None) -> dict[str, Any]:
    merged: dict[str, Any] = dict(extra_body) if isinstance(extra_body, Mapping) else {}
    if needs_cache_marker(model):
        merged.setdefault(CACHE_CONTROL_FIELD, dict(_AUTOMATIC_CACHE))
    return merged


def _system_text(messages: Any) -> str | None:
    if not isinstance(messages, Sequence) or isinstance(messages, str | bytes) or not messages:
        return None
    first = messages[0]
    if getattr(first, "type", None) != "system":
        return None
    content = getattr(first, "content", None)
    if isinstance(content, str):
        return content
    if isinstance(content, list) and all(isinstance(b, dict) and b.get("type") == "text" for b in content):
        return "".join(str(b.get("text", "")) for b in content)
    return _canonical(content)


def prompt_cache_extra_body(
    messages: Any,
    kwargs: Mapping[str, Any],
    *,
    extra_body: Any = None,
    organization_id: str | None = None,
    model: str | None = None,
) -> dict[str, Any] | None:
    if _ONE_SHOT.get():
        return _without_cache_writes(extra_body, model)
    system_prompt = _system_text(messages)
    if system_prompt is None:
        return with_cache_marker(extra_body, model) if needs_cache_marker(model) else None
    key = prompt_cache_key(
        system_prompt=_cacheable_prefix(system_prompt),
        tools=(kwargs.get("tools"), kwargs.get("response_format")),
        organization_id=organization_id,
        model=model,
    )
    return with_cache_marker(with_prompt_cache_routing(extra_body, key), model)
