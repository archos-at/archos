import asyncio
import logging
import os
from collections.abc import Sequence
from typing import Any
from typing import Literal

from pydantic import Field
from pydantic import model_validator

from agent.common.tool_calls import CONCLUSION_ARG
from agent.common.tool_calls import CONCLUSION_DESCRIPTION
from knowledge_layer.search import KnowledgeSearch
from nat.plugin_api import Builder
from nat.plugin_api import FunctionBaseConfig
from nat.plugin_api import FunctionInfo
from nat.plugin_api import register_function

logger = logging.getLogger(__name__)

SCOPE_PARAGRAPH = (
    "Inputs: `query`, a search query in the documents' language (topic, jurisdiction, year), not the raw user "
    "message. Narrow with `file_name=` (an indexed name from the inventory or the user; never invent one), "
    "`folder=` (a path as the inventory prints it after 'Ordner:'; includes everything filed beneath it; never "
    "invent one), `doc_class=` (Dokumentart key, e.g. oib_guideline), `title_contains=`, and `shelf=` (project, "
    "office or base; omitted, every shelf is read), or with `path=` as a hit's `Path:` line names a place, a "
    "folder or one file. "
)


CONCLUSION_LINE = f"\n`{CONCLUSION_ARG}=`: {CONCLUSION_DESCRIPTION}"


_KNOWLEDGE_SEARCH_DESCRIPTION = (
    "Searches the ingested knowledge base (the office's files and the OIB corpus) and returns quotable "
    "passages, each with a Citation key: the evidence tool. It does not put a file on screen "
    "(`surface_documents` does).\n"
    + SCOPE_PARAGRAPH
    + '`group_by="document"` (ranked search only) returns one entry per document: its best passage and how many '
    "passages of the ranked pool it held.\n"
    '`match="exact"` returns EVERY passage that contains the query literally, plus a table of the matching files '
    "with count and pages, and shows a term is written nowhere. Several spellings go in one query separated by "
    "'|'; case, ä/ae, ß/ss and a line break, space or hyphen between words are matched for you; a term of two "
    "or three characters matches as a whole word only. `stemmed=true` also finds inflected forms. Per shelf it "
    "states how many documents were searched and how many matched.\n"
    '`match="regex"` is the same search with a regex in Python syntax, case-insensitive, for a '
    "pattern (a Geschäftszahl `MA 37/\\d{6}`, a fire door `\\bT30-\\d+`); `|` is then regex alternation. "
    "It needs one literal whole word or number it must contain (`37`, `T30`), or a `folder=`, `file_name=` or "
    "`doc_class=` to read in; a pattern that backtracks is refused. `context=` (0 to 3) adds the lines around "
    "every hit. A search that stops at its limit says so, and its counts are then lower bounds.\n"
    "Returns: numbered passages with Source, Citation (cite this key verbatim), Dokumentart, Ordner, page and "
    "text. A query that names a Richtlinie and nothing else ('OIB 2') returns every part of it the corpus "
    "holds, each with its Geltungsbereich and Gliederung: every member is then open at the level a read of one "
    "document opens it, and what is left to open is a Punkt by number." + CONCLUSION_LINE
)


_EXACT_PARAGRAPH = _KNOWLEDGE_SEARCH_DESCRIPTION[
    _KNOWLEDGE_SEARCH_DESCRIPTION.index('`match="exact"`') : _KNOWLEDGE_SEARCH_DESCRIPTION.index('`match="regex"`')
]


_REGEX_PARAGRAPH = _KNOWLEDGE_SEARCH_DESCRIPTION[
    _KNOWLEDGE_SEARCH_DESCRIPTION.index('`match="regex"`') : _KNOWLEDGE_SEARCH_DESCRIPTION.index("Returns: numbered")
]


