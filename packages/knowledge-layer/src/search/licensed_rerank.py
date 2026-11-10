"""What a reranker may read of retrieved chunks that carry an office's licence (ADR-0164).

Beside the cross-encoder, which sends every chunk's text to a reranking model: a licensed chunk the office
has not attested for AI processing reaches no model, and an attested one only OpenRouter's zero-retention
endpoints (``cross_encoder._pinned_body`` refuses any other endpoint when ``licensed`` is set).
"""

from __future__ import annotations

from typing import Any


def rerank_documents(chunks: list[Any], max_chars: int) -> tuple[list[str], bool]:
    """What the reranker reads of each chunk, and whether any is an office's licensed text (ADR-0164).

    A licensed chunk the office has not attested for AI processing reaches no model: it is sent empty and
    ranks last. So is an attested one on a turn that may read no licensed text (the ``licensed-seam`` flag off,
    or no turn at all). Otherwise it is sent as it is, which the caller allows only to OpenRouter, pinned to
    zero retention (:func:`_pinned_body`).
    """
    try:
        from agent.common.licensed_text import current_capture
        from agent.common.licensed_text import licence_from_metadata
    except ImportError:  # without the seam there is no reranking at all (`_pinned_body`)
        return [str(getattr(chunk, "content", ""))[:max_chars] for chunk in chunks], False
    capture = current_capture()
    text_allowed = capture is not None and capture.text_allowed
    documents: list[str] = []
    licensed = False
    for chunk in chunks:
        terms = licence_from_metadata(getattr(chunk, "metadata", None))
        readable = terms is None or not terms.licensed or (terms.ai_processing and text_allowed)
        licensed = licensed or (terms is not None and terms.licensed and readable)
        documents.append(str(getattr(chunk, "content", ""))[:max_chars] if readable else "")
    return documents, licensed
