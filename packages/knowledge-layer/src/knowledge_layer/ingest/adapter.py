import logging
import os
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from agent.knowledge.base import BaseIngestor
from agent.knowledge.base import TTLCleanupMixin
from agent.knowledge.factory import register_ingestor
from agent.knowledge.schema import IngestionJobStatus
from knowledge_layer import dependencies
from knowledge_layer import embedding
from knowledge_layer.dependencies import retrieval_dependency_error
from knowledge_layer.embedding import EMBED_BATCH_SIZE
from knowledge_layer.embedding import EMBED_MAX_RETRIES
from knowledge_layer.embedding import EMBED_TIMEOUT_SECONDS
from knowledge_layer.embedding import embed_fingerprint_metadata
from knowledge_layer.env import env_int
from knowledge_layer.env import env_switch

from . import limits
from .collection_catalog import CollectionCatalog
from .document_reading import _generate_document_summary
from .file_ingest import FileIngest
from .file_versions import VersionReplacement
from .ingest_run import IngestRun
from .job_tracking import JobTracking
from .screening_steps import ContentScreening
from .thumbnails import Thumbnails
from .vision_credentials import DEFAULT_VLM_BASE_URL
from .vision_credentials import DEFAULT_VLM_MODEL

logger = logging.getLogger(__name__)


def _extraction_mode(*, tables: bool, charts: bool, images: bool) -> str:
    mode_parts = ["text"]
    if tables:
        mode_parts.append("tables")
    if charts:
        mode_parts.append("charts")
    if images:
        mode_parts.append("images")
    return " + ".join(mode_parts) if len(mode_parts) > 1 else "text-only"


@register_ingestor("llamaindex")
class LlamaIndexIngestor(
    JobTracking,
    ContentScreening,
    CollectionCatalog,
    VersionReplacement,
    Thumbnails,
    IngestRun,
    FileIngest,
    TTLCleanupMixin,
    BaseIngestor,
):
    DEFAULT_EMBED_MODEL = os.environ.get("EMBED_MODEL", "openai/text-embedding-3-large")

    DEFAULT_EMBED_BASE_URL = os.environ.get("EMBED_BASE_URL", "https://openrouter.ai/api/v1")

    DEFAULT_EXTRACT_TABLES = env_switch("EXTRACT_TABLES")

    INGEST_MAX_WORKERS = max(1, env_int("INGEST_MAX_WORKERS", 2))

    DEFAULT_EXTRACT_IMAGES = env_switch("EXTRACT_IMAGES")

    DEFAULT_EXTRACT_CHARTS = env_switch("EXTRACT_CHARTS")

    backend_name = "llamaindex"
    supports_durable_jobs = True

    def __init__(self, config: dict[str, Any] | None = None):
        super().__init__(config)

        self.embed_base_url = self.config.get("embed_base_url", self.DEFAULT_EMBED_BASE_URL)
        self.embed_model_name = self.config.get("embed_model", self.DEFAULT_EMBED_MODEL)
        self.chunk_size = self.config.get("chunk_size", 1024)
        self.chunk_overlap = self.config.get("chunk_overlap", 128)

        self.extract_tables = self.config.get("extract_tables", self.DEFAULT_EXTRACT_TABLES)
        self.extract_images = self.config.get("extract_images", self.DEFAULT_EXTRACT_IMAGES)
        self.extract_charts = self.config.get("extract_charts", self.DEFAULT_EXTRACT_CHARTS)
        self.vlm_model = self.config.get("vlm_model", DEFAULT_VLM_MODEL)
        self.vlm_base_url = self.config.get("vlm_base_url", DEFAULT_VLM_BASE_URL)

        self.generate_summary_enabled = self.config.get("generate_summary", False)
        self.summary_llm = self.config.get("summary_llm")

        self._jobs: dict[str, IngestionJobStatus] = {}
        self._lock = threading.RLock()
        self._persist_lock = threading.Lock()
        self._unpersisted: set[str] = set()
        self._unstored_at_prepare: set[str] = set()
        self._claim_guards: dict[str, Callable[[], bool]] = {}

        self._ingest_pool = ThreadPoolExecutor(self.INGEST_MAX_WORKERS, thread_name_prefix="llamaindex-ingest")

        self._embed_model = None
        self._initialized = False

        mode = _extraction_mode(tables=self.extract_tables, charts=self.extract_charts, images=self.extract_images)
        logger.info(f"LlamaIndexIngestor initialized: mode={mode}")

        self._start_ttl_cleanup_task(limits.COLLECTION_TTL_HOURS, limits.TTL_CLEANUP_INTERVAL_SECONDS)
        self._start_ingest_heartbeat()

    def _ensure_initialized(self):
        if self._initialized:
            return

        dependencies.ensure_retrieval_dependencies()

        try:
            embed_api_key = embedding.resolve_embed_api_key(self.embed_base_url, self.embed_model_name)
            if not embed_api_key:
                logger.error(
                    "No embeddings API key resolved (EMBED_API_KEY / "
                    "the provider key for EMBED_BASE_URL) - ingestion/retrieval will fail."
                )

            self._embed_model = embedding.make_embed_model(
                base_url=self.embed_base_url,
                model=self.embed_model_name,
                api_key=embed_api_key,
                embed_batch_size=EMBED_BATCH_SIZE,
                timeout=EMBED_TIMEOUT_SECONDS,
                max_retries=EMBED_MAX_RETRIES,
            )

            self._initialized = True
            logger.info(f"LlamaIndex components initialized with model: {self.embed_model_name}")

        except ImportError as e:
            raise retrieval_dependency_error(e) from e

    def _embed_fingerprint_metadata(self) -> dict[str, str]:
        return embed_fingerprint_metadata(self.embed_model_name, self.embed_base_url)

    def generate_summary(self, text_content: str, file_name: str) -> str | None:
        if not self.generate_summary_enabled:
            return None
        return _generate_document_summary(text_content, file_name, self.summary_llm)

    async def health_check(self) -> bool:
        return True
