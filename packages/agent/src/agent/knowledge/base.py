import logging
import threading
import time
from abc import ABC
from abc import abstractmethod
from collections.abc import Callable
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC
from datetime import datetime
from datetime import timedelta
from typing import Any

from .schema import Chunk
from .schema import CollectionInfo
from .schema import FileInfo
from .schema import IngestionJobStatus
from .schema import RetrievalResult

logger = logging.getLogger(__name__)

SESSION_COLLECTION_PREFIX = "s_"

READING_ORDER = "reading_order"


def reading_order(page_label: Any) -> int:
    try:
        page = int(page_label)
    except TypeError, ValueError:
        return 0
    return page if page >= 1 else 0


def metadata_int(metadata: Mapping[str, Any] | None, key: str) -> int:
    raw = (metadata or {}).get(key)
    try:
        return int(str(raw).strip())
    except ValueError:
        return 0


def section_position(metadata: Mapping[str, Any] | None) -> tuple[int, int, int]:
    part = metadata_int(metadata, "table_part") or metadata_int(metadata, "section_part")
    return (metadata_int(metadata, "section_order"), metadata_int(metadata, "line_start"), part)


DocumentPosition = tuple[int, int, int, int, int, int, str]


def document_position(metadata: Mapping[str, Any] | None, chunk_id: Any) -> DocumentPosition:
    ordinal = (metadata or {}).get("chunk_ordinal")
    numbered = isinstance(ordinal, int) and not isinstance(ordinal, bool)
    return (
        reading_order((metadata or {}).get("page_label")),
        *section_position(metadata),
        0 if numbered else 1,
        ordinal if numbered else 0,
        str(chunk_id or ""),
    )


FUSED_SCORE_KEY = "fused_score"
LEXICAL_MATCH_KEY = "lexical_match"


@dataclass
class PreparedIngestJob:
    job_id: str
    status: IngestionJobStatus
    file_paths: list[Any]
    collection_name: str
    config: dict[str, Any]

    @property
    def organization_id(self) -> str | None:
        value = self.config.get("organization_id")
        return value if isinstance(value, str) and value else None

    @property
    def priority(self) -> str:
        return "bulk" if self.config.get("priority") == "bulk" else "interactive"


class TTLCleanupMixin:
    _ttl_hours: float
    _cleanup_interval_seconds: int

    def _start_ttl_cleanup_task(self, ttl_hours: float, interval_seconds: int) -> None:
        self._ttl_hours = ttl_hours
        self._cleanup_interval_seconds = interval_seconds

        thread = threading.Thread(
            target=self._ttl_cleanup_loop,
            daemon=True,
            name=f"{self.backend_name}-ttl-cleanup",
        )
        thread.start()
        logger.info(
            f"Started collection TTL cleanup task for {self.backend_name} "
            f"(runs every {interval_seconds}s, TTL={ttl_hours}h)"
        )

    def _ttl_cleanup_loop(self) -> None:
        while True:
            try:
                time.sleep(self._cleanup_interval_seconds)
                self._cleanup_expired_collections()
            except Exception as e:
                logger.error(f"TTL cleanup loop error for {self.backend_name}: {e}")

    _TTL_CLEANUP_LOCK_ID = 0x41495154_544C434C

    def _cleanup_expired_collections(self) -> None:
        from .leader_lock import leader_lock

        with leader_lock(self._TTL_CLEANUP_LOCK_ID) as is_leader:
            if not is_leader:
                logger.debug("TTL cleanup (%s): another replica holds the lock; skipping", self.backend_name)
                return
            self._run_cleanup_expired_collections()

    def _run_cleanup_expired_collections(self) -> None:
        try:
            collections = self.list_collections()
            logger.info(f"TTL cleanup ({self.backend_name}): checking {len(collections)} collections for expiration")
            now = datetime.now(UTC)
            ttl_threshold = now - timedelta(hours=self._ttl_hours)

            for collection in collections:
                if not collection.name.startswith(SESSION_COLLECTION_PREFIX):
                    logger.debug(
                        f"TTL cleanup ({self.backend_name}): skipping '{collection.name}' - "
                        f"not a session collection (no '{SESSION_COLLECTION_PREFIX}' prefix)"
                    )
                    continue

                if collection.updated_at is None:
                    logger.debug(f"TTL cleanup ({self.backend_name}): skipping '{collection.name}' - no timestamp")
                    continue

                updated_at = collection.updated_at
                if updated_at.tzinfo is None:
                    updated_at = updated_at.replace(tzinfo=UTC)

                logger.debug(
                    f"TTL cleanup ({self.backend_name}): '{collection.name}' "
                    f"updated_at={collection.updated_at}, threshold={ttl_threshold}, "
                    f"expired={updated_at < ttl_threshold}"
                )

                if updated_at < ttl_threshold:
                    logger.info(
                        f"Collection '{collection.name}' expired (last indexed: {collection.updated_at}), deleting..."
                    )
                    if self.delete_collection(collection.name):
                        logger.info(
                            f"TTL cleanup ({self.backend_name}): deleted expired collection '{collection.name}'"
                        )
                    else:
                        logger.warning(
                            f"TTL cleanup ({self.backend_name}): failed to delete collection '{collection.name}'"
                        )

        except Exception as e:
            logger.error(f"Failed to cleanup expired collections for {self.backend_name}: {e}")