def knowledge_search_description(match_modes: Sequence[str], scope: str | None = None) -> str:
    modes = set(match_modes)
    text = _KNOWLEDGE_SEARCH_DESCRIPTION
    if scope is not None:
        text = text.replace(SCOPE_PARAGRAPH, scope).replace(CONCLUSION_LINE, "")
    if "exact" not in modes:
        text = text.replace(_EXACT_PARAGRAPH, "")
    if "regex" not in modes:
        text = text.replace(_REGEX_PARAGRAPH, "")
    return text


def result_budget(top_k: int, max_per_document: int) -> str:
    if max_per_document > 0:
        diversity = (
            f"spread across multiple distinct documents (at most {max_per_document} per document "
            "where possible), so cross-cutting questions see every relevant Richtlinie."
        )
    else:
        diversity = "ranked purely by relevance, with no per-document diversity cap."
    return (
        f"Returns up to {top_k} excerpts by default (platform-configurable up to 50; the result header counts "
        f"them), {diversity}"
    )


BACKEND = "llamaindex"


class KnowledgeRetrievalConfig(FunctionBaseConfig, name="knowledge_retrieval"):
    collection_name: str = Field(default="default", description="Name of the collection/index to search")
    use_fixed_collection: bool = Field(
        default=False,
        description=(
            "When true, always search the configured collection_name and ignore the per-session "
            "conversation_id collection. Use for fixed, persistent corpora."
        ),
    )
    include_base_collection: bool = Field(
        default=False,
        description=(
            "Always include the configured base collection_name in the search set (e.g. the fixed OIB corpus)."
        ),
    )
    include_session_collection: bool = Field(
        default=True,
        description=(
            "Also search the per-session collection (Context.conversation_id) when available, "
            "so per-conversation uploads are searched."
        ),
    )
    project_collections: list[str] = Field(
        default_factory=list,
        description=(
            "Additional named persistent collections (e.g. project-scoped corpora) to always include in the search set."
        ),
    )
    top_k: int = Field(default=5, description="Number of results to return")
    max_chunks_per_document: int = Field(
        default=2,
        ge=0,
        description=(
            "Diversity cap: at most this many chunks from a single document are included before "
            "other documents get a slot; any remaining slots up to top_k are then filled with the "
            "highest-scoring chunks regardless of source. Prevents one high-scoring PDF from "
            "crowding out other documents on cross-cutting questions. 0 disables the cap."
        ),
    )
    exclude_file_names: list[str] = Field(
        default_factory=list,
        description=(
            "File names whose chunks are excluded from results of the base collection "
            "(e.g. OIB Änderungsdokumente and superseded editions). Applied as a "
            "metadata filter (file_name NOT IN ...) on the base collection only; "
            "session and project collections are never filtered."
        ),
    )
    generate_summary: bool = Field(
        default=False, description="Generate one-sentence summary for each ingested document"
    )
    summary_model: str | None = Field(
        default=None,
        description="Required when generate_summary=true: LLM reference from llms: section",
    )
    summary_db: str = Field(
        default="sqlite+aiosqlite:///./summaries.db",
        description="Database URL for document summaries (SQLite or PostgreSQL)",
    )
    match_modes: list[str] = Field(
        default_factory=lambda: ["meaning", "exact", "regex"],
        description=(
            "EVAL KNOB, not a product setting: the `match=` modes the search accepts on the bindings that "
            "offer `match` (deep research, intake). The answer suite's `semantic` arm keeps only `meaning`; "
            "Piloti's chat binds ranked search only since ADR-0133 slice 6, so its `grep` arm unbinds the "
            "search instead of narrowing it. A comma-separated string is read as a list, which is how "
            "`nat run --override` hands one over. Production keeps the default: every mode."
        ),
    )
    hybrid_search: bool | None = Field(
        default=None,
        description=(
            "Enable the lexical channels beside the dense one (German BM25 and the exact-term "
            "phrase channels, fused in Qdrant by reciprocal rank fusion). "
            "None = environment default HYBRID_RETRIEVAL (on)."
        ),
    )
    rerank_llm: str | None = Field(
        default=None,
        description=(
            "Optional LLM reference from llms: section used to re-rank retrieved chunks "
            "against the query (LLM-judge reranking; fail-open to the original order)."
        ),
    )
    reranker_provider: str | None = Field(
        default=None,
        description=(
            "Cross-encoder reranking provider (none|openrouter|jev). `jev` scores one decision-model "
            "noul per candidate (ADR-0064), an option to evaluate beside the cross-encoder. "
            "None falls back to the RERANKER_PROVIDER environment default, which is "
            "'none'. When one resolves it becomes the primary reranker and rerank_llm "
            "becomes the fallback; a missing key or any provider error degrades to the judge."
        ),
    )
    reranker_model: str | None = Field(
        default=None,
        description=(
            "Cross-encoder model id (default qwen/qwen3-reranker-8b: multilingual, which a German corpus "
            "needs, and with a zero-data-retention endpoint, which every rerank is pinned to)."
        ),
    )
    rerank_candidates: int = Field(
        default=15,
        ge=1,
        description=(
            "How many candidate chunks to over-fetch and re-rank when rerank_llm is set. "
            "Reranking converts recall into precision, so this should exceed top_k by "
            "several times, not by a margin. Must be >= 1: zero used to be accepted and "
            "trimmed every search to nothing."
        ),
    )
    requery_llm: str | None = Field(
        default=None,
        description=(
            "Optional LLM reference from llms: section that judges whether the fused "
            "candidate pool can answer the query and, when it cannot, proposes alternative "
            "formulations that are retrieved and fused into the same pool before reranking "
            "(the retrieval loop). Runs beside the reranker, so a sufficient pool costs no "
            "extra latency. Unset = one-shot retrieval. Fail-open: any judge error keeps "
            "the first pool."
        ),
    )
    requery_max_queries: int = Field(
        default=2,
        ge=1,
        le=4,
        description=(
            "Ceiling on alternative queries the judge may propose per search when "
            "requery_llm is set. Each is one retrieval per in-scope collection."
        ),
    )
    requery_decider: str = Field(
        default="llm",
        description=(
            "Who answers the judge's yes/no (llm|jev). `jev` asks the decision model one noul per "
            "passage of the head first (ADR-0064, ~300 ms, a fraction of a cent): a head it finds "
            "sufficient costs no judge call, and only an insufficient head runs requery_llm, for the "
            "phrasings. A decision that cannot run (no key, a BYOK key on another host, breaker open) falls "
            "back to the judge."
        ),
    )
    decision_sufficiency_threshold: float = Field(
        default=0.55,
        ge=0.0,
        le=1.0,
        description=(
            "With requery_decider=jev: the head is sufficient when any passage's p(answers the question) "
            "reaches this. Lower = fewer requeries; the decision eval sweeps it."
        ),
    )
    hyde_enabled: bool = Field(
        default=False,
        description=(
            "HyDE-as-channel experiment (backlog item 14), default OFF. When true, a "
            "query with no exact identifier shape drafts a hypothetical norm-register "
            "passage that is retrieved and fused as one extra RRF channel beside the "
            "original query (which always stays in the mix and is what the reranker "
            "judges). The draft reuses the resolved rerank_llm handle — greedy, "
            "reasoning-free, already paid for — so enabling this adds no model "
            "plumbing and re-points no model. Draft failure/slowness degrades to the "
            "baseline silently. Ship as default behaviour only if the golden harness "
            "shows an overview lift with no exact-id/paraphrase regression."
        ),
    )
    drop_ocr_noise: bool | None = Field(
        default=None,
        description=(
            "Leave text passages that are OCR debris (a scanned drawing's text layer: rotated labels one "
            "glyph group per line, spaced capitals one letter per token; `chunk_noise`) out of the ranked "
            "pool, before the reranker and the per-document cap, so their slots go to real passages. "
            'Never touches `match="exact"`/`"regex"`. None = environment default DROP_OCR_NOISE '
            "(off). Switch it on only after the answer suite has measured it."
        ),
    )
    hyde_timeout_seconds: float = Field(
        default=8.0,
        ge=1.0,
        le=30.0,
        description=(
            "Upper bound on the HyDE draft call. It runs beside the first retrieval "
            "fan-out, so a fast draft costs no latency; past this it reads as no "
            "draft and the search is the baseline."
        ),
    )

    @model_validator(mode="before")
    @classmethod
    def read_match_modes(cls, data):
        if isinstance(data, dict) and isinstance(data.get("match_modes"), str):
            data = {**data, "match_modes": [mode.strip() for mode in data["match_modes"].split(",") if mode.strip()]}
        return data

    @model_validator(mode="after")
    def keep_ranked_search(self):
        if "meaning" not in self.match_modes:
            raise ValueError("match_modes must keep `meaning`; a literal-only arm unbinds the search for `grep`.")
        return self

    @model_validator(mode="after")
    def validate_summary_config(self):
        if self.generate_summary and not self.summary_model:
            raise ValueError(
                "generate_summary=true requires summary_model to be set. "
                "Configure summary_model to reference an LLM from the llms: section."
            )
        return self


