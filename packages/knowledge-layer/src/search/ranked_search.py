import asyncio
import logging
from typing import Any

from knowledge_layer.search import family_branch
from knowledge_layer.search import fusion
from knowledge_layer.search import hit_metadata
from knowledge_layer.search import hyde
from knowledge_layer.search import results as search_results
from knowledge_layer.search import scope as search_scope
from knowledge_layer.search import span as search_span
from knowledge_layer.search import superseded as revisions

from .chunk_noise import noise_notice
from .document_groups import GROUP_OVERFETCH
from .document_groups import group_by_document
from .document_groups import render_document_groups

logger = logging.getLogger(__name__)

AGENT_FILTER_OVERFETCH = 3


class RankedSearch:

    def __init__(self, engine: Any, outcome: Any, args: Any, targets: list, base_collection: str, budgets: tuple):
        from knowledge_layer.vector_store import prefilter as qdrant_prefilter

        self.engine = engine
        self.outcome = outcome
        self.args = args
        self.targets = targets
        self.base_collection = base_collection
        self.top_k, self.max_per_document = budgets
        self.pushdown = qdrant_prefilter.plan(
            doc_class=args.doc_class,
            folder=args.folder,
            file_name=args.file_name,
            document_type=args.document_type,
            refers_to=args.refers_to,
        )
        self.candidate_k = self._candidate_k(
            qdrant_prefilter.post_filtered(title_contains=args.title_contains, file_name=args.file_name)
        )
        self.family_key = None
        self.family_task = None
        self.folder_task = None
        self.requery_skipped_reason: str | None = None
        self.requery_queries: list[str] = []
        self.requery_fired = False
        self.noise_left_out: frozenset[str] = frozenset()
        self.dropped_by_cap = 0
        self.dropped_by_floor = 0
        self.dropped_by_family = 0

    def _candidate_k(self, narrowed: bool) -> int:
        candidate_k = self.top_k * AGENT_FILTER_OVERFETCH if narrowed else self.top_k
        if self.engine.reranks:
            candidate_k = max(candidate_k, self.engine.config.rerank_candidates)
        if self.engine.drop_noise:
            candidate_k = max(candidate_k, self.top_k * AGENT_FILTER_OVERFETCH)
        if self.args.grouping:
            candidate_k = max(candidate_k, self.top_k * GROUP_OVERFETCH)
        return candidate_k

    @property
    def query(self) -> str:
        return self.args.query

    @property
    def dropped_as_noise(self) -> int:
        return len(self.noise_left_out)

    @property
    def user_collections(self) -> list[str]:
        return [entry.collection for entry in self.targets if entry.collection != self.base_collection]

    async def answer(self) -> str:
        await self._prepare()
        try:
            return await self._ranked()
        except Exception as e:
            from agent.common.tool_calls import FETCH_FAILED_MARKER

            logger.error(f"Knowledge search failed: {e}")
            self.outcome.failed = True
            return (
                f"{FETCH_FAILED_MARKER} Knowledge search failed for query={self.query!r}. "
                "Retry once with the same query; if it fails again, say you "
                "could not search the knowledge base and do not invent a citation. "
                f"Technical detail: {e}"
            )
        finally:
            for task in (self.family_task, self.folder_task):
                if task is not None and not task.done():
                    task.cancel()

    async def _prepare(self) -> None:
        self.superseded = await revisions.superseded_files(self.user_collections)
        self.hidden_revisions = {} if self.args.file_name else self.superseded
        self.retrieval_query = _cross_lingual_query(self.query)
        logger.info(
            "Knowledge search: query='%s...' collections=%s",
            self.query[:100],
            [(entry.collection, entry.shelf) for entry in self.targets],
        )
        self._start_side_reads()
        self.span_round = search_span.current_span_round()
        try:
            from knowledge_layer.search.requery import reset_requery_slot_for_turn

            reset_requery_slot_for_turn(self.span_round)
        except Exception:
            logger.debug("Requery slot reset skipped", exc_info=True)

    def _start_side_reads(self) -> None:
        from agent.common.norm_registry import family_query_number

        from .folder_channel import folder_routes

        args = self.args
        self.family_key = None if (args.file_name or args.folder or args.grouping) else family_query_number(self.query)
        if self.family_key:
            self.family_task = asyncio.create_task(family_branch.family_branch(self.targets, self.family_key))
        if not args.file_name:
            self.folder_task = asyncio.create_task(
                folder_routes(
                    self.engine.retriever,
                    self.user_collections,
                    self.retrieval_query,
                    folder=args.folder,
                    hint=self.query,
                )
            )

    async def _ranked(self) -> str:
        results, hyde_results = await self._first_retrieval()
        merged = self._fused([*results, *hyde_results])
        merged, self.noise_left_out = fusion.pool_without_noise(merged, enabled=self.engine.drop_noise)
        reranked, verdict = await asyncio.gather(self._reranked(merged.chunks), self._judged(merged.chunks))
        if verdict is not None and verdict.wants_requery:
            merged, reranked = await self._requery(verdict, results, merged, reranked)
        pool = list(merged.chunks)
        merged = merged.model_copy(update={"chunks": reranked})
        merged, groups_trailer = self._answer_budget(merged, pool)
        merged = self._relevance_floor(merged)
        coverage = await search_results.coverage_gap(
            self.query, merged, verdict, self.engine.config, widened=self.requery_fired
        )
        branch = await self.family_task if self.family_task is not None else family_branch.NO_FAMILY_BRANCH
        merged, overview = self._with_family(merged, branch)
        search_span.emit(self, merged, overview, coverage)
        return await self._rendered(merged, branch, overview, coverage, groups_trailer)

    async def _first_retrieval(self) -> tuple[list, list]:
        config = self.engine.config
        gathered = await asyncio.gather(
            *(self._retrieve_collection(entry) for entry in self.targets),
            hyde.draft_hyde_text(
                self.engine.rerank_llm,
                self.query,
                enabled=config.hyde_enabled,
                timeout_seconds=config.hyde_timeout_seconds,
            ),
            return_exceptions=True,
        )
        *results, hyde_text = gathered
        if isinstance(hyde_text, Exception) or not hyde_text:
            return results, []
        try:
            hyde_results = await asyncio.gather(
                *(self._retrieve_collection(entry, hyde_text) for entry in self.targets),
                return_exceptions=True,
            )
            logger.info("HyDE channel widened the pool with a %d-char draft for %r", len(hyde_text), self.query[:60])
            return results, hyde_results
        except Exception:  # noqa: BLE001 - the first ranking is always a valid answer
            logger.warning("HyDE fan-out failed; keeping the first pool", exc_info=True)
            return results, []

    async def _retrieve_collection(self, entry, search_query: str | None = None):
        from knowledge_layer.vector_store import prefilter as qdrant_prefilter

        coll = entry.collection
        retriever = self.engine.retriever
        coll_filters = (
            search_scope.base_collection_filters(self.engine.config, self.args.filters)
            if coll == self.base_collection
            else None
        )
        coll_filters = self.pushdown.narrow(coll_filters, user_shelf=coll != self.base_collection)
        result = await retriever.retrieve(
            query=search_query or self.retrieval_query,
            collection_name=coll,
            top_k=self.candidate_k,
            filters=coll_filters,
        )
        if self.hidden_revisions.get(coll) and getattr(result, "chunks", None):
            result = result.model_copy(
                update={"chunks": qdrant_prefilter.without_files(result.chunks, self.hidden_revisions[coll])}
            )
        _tag_with_collection(result, entry)
        if coll != self.base_collection:
            result = await self._with_named_file(entry, result)
        return result

    async def _with_named_file(self, entry, result):
        try:
            from agent.common.focus_file import get_focused_file_name

            focused = self.args.file_name or get_focused_file_name()
        except Exception:
            focused = self.args.file_name
        if not focused:
            return result
        try:
            named = await self.engine.retriever.retrieve(
                query=self.query,
                collection_name=entry.collection,
                top_k=self.candidate_k,
                filters={"file_name": {"$eq": focused}},
            )
            _tag_with_collection(named, entry)
            if getattr(named, "success", False) and named.chunks:
                result = result.model_copy(
                    update={"chunks": list(named.chunks) + list(getattr(result, "chunks", []) or [])}
                )
        except Exception:
            logger.debug("Named-file retrieve skipped for %s", entry.collection, exc_info=True)
        return result

    def _fused(self, channels: list):
        merged = fusion.merge_results(
            channels, self.query, self.candidate_k, self.engine.retriever.backend_name, max_per_document=0
        )
        args = self.args
        if args.doc_class or args.title_contains or args.file_name or args.folder:
            narrowed = hit_metadata.apply_agent_filters(
                merged.chunks,
                doc_class=args.doc_class,
                title_contains=args.title_contains,
                file_name=args.file_name,
                folder=args.folder,
            )
            return merged.model_copy(update={"chunks": narrowed})
        return merged.model_copy(update={"chunks": merged.chunks})

    async def _reranked(self, chunks):
        if not self.engine.reranks:
            return chunks
        from knowledge_layer.search.rerank import rerank_chunks

        rerank_top_n = max(self.top_k, self.engine.config.rerank_candidates)
        return await rerank_chunks(
            self.engine.rerank_llm,
            self.query,
            chunks,
            top_n=rerank_top_n,
            cross_encoder=self.engine.cross_encoder,
        )

    async def _judged(self, chunks):
        if self.engine.requery_llm is None or self.args.file_name:
            if self.args.file_name:
                self.requery_skipped_reason = "file_pinned"
            return None
        try:
            reason = await self._judge_skip_reason(chunks)
            if reason is not None:
                self.requery_skipped_reason = reason
                logger.info("Retrieval loop judge skipped (%s) for %r", reason, self.query[:60])
                return None
        except Exception:
            logger.debug("Requery gate failed open to the judge", exc_info=True)
        from knowledge_layer.search.requery import judge_sufficiency

        config = self.engine.config
        return await judge_sufficiency(
            self.engine.requery_llm,
            self.query,
            chunks,
            max_queries=config.requery_max_queries,
            decider=config.requery_decider,
            decision_threshold=config.decision_sufficiency_threshold,
        )

    async def _judge_skip_reason(self, chunks) -> str | None:
        from knowledge_layer.search.requery import requery_already_fired
        from knowledge_layer.search.requery import should_skip_judge

        if self.family_task is not None and (await self.family_task).overview is not None:
            return "family"
        if requery_already_fired():
            return "already_fired"
        args = self.args
        skip, reason = should_skip_judge(
            self.query,
            chunks,
            file_name=args.file_name,
            doc_class=args.doc_class,
            title_contains=args.title_contains,
            folder=args.folder,
            embedding_model=getattr(self.engine.retriever, "embed_model_name", None),
        )
        return reason if skip else None

    async def _requery(self, verdict, results, merged, reranked):
        try:
            from knowledge_layer.search.requery import claim_requery_slot

            if not claim_requery_slot():
                self.requery_skipped_reason = "already_fired"
                logger.info(
                    "Retrieval loop requery suppressed (already_fired): "
                    "one firing per turn already spent, keeping the first pool"
                )
                return merged, reranked
            from agent.common.retrieval_status import emit_retrieval_requery

            emit_retrieval_requery(query_count=len(verdict.queries))
            extra = await asyncio.gather(
                *(
                    self._retrieve_collection(entry, alternative)
                    for alternative in verdict.queries
                    for entry in self.targets
                ),
                return_exceptions=True,
            )
            widened = self._fused([*results, *extra])
            widened, widened_noise = fusion.pool_without_noise(widened, enabled=self.engine.drop_noise)
            reranked = await self._reranked(widened.chunks)
            self.noise_left_out = self.noise_left_out | widened_noise
            self.requery_queries = list(verdict.queries)
            self.requery_fired = True
            logger.info(
                "Retrieval loop widened the pool with %d alternative quer(y/ies) to %d candidate(s)",
                len(self.requery_queries),
                len(widened.chunks),
            )
            return widened, reranked
        except Exception:  # noqa: BLE001 - the first ranking is always a valid answer
            logger.warning("Retrieval loop fan-out failed; keeping the first pool", exc_info=True)
            return merged, reranked

    def _answer_budget(self, merged, pool) -> tuple[Any, str]:
        pre_cap_count = len(merged.chunks)
        groups_trailer = ""
        if self.args.grouping:
            every_group = group_by_document(merged.chunks, pool)
            groups = every_group[: self.top_k]
            capped = [group.best for group in groups]
            groups_trailer = render_document_groups(groups, sum(group.passages for group in every_group))
        else:
            capped = fusion.apply_diversity_cap(merged.chunks, self.top_k, self.max_per_document)
        self.dropped_by_cap = max(0, pre_cap_count - len(capped))
        return merged.model_copy(update={"chunks": capped}), groups_trailer

    def _relevance_floor(self, merged):
        from agent.common.retrieval_settings import get_retrieval_setting

        floor_pct = get_retrieval_setting("knowledge.relevance_floor_pct", 0)
        if floor_pct <= 0:
            return merged
        floor = floor_pct / 100.0
        kept = [chunk for chunk in merged.chunks if chunk.score >= floor]
        if len(kept) != len(merged.chunks):
            best = max((chunk.score for chunk in merged.chunks), default=0.0)
            logger.info(
                "Relevance floor %.2f dropped %d/%d chunks (best score %.2f)",
                floor,
                len(merged.chunks) - len(kept),
                len(merged.chunks),
                best,
            )
            self.dropped_by_floor = len(merged.chunks) - len(kept)
        return merged.model_copy(update={"chunks": kept})

    def _with_family(self, merged, branch):
        overview = branch.overview
        if not merged.success:
            overview = None
        if overview is None:
            return merged, None
        unaddressed = family_branch.without_chunks(merged.chunks, overview.chunks)
        ranked = unaddressed[: family_branch.FAMILY_RANKED_HITS]
        self.dropped_by_family = len(unaddressed) - len(ranked)
        return merged.model_copy(update={"chunks": [*overview.chunks, *ranked]}), overview

    def _notice(self, merged, branch) -> str:
        from knowledge_layer.search.requery import requery_notice

        notice = (
            revisions.hidden_revisions_notice(self.hidden_revisions)
            + revisions.named_older_revision_notice(self.args.file_name, self.superseded)
            + requery_notice(self.requery_queries)
            + noise_notice(self.dropped_as_noise)
        )
        if branch.failed and merged.chunks:
            notice += family_branch.FAMILY_OVERVIEW_FAILED_NOTICE.format(key=self.family_key)
        return notice

    async def _rendered(self, merged, branch, overview, coverage, groups_trailer: str) -> str:
        from agent.common.tool_calls import KNOWLEDGE_SEARCH_TOOL
        from agent.common.turn_status import lane_tool_scope

        notice = self._notice(merged, branch)
        folders_trailer = await self.folder_task if self.folder_task is not None else ""
        self.outcome.record_chunks(merged.chunks)
        degraded = not merged.success or bool(getattr(merged, "error_message", None))
        self.outcome.failed = not merged.chunks and degraded
        if not merged.chunks:
            if degraded:
                with lane_tool_scope(KNOWLEDGE_SEARCH_TOOL):
                    return notice + search_results.format_results(merged, self.query)
            args = self.args
            empty = search_results.empty_search_message(
                self.query,
                file_name=args.file_name,
                doc_class=args.doc_class,
                title_contains=args.title_contains,
                folder=args.folder,
            )
            return notice + empty + (f"\n\n{folders_trailer}" if folders_trailer else "")
        trailer = "\n\n".join(
            part for part in (overview.trailer if overview is not None else "", groups_trailer, folders_trailer) if part
        )
        with lane_tool_scope(KNOWLEDGE_SEARCH_TOOL):
            formatted = await asyncio.to_thread(
                search_results.format_results,
                merged,
                self.query,
                notice,
                trailer,
                overview.preamble if overview is not None else "",
                overview.opened_files if overview is not None else frozenset(),
                coverage_gap=coverage.reason() if coverage is not None else None,
            )
        logger.info(f"Knowledge search returned {len(merged.chunks)} chunks")
        logger.debug(f"Formatted result for LLM:\n{formatted[:500]}...")
        return formatted


def _cross_lingual_query(query: str) -> str:
    from agent.common.query_expansion import augmented_query

    retrieval_query = augmented_query(query)
    if retrieval_query != query:
        logger.info("Query expanded for retrieval: %r -> %r", query[:60], retrieval_query[:80])
    return retrieval_query


def _tag_with_collection(result, entry) -> None:
    for chunk in getattr(result, "chunks", []) or []:
        chunk.metadata.setdefault("collection", entry.collection)
        if entry.shelf is not None:
            chunk.metadata.setdefault("shelf", str(entry.shelf))