class BaseRetriever(ABC):
    def __init__(self, config: dict[str, Any] | None = None):
        self.config = config or {}

    @abstractmethod
    async def retrieve(
        self,
        query: str,
        collection_name: str,
        top_k: int = 10,
        filters: dict[str, Any] | None = None,
    ) -> RetrievalResult: ...

    async def warm_query(self, query: str) -> None:
        return None

    async def search_grouped(
        self,
        query: str,
        collection_names: list[str],
        groups: int,
        group_size: int,
        filters: dict[str, Any] | None = None,
        boost: dict[str, Any] | None = None,
    ) -> list[tuple[str, list[Chunk]]]:
        raise NotImplementedError(f"{self.backend_name} cannot rank across collections in one query")

    def embed_query(self, text: str) -> list[float]:
        raise NotImplementedError(f"{self.backend_name} embeds no queries for a caller")

    def embedding_identity(self) -> dict[str, str]:
        return {}

    async def find_text(
        self,
        collection_name: str,
        pattern: str,
        filters: dict[str, Any] | None = None,
        limit: int = 500,
    ) -> list[Chunk] | None:
        return None

    async def fetch(
        self,
        collection_name: str,
        filters: dict[str, Any] | None,
        limit: int,
        order_by: str | None = None,
        start_from: DocumentPosition | None = None,
    ) -> list[Chunk] | None:
        return None

    @abstractmethod
    def normalize(self, raw_result: Any) -> Chunk: ...

    @property
    @abstractmethod
    def backend_name(self) -> str: ...

    async def health_check(self) -> bool:
        return True  # NOSONAR


class BaseIngestor(ABC):
    def __init__(self, config: dict[str, Any] | None = None):
        self.config = config or {}

    @abstractmethod
    def submit_job(
        self,
        file_paths: list[str | Callable[[], str]],
        collection_name: str,
        config: dict[str, Any] | None = None,
    ) -> str: ...

    @abstractmethod
    def get_job_status(self, job_id: str) -> IngestionJobStatus | None: ...

    supports_durable_jobs = False

    def prepare_job(
        self,
        file_paths: list[str | Callable[[], str]],
        collection_name: str,
        config: dict[str, Any] | None = None,
        job_id: str | None = None,
    ) -> PreparedIngestJob:
        raise NotImplementedError

    def submit_prepared(self, prepared: PreparedIngestJob) -> None:
        raise NotImplementedError

    def run_prepared(self, prepared: PreparedIngestJob, still_owner: Callable[[], bool] | None = None) -> None:
        raise NotImplementedError

    def find_live_job(self, dispatch_key: str) -> str | None:
        return None

    @property
    @abstractmethod
    def backend_name(self) -> str: ...

    @abstractmethod
    def create_collection(
        self,
        name: str,
        description: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> CollectionInfo: ...

    @abstractmethod
    def delete_collection(self, name: str) -> bool: ...

    @abstractmethod
    def list_collections(self) -> list[CollectionInfo]: ...

    @abstractmethod
    def get_collection(self, name: str) -> CollectionInfo | None: ...

    @abstractmethod
    def upload_file(
        self,
        file_path: str,
        collection_name: str,
        metadata: dict[str, Any] | None = None,
    ) -> FileInfo: ...

    @abstractmethod
    def delete_file(self, file_id: str, collection_name: str, *, permanent: bool = False) -> bool: ...

    def delete_files(
        self,
        file_ids: list[str],
        collection_name: str,
        *,
        permanent: bool = False,
    ) -> dict[str, Any]:
        successful, not_found, failed = [], [], []

        for file_id in file_ids:
            try:
                if self.delete_file(file_id, collection_name, permanent=permanent):
                    successful.append(file_id)
                else:
                    not_found.append(file_id)
            except Exception as e:
                failed.append({"file_id": file_id, "error": str(e)})

        return {
            "message": f"Deleted {len(successful)} of {len(file_ids)} files",
            "successful": successful,
            "not_found": not_found,
            "failed": failed,
            "total_deleted": len(successful),
        }

    @abstractmethod
    def list_files(self, collection_name: str) -> list[FileInfo]: ...

    @abstractmethod
    def get_file_status(self, file_id: str, collection_name: str) -> FileInfo | None: ...

    def select_sources(self, source_names: list[str]) -> bool:
        raise NotImplementedError(
            f"{self.backend_name} does not support source selection. Override this method if your backend supports it."
        )

    def get_selected_sources(self) -> list[str]:
        raise NotImplementedError(
            f"{self.backend_name} does not support source selection. Override this method if your backend supports it."
        )

    def generate_summary(self, text_content: str, file_name: str) -> str | None:
        return None

    def get_document_visual_details(self, collection_name: str, file_name: str) -> list[dict[str, Any]]:
        return []

    async def health_check(self) -> bool:
        return True  # NOSONAR
