from __future__ import annotations

import asyncio
import base64
import json
import logging
from collections.abc import Iterable
from collections.abc import Iterator
from contextvars import Token
from typing import Any

from agent.common.licensed_text import REFERENCE_RE
from agent.common.licensed_text import LicenceTerms
from agent.common.licensed_text import current_capture
from agent.common.licensed_text import mark_licensed_turn
from agent.common.licensed_text import passage_digest

logger = logging.getLogger(__name__)

MAX_RECALLED_PER_TURN = 64


def anchor_of(collection: str | None, file_name: str, page: int | None, length: int) -> str:
    raw = json.dumps([collection or "", file_name, page, length], ensure_ascii=False, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")


def parse_anchor(anchor: str) -> tuple[str, str, int | None, int] | None:
    try:
        collection, file_name, page, length = json.loads(base64.urlsafe_b64decode(anchor + "=" * (-len(anchor) % 4)))
    except ValueError, TypeError:
        return None
    if not (isinstance(collection, str) and isinstance(file_name, str) and isinstance(length, int)):
        return None
    return collection, file_name, page if isinstance(page, int) else None, length


def references_in(text: str) -> Iterator[tuple[str, str | None]]:
    for match in REFERENCE_RE.finditer(text):
        yield match.group(1), match.group(2)


async def open_grounding_capture(licensed_text: bool, messages: Iterable[Any]) -> tuple[Token, Token]:
    from agent.common.grounding_block import begin_grounding_capture

    token = begin_grounding_capture(licensed_text=licensed_text)
    try:
        await recall_references(messages)
    except Exception:  # noqa: BLE001 - a reference not recalled expands to the expired note, never fails a turn
        logger.warning("licensed references not recalled", exc_info=True)
    return token


async def recall_references(messages: Iterable[Any]) -> int:
    capture = current_capture()
    if capture is None or not capture.text_allowed:
        return 0
    wanted = {
        ref: anchor
        for text in _tool_texts(messages)
        for ref, anchor in references_in(text)
        if anchor and ref not in capture.passages
    }
    if not wanted:
        return 0
    scope = _scope()
    recalled = 0
    for ref, anchor in list(wanted.items())[:MAX_RECALLED_PER_TURN]:
        found = await asyncio.to_thread(recall, ref, anchor, scope)
        if found is not None and file_recalled(*found) == ref:
            recalled += 1
    return recalled


def file_recalled(text: str, terms: LicenceTerms) -> str | None:
    capture = current_capture()
    if capture is None or not capture.text_allowed or not terms.licensed or not terms.ai_processing:
        return None
    if not capture.read_any:
        mark_licensed_turn()
    return capture.file(text, terms.quote_max_chars)


def recall(ref: str, anchor: str, scope: frozenset[str]) -> tuple[str, Any] | None:
    place = parse_anchor(anchor)
    if place is None or place[0] not in scope:
        return None
    collection, file_name, page, length = place
    try:
        terms, sources = _sources(collection, file_name, page)
    except Exception:  # noqa: BLE001 - a store that cannot be read recalls nothing
        logger.info("licensed reference not recalled: its document could not be read", exc_info=True)
        return None
    if terms is None or not terms.licensed or not terms.ai_processing:
        return None
    return next(((body, terms) for body in _bodies(sources, length) if passage_digest(body) == ref), None)


def _sources(collection: str, file_name: str, page: int | None) -> tuple[LicenceTerms | None, list[str]]:
    from agent.knowledge.licences import licensed_passage_sources

    return licensed_passage_sources(collection, file_name, page)


def _bodies(sources: Iterable[str], length: int) -> Iterator[str]:
    from agent.common.grounding_block import TRUNCATION_MARKER

    for source in sources:
        for text in dict.fromkeys((source, source.strip())):
            yield text
            yield from _cuts(text, length, TRUNCATION_MARKER)


def _cuts(text: str, length: int, marker: str) -> Iterator[str]:
    cut = length - len(marker)
    if 0 < cut < len(text):
        yield text[:cut] + marker
    if 0 < length < len(text):
        yield text[:length]


def _scope() -> frozenset[str]:
    from agent.knowledge.scoping import get_collection_scope_from_context

    return frozenset(get_collection_scope_from_context() or ())


def _tool_texts(messages: Iterable[Any]) -> Iterator[str]:
    for message in messages:
        role = message.get("type") if isinstance(message, dict) else getattr(message, "type", None)
        if role != "tool":
            continue
        content = message.get("content") if isinstance(message, dict) else getattr(message, "content", None)
        yield from _strings(content)


def _strings(content: Any) -> Iterator[str]:
    if isinstance(content, str) and "⟦licensed:" in content:
        yield content
    if isinstance(content, list):
        for part in content:
            yield from _strings(part.get("text") if isinstance(part, dict) else part)
