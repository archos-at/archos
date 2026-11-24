from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

from agent.common.legal_terms import extract_exact_terms
from agent.common.message_utils import response_text

logger = logging.getLogger(__name__)

HYDE_MAX_DRAFT_CHARS = 800

DEFAULT_TIMEOUT_SECONDS = 8.0

_DIGIT_RE = re.compile(r"\d")

_FILENAME_SUFFIX_RE = re.compile(r"\.[A-Za-z0-9]{2,5}\b")

_QUOTE_CHARS = frozenset("\"'„“‚‘«»‹›")

_PARAGRAPH = "§"

_SYSTEM_PROMPT = (
    "You write a short hypothetical regulatory passage that would answer the following "
    "question. Write it in German: it is matched against a German corpus.\n\n"
    "Rules:\n"
    "- About two hundred tokens at most, a single paragraph, no list.\n"
    "- Write in the register of a technical building standard: factual, with mandatory requirements.\n"
    "- Invent no concrete numbers, dimensions or references — state the "
    "regulatory idea in general terms.\n"
    "- Answer ONLY with the passage, with no introduction and no quotation marks."
)


def has_exact_identifier(query: str) -> bool:
    if not query or not query.strip():
        return True
    if extract_exact_terms(query):
        return True
    if _PARAGRAPH in query:
        return True
    if any(char in _QUOTE_CHARS for char in query):
        return True
    if _FILENAME_SUFFIX_RE.search(query):
        return True
    return _DIGIT_RE.search(query) is not None


def should_draft(query: str, *, enabled: bool) -> bool:
    return bool(enabled) and not has_exact_identifier(query)


def build_draft_messages(query: str) -> list[tuple[str, str]]:
    return [("system", _SYSTEM_PROMPT), ("user", query)]


async def draft_passage(
    llm: Any,
    query: str,
    *,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    max_chars: int = HYDE_MAX_DRAFT_CHARS,
) -> str | None:
    if llm is None or not (query or "").strip():
        return None
    try:
        response = await asyncio.wait_for(
            llm.ainvoke(build_draft_messages(query)),
            timeout=timeout_seconds,
        )
        text = response_text(response).strip()
        if not text:
            return None
        return text[:max_chars].rstrip() or None
    except Exception as exc:  # noqa: BLE001 - fail open by design
        logger.warning("HyDE draft failed (%s); retrieving the baseline", type(exc).__name__)
        return None
