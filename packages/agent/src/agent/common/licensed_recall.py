"""A licensed reference from an earlier turn, read again from its document (ADR-0164).

Licensed text is never carried between turns: the transcript, the checkpoint and the trace hold only
the reference, and the turn that read the text dropped it when it ended. A follow-up turn still sees
last turn's tool results, so it would otherwise find references it cannot expand and answer from
nothing. Each reference that names its place (``licensed_text.anchor_of``: collection, file, page,
length) is read again here, at the start of the turn, from the document itself:

- only from a collection this turn may read (the signed collection scope), so a forged anchor
  reaches no other tenant's copy;
- only while the copy is still licensed and attested, and the ``licensed-seam`` flag is on for the
  turn (:func:`file_recalled`);
- only the exact passage: a candidate counts when its sha256 matches the reference's, so a document
  that changed since expands to the expired note, never to other text.

A reference with no anchor (a grep line, a reading of a page image) is not recalled: search or read it
again. What is recalled is filed in this turn's capture like any passage this turn read, and expands in
the call exactly as it did then.
"""

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

#: How many references one turn reads again, at most: last turn's results, bounded by its rounds.
MAX_RECALLED_PER_TURN = 64


def anchor_of(collection: str | None, file_name: str, page: int | None, length: int) -> str:
    """The anchor a reference carries: where the passage stands (collection, file, page) and how long it was.

    Metadata the hit's header states anyway, never text. Base64url JSON, so a file name of any kind survives.
    """
    raw = json.dumps([collection or "", file_name, page, length], ensure_ascii=False, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")


def parse_anchor(anchor: str) -> tuple[str, str, int | None, int] | None:
    """:func:`anchor_of` read back; ``None`` for anything it did not write."""
    try:
        collection, file_name, page, length = json.loads(base64.urlsafe_b64decode(anchor + "=" * (-len(anchor) % 4)))
    except ValueError, TypeError:
        return None
    if not (isinstance(collection, str) and isinstance(file_name, str) and isinstance(length, int)):
        return None
    return collection, file_name, page if isinstance(page, int) else None, length


def references_in(text: str) -> Iterator[tuple[str, str | None]]:
    """Every ``(ref, anchor)`` a text holds."""
    for match in REFERENCE_RE.finditer(text):
        yield match.group(1), match.group(2)


async def open_grounding_capture(licensed_text: bool, messages: Iterable[Any]) -> tuple[Token, Token]:
    """``begin_grounding_capture``, then last turn's licensed references read again into the new capture."""
    from agent.common.grounding_block import begin_grounding_capture

    token = begin_grounding_capture(licensed_text=licensed_text)
    try:
        await recall_references(messages)
    except Exception:  # noqa: BLE001 - a reference not recalled expands to the expired note, never fails a turn
        logger.warning("licensed references not recalled", exc_info=True)
    return token


async def recall_references(messages: Iterable[Any]) -> int:
    """Read every anchored reference of the tool results in ``messages`` this turn holds no text for; how many."""
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
    """File a passage read again into this turn's capture, as one this turn read; its ref, or ``None``."""
    capture = current_capture()
    if capture is None or not capture.text_allowed or not terms.licensed or not terms.ai_processing:
        return None
    if not capture.read_any:
        mark_licensed_turn()
    return capture.file(text, terms.quote_max_chars)


def recall(ref: str, anchor: str, scope: frozenset[str]) -> tuple[str, Any] | None:
    """The passage ``ref`` names and its licence now, read from the document ``anchor`` places it in; else ``None``."""
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
    """The document's licence now and the texts its hit could have come from, through the licence port."""
    from agent.knowledge.licences import licensed_passage_sources

    return licensed_passage_sources(collection, file_name, page)


def _bodies(sources: Iterable[str], length: int) -> Iterator[str]:
    """The bodies a hit of ``length`` characters could have been rendered as from each source text."""
    from agent.common.grounding_block import TRUNCATION_MARKER

    for source in sources:
        for text in dict.fromkeys((source, source.strip())):
            yield text
            yield from _cuts(text, length, TRUNCATION_MARKER)


def _cuts(text: str, length: int, marker: str) -> Iterator[str]:
    """``text`` cut to a body of ``length``: with the renderer's truncation marker, and without."""
    cut = length - len(marker)
    if 0 < cut < len(text):
        yield text[:cut] + marker
    if 0 < length < len(text):
        yield text[:length]


def _scope() -> frozenset[str]:
    """The collections this turn may read; none when it states no scope, so nothing is recalled."""
    from agent.knowledge.scoping import get_collection_scope_from_context

    return frozenset(get_collection_scope_from_context() or ())


def _tool_texts(messages: Iterable[Any]) -> Iterator[str]:
    """The text of each tool result: only a result the agent's own tools produced carries a reference."""
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
