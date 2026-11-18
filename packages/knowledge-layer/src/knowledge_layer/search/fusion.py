import logging
from contextlib import suppress

from .chunk_noise import without_noise

logger = logging.getLogger(__name__)


_MAX_CHUNKS_PER_DOC = 2


_EMBEDDING_MISMATCH_MARKER = "embedding mismatch"


def _is_embedding_mismatch(value: object) -> bool:
    if isinstance(value, BaseException):
        value = str(value)
    return isinstance(value, str) and _EMBEDDING_MISMATCH_MARKER in value.lower()


def _rank_channel(chunks) -> list:
    by_rank: dict[int, object] = {}
    for position, chunk in enumerate(chunks):
        rank = getattr(chunk, "retrieval_rank", None)
        if not isinstance(rank, int) or isinstance(rank, bool) or rank < 0:
            rank = position
        while rank in by_rank:
            rank += 1
        by_rank[rank] = chunk
    if not by_rank:
        return []
    return [by_rank.get(rank) for rank in range(max(by_rank) + 1)]


def apply_diversity_cap(ordered, top_k: int, max_per_document: int) -> list:
    if max_per_document <= 0 or top_k <= 0:
        return list(ordered[:top_k])

    selected: list[int] = []
    deferred: list[int] = []
    per_doc: dict[tuple, int] = {}
    for index, chunk in enumerate(ordered):
        if len(selected) >= top_k:
            deferred.append(index)
            continue
        doc_key = ((getattr(chunk, "metadata", None) or {}).get("collection"), getattr(chunk, "file_name", None))
        if per_doc.get(doc_key, 0) < max_per_document:
            per_doc[doc_key] = per_doc.get(doc_key, 0) + 1
            selected.append(index)
        else:
            deferred.append(index)

    for index in deferred:
        if len(selected) >= top_k:
            break
        selected.append(index)

    return [ordered[index] for index in sorted(selected)]


def _noise_key(chunk) -> str:
    return getattr(chunk, "chunk_id", None) or str(getattr(chunk, "content", ""))


def pool_without_noise(pool, *, enabled: bool) -> tuple[object, frozenset[str]]:
    if not enabled:
        return pool, frozenset()
    kept, dropped = without_noise(pool.chunks)
    if not dropped:
        return pool, frozenset()
    kept_ids = {id(chunk) for chunk in kept}
    gone = frozenset(_noise_key(chunk) for chunk in pool.chunks if id(chunk) not in kept_ids)
    logger.info("OCR noise filter left out %d of %d ranked candidate(s)", dropped, len(pool.chunks))
    return pool.model_copy(update={"chunks": kept}), gone


def merge_results(results, query: str, top_k: int, backend_name: str, max_per_document: int = _MAX_CHUNKS_PER_DOC):
    from agent.knowledge.schema import RetrievalResult

    channels: list[list] = []
    backend = backend_name
    mismatch_errors: list[str] = []
    for result in results:
        if isinstance(result, Exception):
            if _is_embedding_mismatch(result):
                mismatch_errors.append(str(result)[:500])
                logger.error("Knowledge layer embedding mismatch, skipping: %s", result)
            else:
                logger.debug("Knowledge layer raised, skipping: %s", result)
            continue
        if not getattr(result, "success", False):
            message = getattr(result, "error_message", None) or ""
            if _is_embedding_mismatch(message):
                if message not in mismatch_errors:
                    mismatch_errors.append(message)
                logger.error("Knowledge layer embedding mismatch, skipping: %s", message)
            elif "not found" in message.lower():
                logger.debug("Knowledge layer absent, skipping: %s", message)
            else:
                logger.warning("Knowledge layer failed, skipping: %s", message)
            continue
        if result.backend:
            backend = result.backend
        channels.append(_rank_channel(result.chunks))

    merged_chunks = []
    for chunk, _fused_rank, fused_score in _fuse_channels(channels):
        with suppress(Exception):
            chunk.fusion_score = fused_score
        merged_chunks.append(chunk)

    try:
        from agent.common.focus_file import get_focused_file_name
        from agent.common.focus_file import get_focused_shelf

        focused = get_focused_file_name()
        focused_shelf = get_focused_shelf()
    except Exception:
        focused = None
        focused_shelf = None
    if focused:

        def _is_focus(chunk) -> bool:
            if (chunk.file_name or "") != focused:
                return False
            if not focused_shelf:
                return True
            return (chunk.metadata or {}).get("shelf") == focused_shelf

        matching = [chunk for chunk in merged_chunks if _is_focus(chunk)]
        merged_chunks = matching if matching else merged_chunks

    merged_top_k = apply_diversity_cap(merged_chunks, top_k, max_per_document)

    if mismatch_errors:
        unique = list(dict.fromkeys(mismatch_errors))
        detail = "; ".join(unique)
        if not channels:
            return RetrievalResult(success=False, chunks=[], query=query, backend=backend, error_message=detail)
        return RetrievalResult(
            success=True,
            chunks=merged_top_k,
            query=query,
            backend=backend,
            error_message=(
                f"Degraded retrieval: {len(unique)} collection(s) skipped "
                f"due to embedding mismatch ({detail}). Results cover only the "
                "remaining collections and are incomplete."
            ),
        )

    return RetrievalResult(success=True, chunks=merged_top_k, query=query, backend=backend)


def _fuse_channels(channels: list[list]) -> list[tuple]:
    try:
        from knowledge_layer.search.hybrid import fuse_with_ranks

        return fuse_with_ranks(channels)
    except Exception as exc:  # pragma: no cover - import/fusion failure is fail-open
        logger.warning("Cross-collection rank fusion unavailable, using collection order: %s", exc)
        flat = [chunk for channel in channels for chunk in channel if chunk is not None]
        return [(chunk, rank, 0.0) for rank, chunk in enumerate(flat)]