def _setup_backend(config: KnowledgeRetrievalConfig, summary_llm_obj=None) -> tuple[str, dict]:
    from knowledge_layer.ingest import LlamaIndexIngestor  # noqa: F401
    from knowledge_layer.search import LlamaIndexRetriever  # noqa: F401

    backend_config: dict = {
        "generate_summary": config.generate_summary,
        "summary_llm": summary_llm_obj,
    }
    if config.hybrid_search is not None:
        backend_config["hybrid_search"] = config.hybrid_search

    os.environ["KNOWLEDGE_RETRIEVER_BACKEND"] = BACKEND
    os.environ["KNOWLEDGE_INGESTOR_BACKEND"] = BACKEND

    return BACKEND, backend_config


def _warm_search_path_sync(retriever: Any) -> None:
    warm = getattr(retriever, "warm_components", None)
    if callable(warm):
        warm()
    import agent.observability.retrieval_trace  # noqa: F401 - warm-up import
    from knowledge_layer.browse import list_files  # noqa: F401 - warm-up import
    from knowledge_layer.read_passage import read_passage  # noqa: F401 - warm-up import
    from knowledge_layer.search import folder_routes  # noqa: F401 - warm-up import
    from knowledge_layer.search import judge_sufficiency  # noqa: F401 - warm-up import


