from __future__ import annotations

import asyncio
import json
import logging
import math
from typing import Any

from agent.common.message_utils import response_text

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = (
    "You are a retrieval relevance judge for the workspace of an Austrian architecture "
    "office. The candidates are German-language excerpts from the project's files, the "
    "office's own documents, building regulations (OIB-Richtlinien) and guidance documents.\n\n"
    "Score every candidate 0-10 for how directly it answers the user's question:\n"
    "  10-8  states the governing requirement itself (the Punkt, the threshold, the "
    "dimension, the explicit obligation) for exactly what was asked\n"
    "  7-5   on-topic and useful context, but not the governing requirement\n"
    "  4-2   same general subject area, does not bear on the question\n"
    "  1-0   unrelated, or a heading/table-of-contents fragment with no substance\n\n"
    "Rules:\n"
    "- Prefer a chunk that names the applicable Punkt or paragraph over one that only "
    "mentions the topic.\n"
    "- Judge the German text on its own terms; do not penalise a chunk for not being in "
    "the language of the question.\n"
    "- Break ties by preferring the more specific and self-contained excerpt.\n"
    "- Return EXACTLY ONE entry for EVERY candidate number shown, using the numbering "
    "given, from 1 to N. Do not renumber, skip or repeat.\n"
    "- Scores must be whole numbers.\n\n"
    'Return ONLY a JSON object of the form {"scores": [{"i": 1, "score": 8}, ...]}. '
    "No prose, no markdown."
)

_CHUNK_EXCERPT_CHARS = 1200

_TOTAL_EXCERPT_BUDGET_CHARS = 60_000

_MIN_EXCERPT_CHARS = 300

_MIN_SCORE = 0.0
_MAX_SCORE = 10.0


def _excerpt_budget(chunk_count: int, max_doc_chars: int) -> int:
    if chunk_count <= 0:
        return max_doc_chars
    affordable = _TOTAL_EXCERPT_BUDGET_CHARS // chunk_count
    return max(_MIN_EXCERPT_CHARS, min(max_doc_chars, affordable))


def _format_page(chunk: Any) -> str:
    page = getattr(chunk, "page_number", None)
    return f" p.{page}" if page else ""


def _build_user_prompt(query: str, chunks: list[Any], max_doc_chars: int = _CHUNK_EXCERPT_CHARS) -> str:
    from agent.common.licensed_text import licence_from_metadata
    from agent.common.licensed_text import licensed_body

    budget = _excerpt_budget(len(chunks), max_doc_chars)
    lines = [f"Question: {query}", "", f"Candidates (score all {len(chunks)}):", ""]
    for index, chunk in enumerate(chunks, start=1):
        content = getattr(chunk, "content", "")
        if len(content) > budget:
            content = content[:budget] + "…"
        content = licensed_body(content, licence_from_metadata(getattr(chunk, "metadata", None)))
        source = getattr(chunk, "file_name", "")
        lines.append(f"[{index}] {source}{_format_page(chunk)}: {content}")
        lines.append("")
    return "\n".join(lines)


def _is_real_number(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return math.isfinite(float(value))


def _parse_scores(raw: str) -> list[tuple[int, float]]:
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:].strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end <= start:
        return []
    try:
        payload = json.loads(text[start : end + 1])
    except json.JSONDecodeError, ValueError:
        return []
    if not isinstance(payload, dict):
        return []
    entries = payload.get("scores")
    if not isinstance(entries, list):
        return []
    parsed: list[tuple[int, float]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        index = entry.get("i")
        score = entry.get("score")
        if isinstance(index, bool) or not isinstance(index, int):
            continue
        if not _is_real_number(score):
            continue
        parsed.append((index, float(score)))
    return parsed


def _validated_scores(parsed: list[tuple[int, float]], chunk_count: int) -> dict[int, float] | None:
    if chunk_count <= 0:
        return None

    scores: dict[int, float] = {}
    out_of_range = 0
    duplicates = 0
    for index, score in parsed:
        if not 1 <= index <= chunk_count:
            out_of_range += 1
            continue
        if index in scores:
            duplicates += 1
            continue
        scores[index] = min(_MAX_SCORE, max(_MIN_SCORE, score))

    if out_of_range:
        logger.warning("Rerank judge returned %d score(s) outside 1..%d; dropped", out_of_range, chunk_count)
    if duplicates:
        logger.warning("Rerank judge repeated %d index(es); kept the first score for each", duplicates)

    if not scores:
        logger.warning("Rerank judge scored none of the %d candidates; keeping retrieval order", chunk_count)
        return None
    return scores


def _ranked_order(chunks: list[Any], scores: dict[int, float]) -> list[Any]:
    mean_score = sum(scores.values()) / len(scores)
    return [
        chunk
        for _, chunk in sorted(
            enumerate(chunks),
            key=lambda pair: (scores.get(pair[0] + 1, mean_score), pair[0] + 1 in scores),
            reverse=True,
        )
    ]


def _trim(chunks: list[Any], top_n: int | None) -> list[Any]:
    if top_n is None or top_n <= 0:
        return chunks
    return chunks[:top_n]


async def rerank_chunks(
    llm: Any,
    query: str,
    chunks: list[Any],
    *,
    top_n: int | None = None,
    timeout_seconds: float = 30.0,
    max_doc_chars: int = _CHUNK_EXCERPT_CHARS,
    cross_encoder: Any = None,
) -> list[Any]:
    if not chunks or not query:
        return chunks

    if cross_encoder is not None:
        try:
            ranked = await cross_encoder.rerank(query, chunks, top_n=top_n)
            if ranked:
                logger.info("Cross-encoder reranked %d candidate(s)", len(chunks))
                return _trim(ranked, top_n)
            logger.info("Cross-encoder returned no ranking; falling back to the LLM judge")
        except Exception as e:
            logger.warning(
                "Cross-encoder reranking failed (%s: %s); falling back to the LLM judge", type(e).__name__, e
            )

    if llm is None:
        return _trim(chunks, top_n)

    try:
        response = await asyncio.wait_for(
            llm.ainvoke([("system", _SYSTEM_PROMPT), ("user", _build_user_prompt(query, chunks, max_doc_chars))]),
            timeout=timeout_seconds,
        )
        raw = response_text(response)
        if not raw:
            raise ValueError("empty judge reply")

        scores = _validated_scores(_parse_scores(raw), len(chunks))
        if scores is None:
            return _trim(chunks, top_n)

        logger.info("LLM judge reranked %d candidate(s) (%d scored)", len(chunks), len(scores))
        return _trim(_ranked_order(chunks, scores), top_n)
    except Exception as e:
        logger.warning("LLM reranking failed (%s: %s), keeping original order", type(e).__name__, e)
        return _trim(chunks, top_n)
