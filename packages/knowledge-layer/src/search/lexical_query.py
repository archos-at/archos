import logging
from collections.abc import Sequence

logger = logging.getLogger(__name__)

_EXACT_TERM_DF_CACHE_MAX = 512


def lexical_inputs(
    query: str, collection_names: str | Sequence[str], df_cache: dict[tuple[str, int, str], int]
) -> tuple[str, list[str]]:
    from knowledge_layer.vector_store import retrieval as qdrant_retrieval

    from agent.common import german_text

    from .hybrid import extract_exact_terms
    from .hybrid import selective_terms

    exact = extract_exact_terms(query) if extract_exact_terms is not None else []
    candidates = qdrant_retrieval.bm25_candidates(query, extra_terms=expansion_terms(query))
    try:
        if len(df_cache) >= _EXACT_TERM_DF_CACHE_MAX:
            df_cache.clear()
        total, frequencies = qdrant_retrieval.term_frequencies(collection_names, [*candidates, *exact], cache=df_cache)
    except Exception as e:  # noqa: BLE001 - same fail-open as the Chroma path's pricing
        logger.warning("Term frequencies unavailable (%s); BM25 and exact terms unpriced", e)
        return bm25_text(query), exact
    lexical = german_text.select_terms(candidates, frequencies, total)
    terms = selective_terms({term: frequencies[term] for term in exact}, total) if exact else []
    return " ".join(lexical), terms


def expansion_terms(query: str) -> list[str]:
    try:
        from agent.common import query_expansion

        return list(query_expansion.expansion_terms(query))
    except Exception:  # noqa: BLE001 - the glossary widens recall, it never gates a search
        logger.debug("Query expansion unavailable for the BM25 channel", exc_info=True)
        return []


def bm25_text(query: str) -> str:
    return " ".join([query, *expansion_terms(query)])