async def _warm_search_path(retriever: Any) -> None:
    import time

    started = time.perf_counter()
    try:
        await asyncio.to_thread(_warm_search_path_sync, retriever)
    except Exception:  # noqa: BLE001 - a warm-up is worth less than the boot
        logger.warning("Knowledge search warm-up failed; the first search initialises instead", exc_info=True)
        return
    logger.info("Knowledge search warmed at build in %.0f ms", 1000 * (time.perf_counter() - started))


def _get_retriever(config: KnowledgeRetrievalConfig):
    from agent.knowledge.factory import get_retriever

    backend, backend_config = _setup_backend(config)
    retriever = get_retriever(backend, backend_config)
    logger.info("Initialized %s retriever", backend)
    return retriever


def _initialize_ingestor(config: KnowledgeRetrievalConfig, summary_llm_obj=None):
    from agent.knowledge.factory import get_ingestor
    from agent.knowledge.factory import set_active_ingestor

    backend, backend_config = _setup_backend(config, summary_llm_obj)
    ingestor = get_ingestor(backend, backend_config)
    set_active_ingestor(ingestor)
    logger.info("Activated %s ingestor for Knowledge API", backend)
    return ingestor


async def _platform_llm(builder: Builder, ref):
    from agent.common import get_langchain_llm
    from agent.common.openrouter import PLATFORM_FIXED
    from agent.common.openrouter import pin_chat_model

    return pin_chat_model(await get_langchain_llm(builder, ref), PLATFORM_FIXED)


