import asyncio
import json
import logging
import os
import threading
import time
from collections.abc import Sequence
from typing import Any

from agent.knowledge.base import BaseRetriever
from agent.knowledge.factory import register_retriever
from agent.knowledge.schema import Chunk
from agent.knowledge.schema import RetrievalResult
from knowledge_layer import dependencies
from knowledge_layer import embedding
from knowledge_layer.dependencies import retrieval_dependency_error
from knowledge_layer.embedding import EMBED_BATCH_SIZE
from knowledge_layer.embedding import EMBED_MAX_RETRIES
from knowledge_layer.embedding import QUERY_EMBED_TIMEOUT_SECONDS
from knowledge_layer.embedding import embed_fingerprint_metadata
from knowledge_layer.env import env_int

from .lexical_query import lexical_inputs
from .query_embeddings import QueryEmbeddingCache
from .reading_office import office_for
from .retrieved_chunks import chunk_from_node

logger = logging.getLogger(__name__)


def collection_version(collection_name: str) -> int | None:
    from agent.knowledge import collection_version as _collection_version

    return _collection_version.current(collection_name)


def _filters_fingerprint(filters: dict[str, Any] | None) -> str:
    if not filters:
        return ""
    return json.dumps(filters, sort_keys=True, default=str)


@register_retriever("llamaindex")
class LlamaIndexRetriever(BaseRetriever):
    DEFAULT_EMBED_MODEL = os.environ.get("EMBED_MODEL", "openai/text-embedding-3-large")
    DEFAULT_EMBED_BASE_URL = os.environ.get("EMBED_BASE_URL", "https://openrouter.ai/api/v1")
    DEFAULT_TOP_K = env_int("RETRIEVER_TOP_K", 10)
    DEFAULT_HYBRID_SEARCH = os.environ.get("HYBRID_RETRIEVAL", "true").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }

    backend_name = "llamaindex"

    def __init__(self, config: dict[str, Any] | None = None):
        super().__init__(config)

        self.embed_model_name = self.config.get("embed_model", self.DEFAULT_EMBED_MODEL)
        self.embed_base_url = self.config.get("embed_base_url", self.DEFAULT_EMBED_BASE_URL)
        self.default_top_k = self.config.get("top_k", self.DEFAULT_TOP_K)
        self.hybrid_search = bool(self.config.get("hybrid_search", self.DEFAULT_HYBRID_SEARCH))

        self._embed_model = None
        self._initialized = False
        self._init_lock = threading.Lock()

        self._query_embeddings = QueryEmbeddingCache()

        self._qdrant_term_df: dict[tuple[str, int, str], int] = {}

        self._result_cache: dict[tuple[str, int, str, int, str], tuple[float, RetrievalResult]] = {}
        self._result_cache_order: list[tuple[str, int, str, int, str]] = []
        self._result_cache_lock = threading.Lock()

        logger.info("LlamaIndexRetriever initialized")

    STATIC_RESULT_CACHE_COLLECTIONS = frozenset(
        name.strip()
        for name in os.environ.get("STATIC_RESULT_CACHE_COLLECTIONS", "oib_knowledge").split(",")
        if name.strip()
    )
    STATIC_RESULT_CACHE_TTL_SECONDS = int(os.environ.get("STATIC_RESULT_CACHE_TTL_SECONDS", "3600"))
    RESULT_CACHE_MAX = 256

    def _ensure_initialized(self):
        if self._initialized:
            return

        with self._init_lock:
            if self._initialized:
                return
            self._initialize_components()

    def _initialize_components(self):
        dependencies.ensure_retrieval_dependencies()

        try:
            embed_api_key = embedding.resolve_embed_api_key(self.embed_base_url, self.embed_model_name)
            if not embed_api_key:
                logger.error(
                    "No embeddings API key resolved (EMBED_API_KEY / "
                    "the provider key for EMBED_BASE_URL) - retrieval/ingestion will fail."
                )

            self._embed_model = embedding.make_embed_model(
                base_url=self.embed_base_url,
                model=self.embed_model_name,
                api_key=embed_api_key,
                embed_batch_size=EMBED_BATCH_SIZE,
                timeout=QUERY_EMBED_TIMEOUT_SECONDS,
                max_retries=EMBED_MAX_RETRIES,
            )

            self._initialized = True
            logger.info("LlamaIndex retriever components initialized")

        except ImportError as e:
            raise retrieval_dependency_error(e) from e

    async def retrieve(
        self,
        query: str,
        collection_name: str,
        top_k: int = 10,
        filters: dict[str, Any] | None = None,
    ) -> RetrievalResult:
        return await asyncio.to_thread(self._retrieve_sync, query, collection_name, top_k, filters)

    async def warm_query(self, query: str) -> None:
        try:
            await asyncio.to_thread(self._warm_sync, query)
        except Exception:  # noqa: BLE001 - a warm-up is worth less than the turn
            logger.debug("Query warm-up failed", exc_info=True)

    async def find_text(
        self,
        collection_name: str,
        pattern: str,
        filters: dict[str, Any] | None = None,
        limit: int = 500,
        user_regex: bool = False,
        stem_phrases: list[str] | None = None,
    ) -> list[Chunk] | None:
        return await asyncio.to_thread(
            self._find_text_sync, collection_name, pattern, filters, limit, user_regex, stem_phrases
        )

    async def candidate_counts(
        self, collection_name: str, pattern: str, filters: dict[str, Any] | None = None, user_regex: bool = False
    ) -> dict[str, int] | None:
        from knowledge_layer.vector_store import candidate_counts as qdrant_candidate_counts

        office = office_for([collection_name])
        return await asyncio.to_thread(
            qdrant_candidate_counts,
            collection_name,
            pattern,
            filters,
            office_id=office,
            user_regex=user_regex,
        )

    async def fetch(
        self,
        collection_name: str,
        filters: dict[str, Any] | None,
        limit: int,
        order_by: str | None = None,
        start_from: tuple[int, int] | None = None,
    ) -> list[Chunk] | None:
        return await asyncio.to_thread(self._fetch_sync, collection_name, filters, limit, order_by, start_from)

    def _fetch_sync(
        self,
        collection_name: str,
        filters: dict[str, Any] | None,
        limit: int,
        order_by: str | None,
        start_from: tuple[int, int] | None = None,
    ) -> list[Chunk]:
        from knowledge_layer.vector_store import CHUNK_ORDINAL_FIELD
        from knowledge_layer.vector_store import fetch as qdrant_fetch
        from knowledge_layer.vector_store import fetch_from as qdrant_fetch_from

        if start_from is None:
            hits = qdrant_fetch(collection_name, filters, limit, order_by)
        else:
            hits = qdrant_fetch_from(collection_name, filters, start_from, limit)
        chunks = [self._chunk_from_hit(hit) for hit in hits]
        for rank, (chunk, hit) in enumerate(zip(chunks, hits, strict=True)):
            chunk.retrieval_rank = rank
            if isinstance(hit.payload.get(CHUNK_ORDINAL_FIELD), int):
                chunk.metadata.setdefault(CHUNK_ORDINAL_FIELD, hit.payload[CHUNK_ORDINAL_FIELD])
        return chunks

    def _find_text_sync(
        self,
        collection_name: str,
        pattern: str,
        filters: dict[str, Any] | None,
        limit: int,
        user_regex: bool = False,
        stem_phrases: list[str] | None = None,
    ) -> list[Chunk]:
        if not pattern or limit <= 0:
            return []
        from knowledge_layer.vector_store import CHUNK_ORDINAL_FIELD
        from knowledge_layer.vector_store import find_text as qdrant_find_text

        office = office_for([collection_name])
        hits = qdrant_find_text(
            collection_name, pattern, filters, limit, office_id=office, user_regex=user_regex, stem_phrases=stem_phrases
        )
        chunks = [self._chunk_from_hit(hit) for hit in hits]
        for chunk, hit in zip(chunks, hits, strict=True):
            if isinstance(hit.payload.get(CHUNK_ORDINAL_FIELD), int):
                chunk.metadata.setdefault(CHUNK_ORDINAL_FIELD, hit.payload[CHUNK_ORDINAL_FIELD])
        return chunks

    def warm_components(self) -> None:
        self._ensure_initialized()
        from knowledge_layer.vector_store import find_text  # noqa: F401 - the read path's imports, paid here

    def _warm_sync(self, query: str) -> None:
        self._ensure_initialized()
        self._embed_query_cached(query)

    def _embed_query_cached(self, query: str) -> list[float]:
        return self._query_embeddings.embed(
            (self.embed_model_name, query), lambda: self._embed_model.get_query_embedding(query)
        )

    def _cached_static_result(self, key: tuple[str, int, str, int, str]) -> RetrievalResult | None:
        with self._result_cache_lock:
            entry = self._result_cache.get(key)
            if entry is None:
                return None
            cached_at, result = entry
            if time.monotonic() - cached_at >= self.STATIC_RESULT_CACHE_TTL_SECONDS:
                self._result_cache.pop(key, None)
                if key in self._result_cache_order:
                    self._result_cache_order.remove(key)
                return None
            return result.model_copy(deep=True)

    def _store_static_result(self, key: tuple[str, int, str, int, str], result: RetrievalResult) -> None:
        with self._result_cache_lock:
            self._result_cache[key] = (time.monotonic(), result.model_copy(deep=True))
            if key in self._result_cache_order:
                self._result_cache_order.remove(key)
            self._result_cache_order.append(key)
            while len(self._result_cache_order) > self.RESULT_CACHE_MAX:
                evicted = self._result_cache_order.pop(0)
                self._result_cache.pop(evicted, None)

    def _static_cache_key(
        self, collection_name: str, query: str, top_k: int, filters: dict[str, Any] | None
    ) -> tuple[str, int, str, int, str] | None:
        if collection_name not in self.STATIC_RESULT_CACHE_COLLECTIONS:
            return None
        version = collection_version(collection_name)
        if version is None:
            return None
        return (collection_name, version, query, top_k, _filters_fingerprint(filters))

    def _retrieve_sync(
        self,
        query: str,
        collection_name: str,
        top_k: int = 10,
        filters: dict[str, Any] | None = None,
    ) -> RetrievalResult:
        try:
            self._ensure_initialized()

            logger.info(f"LlamaIndexRetriever.retrieve: query='{query[:50]}...', collection={collection_name}")

            cache_key = self._static_cache_key(collection_name, query, top_k, filters)
            if cache_key is not None:
                cached = self._cached_static_result(cache_key)
                if cached is not None:
                    logger.info(f"Static retrieval cache hit for collection {collection_name}")
                    return cached

            chunks = self._qdrant_chunks(query, collection_name, top_k, filters)

            for rank, chunk in enumerate(chunks):
                chunk.retrieval_rank = rank

            logger.info(f"LlamaIndex retrieval returned {len(chunks)} chunks")

            result = RetrievalResult(
                chunks=chunks,
                query=query,
                backend=self.backend_name,
                success=True,
            )
            if cache_key is not None:
                self._store_static_result(cache_key, result)
            return result

        except Exception as e:
            logger.exception("LlamaIndex retrieval failed")
            return RetrievalResult(
                chunks=[],
                query=query,
                backend=self.backend_name,
                success=False,
                error_message=f"Retrieval failed: {str(e)[:500]}",
            )

    def _identity(self) -> dict[str, str]:
        return embed_fingerprint_metadata(self.embed_model_name, self.embed_base_url)

    def _qdrant_chunks(
        self, query: str, collection_name: str, top_k: int, filters: dict[str, Any] | None
    ) -> list[Chunk]:
        from knowledge_layer.vector_store import search_chunks

        query_vector = self._embed_query_cached(query)
        lexical_text, terms = "", []
        if self.hybrid_search:
            lexical_text, terms = self._lexical_inputs(query, collection_name)
        hits = search_chunks(
            collection_name,
            office_id=office_for([collection_name]),
            vector=query_vector,
            lexical_text=lexical_text,
            top_k=top_k,
            filters=filters,
            exact_terms=terms,
            identity=self._identity(),
        )
        return [self._chunk_from_hit(hit) for hit in hits]

    async def search_grouped(
        self,
        query: str,
        collection_names: list[str],
        groups: int,
        group_size: int,
        filters: dict[str, Any] | None = None,
        boost: dict[str, Any] | None = None,
    ) -> list[tuple[str, list[Chunk]]]:
        return await asyncio.to_thread(
            self._search_grouped_sync, query, collection_names, groups, group_size, filters, boost
        )

    def _search_grouped_sync(
        self,
        query: str,
        collection_names: list[str],
        groups: int,
        group_size: int,
        filters: dict[str, Any] | None,
        boost: dict[str, Any] | None,
    ) -> list[tuple[str, list[Chunk]]]:
        from knowledge_layer.vector_store import search_grouped as qdrant_search_grouped

        self._ensure_initialized()
        lexical_text, terms = "", []
        if self.hybrid_search:
            lexical_text, terms = self._lexical_inputs(query, collection_names)
        grouped = qdrant_search_grouped(
            collection_names,
            office_id=office_for(collection_names),
            vector=self._embed_query_cached(query),
            lexical_text=lexical_text,
            groups=groups,
            group_size=group_size,
            identity=self._identity(),
            filters=filters,
            boost=boost,
            exact_terms=terms,
        )
        return [(scope, [self._grouped_chunk(hit) for hit in hits]) for scope, hits in grouped]

    def _grouped_chunk(self, hit: Any) -> Chunk:
        from agent.knowledge.base import FUSED_SCORE_KEY
        from agent.knowledge.base import LEXICAL_MATCH_KEY

        chunk = self._chunk_from_hit(hit)
        chunk.metadata.update({FUSED_SCORE_KEY: float(hit.fused), LEXICAL_MATCH_KEY: bool(hit.lexical)})
        return chunk

    def embed_query(self, text: str) -> list[float]:
        self._ensure_initialized()
        return self._embed_query_cached(text)

    def embedding_identity(self) -> dict[str, str]:
        return self._identity()

    def _lexical_inputs(self, query: str, collection_names: str | Sequence[str]) -> tuple[str, list[str]]:
        return lexical_inputs(query, collection_names, self._qdrant_term_df)

    def _chunk_from_hit(self, hit: Any) -> Chunk:
        from llama_index.core.schema import NodeWithScore
        from llama_index.core.schema import TextNode

        from knowledge_layer.vector_store import chunk_metadata

        node = TextNode(text=hit.text, id_=hit.chunk_id, metadata=chunk_metadata(hit.payload))
        return self.normalize(NodeWithScore(node=node, score=float(hit.cosine)))

    def normalize(self, raw_result: Any) -> Chunk:
        return chunk_from_node(raw_result)

    async def health_check(self) -> bool:
        from knowledge_layer.vector_store import healthy as qdrant_healthy

        return await asyncio.to_thread(qdrant_healthy)
