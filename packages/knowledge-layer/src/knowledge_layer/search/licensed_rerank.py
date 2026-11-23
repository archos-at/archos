from __future__ import annotations

from typing import Any


def rerank_documents(chunks: list[Any], max_chars: int) -> tuple[list[str], bool]:
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