async def _judge_models(config: KnowledgeRetrievalConfig, builder: Builder) -> tuple[Any, Any]:
    rerank_llm_obj = None
    if config.rerank_llm:
        try:
            rerank_llm_obj = await _platform_llm(builder, config.rerank_llm)
            logger.info("Resolved rerank model: %s", config.rerank_llm)
        except Exception as e:
            logger.warning(f"Could not resolve rerank_llm '{config.rerank_llm}', reranking disabled: {e}")
    requery_llm_obj = None
    if config.requery_llm:
        if config.requery_llm == config.rerank_llm and rerank_llm_obj is not None:
            requery_llm_obj = rerank_llm_obj
        else:
            try:
                requery_llm_obj = await _platform_llm(builder, config.requery_llm)
                logger.info("Resolved requery model: %s", config.requery_llm)
            except Exception as e:
                logger.warning(f"Could not resolve requery_llm '{config.requery_llm}', retrieval loop disabled: {e}")
    return rerank_llm_obj, requery_llm_obj


def _cross_encoder(config: KnowledgeRetrievalConfig):
    try:
        from knowledge_layer.search import resolve_cross_encoder

        return resolve_cross_encoder(config.reranker_provider, model=config.reranker_model)
    except Exception as e:
        logger.warning(f"Cross-encoder reranker unavailable ({type(e).__name__}: {e}); using the LLM judge")
        return None


async def _bound_retriever(config: KnowledgeRetrievalConfig, summary_llm_obj) -> Any:
    from agent.knowledge.factory import configure_summary_db
    from agent.knowledge.factory import set_search_retriever
    from agent.knowledge.norm_store import configure_norm_store

    configure_summary_db(config.summary_db)
    configure_norm_store(config.summary_db)
    retriever = _get_retriever(config)
    set_search_retriever(retriever)
    await _warm_search_path(retriever)
    _initialize_ingestor(config, summary_llm_obj)
    return retriever


@register_function(config_type=KnowledgeRetrievalConfig)
async def knowledge_retrieval(config: KnowledgeRetrievalConfig, _builder: Builder):
    summary_llm_obj = None
    if config.summary_model and config.generate_summary:
        summary_llm_obj = await _platform_llm(_builder, config.summary_model)
        logger.info("Resolved summary model: %s", config.summary_model)
    rerank_llm_obj, requery_llm_obj = await _judge_models(config, _builder)
    hyde_armed = bool(config.hyde_enabled and rerank_llm_obj is not None)
    logger.info("HyDE channel: %s", "armed (draft via rerank_llm)" if hyde_armed else "disabled")
    retriever = await _bound_retriever(config, summary_llm_obj)
    engine = KnowledgeSearch(
        config,
        retriever,
        rerank_llm=rerank_llm_obj,
        requery_llm=requery_llm_obj,
        cross_encoder=_cross_encoder(config),
    )
    top_k = config.top_k
    max_per_document = config.max_chunks_per_document
    logger.info(
        "Knowledge retrieval initialized: backend=%s, collection=%s, top_k=%d", BACKEND, config.collection_name, top_k
    )

    async def search(
        query: str,
        filters: dict | None = None,
        doc_class: str | None = None,
        title_contains: str | None = None,
        file_name: str | None = None,
        folder: str | None = None,
        match: str = "meaning",
        context: int | str | None = None,
        group_by: Literal["document"] | None = None,
        stemmed: bool = False,
        shelf: str | None = None,
        document_type: str | None = None,
        refers_to: str | None = None,
        conclusion: str = "",
        path: str | None = None,
    ) -> str:
        return await engine.search(
            query,
            filters=filters,
            doc_class=doc_class,
            title_contains=title_contains,
            file_name=file_name,
            folder=folder,
            match=match,
            context=context,
            group_by=group_by,
            stemmed=stemmed,
            shelf=shelf,
            document_type=document_type,
            refers_to=refers_to,
            path=path,
        )

    try:
        yield FunctionInfo.from_fn(
            search,
            description=f"{knowledge_search_description(config.match_modes)} {result_budget(top_k, max_per_document)}",
        )
    finally:
        from agent.knowledge.factory import clear_search_retriever

        clear_search_retriever(retriever)
