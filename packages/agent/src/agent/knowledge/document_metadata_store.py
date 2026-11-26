from __future__ import annotations

import threading
from collections.abc import Callable
from typing import TYPE_CHECKING
from typing import Any

from agent.common.db_utils import normalize_db_url as _normalize_db_url
from agent.common.db_utils import redact_db_url
from agent.knowledge.document_classification import MAX_TOPIC_VOCABULARY

if TYPE_CHECKING:
    from .schema import AvailableDocument

from agent.knowledge import document_metadata_decode as decode_impl
from agent.knowledge import document_metadata_engines as engines_impl
from agent.knowledge import document_metadata_fields as fields_impl
from agent.knowledge import document_metadata_folders as folders_impl
from agent.knowledge import document_metadata_mail as mail_impl
from agent.knowledge import document_metadata_reads as reads_impl
from agent.knowledge import document_metadata_records as records_impl
from agent.knowledge import document_metadata_revisions as revisions_impl
from agent.knowledge import document_metadata_schema as schema_impl
from agent.knowledge import document_metadata_tags as tags_impl
from agent.knowledge.document_metadata_constants import _DOCUMENT_COLUMNS
from agent.knowledge.document_metadata_constants import _INDEX_NAME
from agent.knowledge.document_metadata_constants import _LEGACY_INDEX_NAME
from agent.knowledge.document_metadata_constants import _OFFICE_TIMEZONE
from agent.knowledge.document_metadata_constants import _OPTIONAL_COLUMN_TYPES
from agent.knowledge.document_metadata_constants import _OPTIONAL_COLUMNS
from agent.knowledge.document_metadata_constants import _RETAINED_COLUMNS
from agent.knowledge.document_metadata_constants import ENGINE_CACHE_MAX_SIZE
from agent.knowledge.document_metadata_constants import ENGINE_CACHE_TTL_SECONDS
from agent.knowledge.document_metadata_constants import LEGACY_RETAINED_TABLE_NAME
from agent.knowledge.document_metadata_constants import LEGACY_TABLE_NAME
from agent.knowledge.document_metadata_constants import REFUSAL_REASON
from agent.knowledge.document_metadata_constants import RETAINED_TABLE_NAME
from agent.knowledge.document_metadata_constants import SUGGESTION_BASES
from agent.knowledge.document_metadata_constants import TABLE_NAME
from agent.knowledge.document_metadata_constants import TAGS_SET_BY_PERSON
from agent.knowledge.document_metadata_constants import DocumentRef
from agent.knowledge.document_metadata_constants import logger
from agent.knowledge.document_metadata_helpers import LinkOutcome
from agent.knowledge.document_metadata_helpers import _current_doc_class
from agent.knowledge.document_metadata_helpers import _decode_page_count
from agent.knowledge.document_metadata_helpers import _encode_page_count
from agent.knowledge.document_metadata_helpers import _escape_like
from agent.knowledge.document_metadata_helpers import _kept_reason
from agent.knowledge.document_metadata_helpers import _link_lock_key
from agent.knowledge.document_metadata_helpers import _LinkRow
from agent.knowledge.document_metadata_helpers import _merged_suggestion
from agent.knowledge.document_metadata_helpers import _person_made_facts
from agent.knowledge.document_metadata_helpers import _refusal_record
from agent.knowledge.document_metadata_helpers import _set_columns
from agent.knowledge.document_metadata_helpers import _with_refusal
from agent.knowledge.document_metadata_helpers import dismissed_revision_ids
from agent.knowledge.document_metadata_helpers import dismissed_revisions

__all__ = [
    "DocumentMetadataStore",
    "DocumentRef",
    "ENGINE_CACHE_MAX_SIZE",
    "ENGINE_CACHE_TTL_SECONDS",
    "LEGACY_RETAINED_TABLE_NAME",
    "LEGACY_TABLE_NAME",
    "LinkOutcome",
    "REFUSAL_REASON",
    "RETAINED_TABLE_NAME",
    "SUGGESTION_BASES",
    "TABLE_NAME",
    "TAGS_SET_BY_PERSON",
    "_DOCUMENT_COLUMNS",
    "_INDEX_NAME",
    "_LEGACY_INDEX_NAME",
    "_LinkRow",
    "_OFFICE_TIMEZONE",
    "_OPTIONAL_COLUMNS",
    "_OPTIONAL_COLUMN_TYPES",
    "_RETAINED_COLUMNS",
    "_current_doc_class",
    "_decode_page_count",
    "_encode_page_count",
    "_escape_like",
    "_kept_reason",
    "_link_lock_key",
    "_merged_suggestion",
    "_normalize_db_url",
    "_person_made_facts",
    "_refusal_record",
    "_set_columns",
    "_with_refusal",
    "dismissed_revision_ids",
    "dismissed_revisions",
    "logger",
]


class DocumentMetadataStore:
    _async_engine_cache: dict[str, tuple[Any, float]] = {}
    _sync_engine_cache: dict[str, tuple[Any, float]] = {}
    _cache_lock = threading.Lock()
    _tables_initialized: set[str] = set()

    _link_lock = threading.Lock()

    def __init__(self, db_url: str):
        self.db_url = db_url
        self._sync_engine = self._get_or_create_sync_engine(db_url)
        self._ensure_table_sync()
        logger.info("DocumentMetadataStore initialized: %s", redact_db_url(db_url))

    _CAPTURE_TYPES: dict[str, type | tuple[type, ...]] = {
        "captured_at": str,
        "latitude": (int, float),
        "longitude": (int, float),
        "camera": str,
    }

    @classmethod
    def _get_or_create_sync_engine(cls, db_url: str):
        return engines_impl._get_or_create_sync_engine(cls, db_url)

    @classmethod
    def _get_or_create_async_engine(cls, db_url: str):
        return engines_impl._get_or_create_async_engine(cls, db_url)

    @classmethod
    def _cleanup_stale_engines(cls, cache: dict[str, tuple[Any, float]]):
        return engines_impl._cleanup_stale_engines(cls, cache)

    def _is_postgres(self) -> bool:
        return schema_impl._is_postgres(self)

    def _ensure_table_sync(self):
        return schema_impl._ensure_table_sync(self)

    @classmethod
    async def _ensure_table_async(cls, db_url: str):
        return await schema_impl._ensure_table_async(cls, db_url)

    def _run_schema(self, conn) -> None:
        return schema_impl._run_schema(self, conn)

    def _rename_legacy_doc_classes(self, conn) -> None:
        return schema_impl._rename_legacy_doc_classes(self, conn)

    def _create_retained_table(self, conn) -> None:
        return schema_impl._create_retained_table(self, conn)

    def _create_table(self, conn) -> None:
        return schema_impl._create_table(self, conn)

    def _add_column_if_missing(self, conn, column: str, ddl_type: str = "TEXT", *, table: str = TABLE_NAME) -> None:
        return schema_impl._add_column_if_missing(self, conn, column, ddl_type, table=table)

    def _ensure_index(self, conn) -> None:
        return schema_impl._ensure_index(self, conn)

    def register(
        self,
        collection: str,
        filename: str,
        summary: str,
        tags: list[str] | None = None,
        topics: list[str] | None = None,
        *,
        document_id: str | None = None,
    ) -> None:
        return records_impl.register(self, collection, filename, summary, tags, topics, document_id=document_id)

    def _take_back_retained(self, conn, collection: str, filename: str, *, document_id: str | None = None) -> None:
        return records_impl._take_back_retained(self, conn, collection, filename, document_id=document_id)

    @staticmethod
    def _closes_a_loop(
        conn,
        collection: str,
        older: str,
        newer: str | None,
        *,
        document_id: str | None = None,
        newer_id: str | None = None,
    ) -> bool:
        return records_impl._closes_a_loop(conn, collection, older, newer, document_id=document_id, newer_id=newer_id)

    @staticmethod
    def _forget_retained(conn, collection: str, filename: str, *, document_id: str | None = None) -> None:
        return records_impl._forget_retained(conn, collection, filename, document_id=document_id)

    def update_tags(
        self, collection: str, filename: str, tags: list[str] | None, *, document_id: str | None = None
    ) -> bool:
        return tags_impl.update_tags(self, collection, filename, tags, document_id=document_id)

    def set_tags_by_person(
        self, collection: str, filename: str, tags: list[str] | None, *, document_id: str | None = None
    ) -> bool:
        return tags_impl.set_tags_by_person(self, collection, filename, tags, document_id=document_id)

    def set_topics_by_person(
        self, collection: str, filename: str, topics: list[str] | None, *, document_id: str | None = None
    ) -> bool:
        return tags_impl.set_topics_by_person(self, collection, filename, topics, document_id=document_id)

    def get_person_tags_batch(
        self, collection: str, filenames: list[str], *, document_ids: list[str] | None = None
    ) -> dict[str, list[str]]:
        return tags_impl.get_person_tags_batch(self, collection, filenames, document_ids=document_ids)

    def get_person_topics_batch(
        self, collection: str, filenames: list[str], *, document_ids: list[str] | None = None
    ) -> dict[str, list[str]]:
        return tags_impl.get_person_topics_batch(self, collection, filenames, document_ids=document_ids)

    def get_topic_vocabulary(self, collection: str, limit: int = MAX_TOPIC_VOCABULARY) -> list[str]:
        return tags_impl.get_topic_vocabulary(self, collection, limit)

    def _set_person_list(
        self,
        collection: str,
        filename: str,
        column: str,
        values: list[str] | None,
        *,
        document_id: str | None = None,
    ) -> bool:
        return tags_impl._set_person_list(self, collection, filename, column, values, document_id=document_id)

    def _person_list_batch(
        self, collection: str, filenames: list[str], column: str, *, document_ids: list[str] | None = None
    ) -> dict[str, list[str]]:
        return tags_impl._person_list_batch(self, collection, filenames, column, document_ids=document_ids)

    def set_doc_class(
        self, collection: str, filename: str, doc_class: str | None, *, document_id: str | None = None
    ) -> bool:
        return fields_impl.set_doc_class(self, collection, filename, doc_class, document_id=document_id)

    def get_doc_class(self, collection: str, filename: str, *, document_id: str | None = None) -> str | None:
        return fields_impl.get_doc_class(self, collection, filename, document_id=document_id)

    def get_doc_classes_batch(
        self, collection: str, filenames: list[str], *, document_ids: list[str] | None = None
    ) -> dict[str, str]:
        return fields_impl.get_doc_classes_batch(self, collection, filenames, document_ids=document_ids)

    def set_doc_class_suggestion(
        self, collection: str, filename: str, doc_class: str | None, *, document_id: str | None = None
    ) -> bool:
        return fields_impl.set_doc_class_suggestion(self, collection, filename, doc_class, document_id=document_id)

    def get_doc_class_suggestions_batch(
        self, collection: str, filenames: list[str], *, document_ids: list[str] | None = None
    ) -> dict[str, str]:
        return fields_impl.get_doc_class_suggestions_batch(self, collection, filenames, document_ids=document_ids)

    def set_display_title(
        self, collection: str, filename: str, display_title: str | None, *, document_id: str | None = None
    ) -> bool:
        return fields_impl.set_display_title(self, collection, filename, display_title, document_id=document_id)

    def get_display_title(self, collection: str, filename: str, *, document_id: str | None = None) -> str | None:
        return fields_impl.get_display_title(self, collection, filename, document_id=document_id)

    def get_display_titles_batch(
        self, collection: str, filenames: list[str], *, document_ids: list[str] | None = None
    ) -> dict[str, str]:
        return fields_impl.get_display_titles_batch(self, collection, filenames, document_ids=document_ids)

    def set_folder_path(
        self, collection: str, filename: str, folder_path: str | None, *, document_id: str | None = None
    ) -> bool:
        return fields_impl.set_folder_path(self, collection, filename, folder_path, document_id=document_id)

    def get_folder_path(self, collection: str, filename: str, *, document_id: str | None = None) -> str | None:
        return fields_impl.get_folder_path(self, collection, filename, document_id=document_id)

    def get_folder_paths_batch(
        self, collection: str, filenames: list[str], *, document_ids: list[str] | None = None
    ) -> dict[str, str]:
        return fields_impl.get_folder_paths_batch(self, collection, filenames, document_ids=document_ids)

    def set_provenance(
        self, collection: str, filename: str, provenance: dict[str, str] | None, *, document_id: str | None = None
    ) -> bool:
        return fields_impl.set_provenance(self, collection, filename, provenance, document_id=document_id)

    def get_provenance(
        self, collection: str, filename: str, *, document_id: str | None = None
    ) -> dict[str, str] | None:
        return fields_impl.get_provenance(self, collection, filename, document_id=document_id)

    def set_capture(
        self, collection: str, filename: str, capture: dict[str, Any] | None, *, document_id: str | None = None
    ) -> bool:
        return fields_impl.set_capture(self, collection, filename, capture, document_id=document_id)

    def set_mail_thread(
        self, collection: str, filename: str, thread: dict[str, Any] | None, *, document_id: str | None = None
    ) -> bool:
        return mail_impl.set_mail_thread(self, collection, filename, thread, document_id=document_id)

    def set_mail_origin(
        self, collection: str, filename: str, origin: dict[str, Any] | None, *, document_id: str | None = None
    ) -> bool:
        return mail_impl.set_mail_origin(self, collection, filename, origin, document_id=document_id)

    def set_revision_facts(
        self, collection: str, filename: str, facts: dict[str, Any] | None, *, document_id: str | None = None
    ) -> bool:
        return fields_impl.set_revision_facts(self, collection, filename, facts, document_id=document_id)

    def set_reading(
        self,
        collection: str,
        filename: str,
        *,
        dossier: dict[str, Any] | None,
        references: list[dict[str, Any]] | None,
        coverage: dict[str, Any] | None,
        document_id: str | None = None,
    ) -> bool:
        return fields_impl.set_reading(
            self,
            collection,
            filename,
            dossier=dossier,
            references=references,
            coverage=coverage,
            document_id=document_id,
        )

    def set_page_count(
        self, collection: str, filename: str, page_count: int | None, *, document_id: str | None = None
    ) -> bool:
        return fields_impl.set_page_count(self, collection, filename, page_count, document_id=document_id)

    def get_page_count(self, collection: str, filename: str, *, document_id: str | None = None) -> int | None:
        return fields_impl.get_page_count(self, collection, filename, document_id=document_id)

    def set_file_name(
        self, collection: str, document_id: str, file_name: str, *, previous_file_name: str | None = None
    ) -> bool:
        return records_impl.set_file_name(
            self, collection, document_id, file_name, previous_file_name=previous_file_name
        )

    def set_superseded_by(
        self,
        collection: str,
        older: str,
        newer: str | None,
        *,
        document_id: str | None = None,
        newer_id: str | None = None,
    ) -> bool:
        return revisions_impl.set_superseded_by(
            self, collection, older, newer, document_id=document_id, newer_id=newer_id
        )

    def set_revision_suggestion(
        self, collection: str, filename: str, suggestion: dict[str, Any] | None, *, document_id: str | None = None
    ) -> bool:
        return revisions_impl.set_revision_suggestion(self, collection, filename, suggestion, document_id=document_id)

    def dismiss_revision_suggestion(
        self,
        collection: str,
        filename: str,
        older: str,
        *,
        document_id: str | None = None,
        older_id: str | None = None,
    ) -> bool:
        return revisions_impl.dismiss_revision_suggestion(
            self, collection, filename, older, document_id=document_id, older_id=older_id
        )

    def _rewrite_suggestion(
        self,
        collection: str,
        filename: str,
        rewrite: Callable[[dict[str, Any] | None], dict[str, Any] | None],
        *,
        document_id: str | None = None,
    ) -> bool:
        return revisions_impl._rewrite_suggestion(self, collection, filename, rewrite, document_id=document_id)

    def link_revision(
        self, collection: str, older: str, newer: str, *, older_id: str | None = None, newer_id: str | None = None
    ) -> LinkOutcome:
        return revisions_impl.link_revision(self, collection, older, newer, older_id=older_id, newer_id=newer_id)

    def _link_revision_locked(
        self, collection: str, older: str, newer: str, *, older_id: str | None = None, newer_id: str | None = None
    ) -> LinkOutcome:
        return revisions_impl._link_revision_locked(
            self, collection, older, newer, older_id=older_id, newer_id=newer_id
        )

    def _write_link(
        self,
        conn,
        collection: str,
        older: str,
        newer: str,
        rows: dict[str, _LinkRow],
        *,
        newer_name: str,
        newer_id: str | None = None,
    ) -> None:
        return revisions_impl._write_link(
            self, conn, collection, older, newer, rows, newer_name=newer_name, newer_id=newer_id
        )

    def set_change_summary(
        self,
        collection: str,
        filename: str,
        summary: str | None,
        basis: str | None,
        *,
        document_id: str | None = None,
    ) -> bool:
        return fields_impl.set_change_summary(self, collection, filename, summary, basis, document_id=document_id)

    def get_superseded_by_batch(
        self, collection: str, filenames: list[str], *, document_ids: list[str] | None = None
    ) -> dict[str, str]:
        return revisions_impl.get_superseded_by_batch(self, collection, filenames, document_ids=document_ids)

    def documents_linked_to(self, collection: str, newer: str, *, document_id: str | None = None) -> list[DocumentRef]:
        return revisions_impl.documents_linked_to(self, collection, newer, document_id=document_id)

    def files_linked_to(self, collection: str, newer: str, *, document_id: str | None = None) -> list[str]:
        return revisions_impl.files_linked_to(self, collection, newer, document_id=document_id)

    def get_superseded_files(self, collection: str) -> dict[str, str]:
        return revisions_impl.get_superseded_files(self, collection)

    def get_superseded_ids(self, collection: str) -> dict[str, str]:
        return revisions_impl.get_superseded_ids(self, collection)

    def get_revision_suggestions_batch(
        self, collection: str, filenames: list[str], *, document_ids: list[str] | None = None
    ) -> dict[str, str]:
        return revisions_impl.get_revision_suggestions_batch(self, collection, filenames, document_ids=document_ids)

    def rewrite_folder_paths(self, collection: str, from_path: str, to_path: str | None) -> int:
        return folders_impl.rewrite_folder_paths(self, collection, from_path, to_path)

    def rewrite_folder_paths_moved(
        self, collection: str, from_path: str, to_path: str | None
    ) -> tuple[int, list[DocumentRef]]:
        return folders_impl.rewrite_folder_paths_moved(self, collection, from_path, to_path)

    def _update_column(
        self, collection: str, filename: str, column: str, value: Any, *, document_id: str | None = None
    ) -> bool:
        return fields_impl._update_column(self, collection, filename, column, value, document_id=document_id)

    def _get_column(self, collection: str, filename: str, column: str, *, document_id: str | None = None) -> str | None:
        return fields_impl._get_column(self, collection, filename, column, document_id=document_id)

    def _get_column_batch(
        self, collection: str, filenames: list[str], column: str, *, document_ids: list[str] | None = None
    ) -> dict[str, str]:
        return fields_impl._get_column_batch(self, collection, filenames, column, document_ids=document_ids)

    def find_tmp_upload_names(self, collection: str, filenames: list[str]) -> list[str]:
        return fields_impl.find_tmp_upload_names(self, collection, filenames)

    def list_collections(self) -> list[str]:
        return fields_impl.list_collections(self)

    @staticmethod
    def _decode_tags(raw: Any) -> list[str] | None:
        return decode_impl._decode_tags(raw)

    @staticmethod
    def _decode_json(raw: Any, kind: type) -> Any:
        return decode_impl._decode_json(raw, kind)

    @classmethod
    def _decode_object(cls, raw: Any) -> dict[str, Any] | None:
        return decode_impl._decode_object(cls, raw)

    @staticmethod
    def _decode_revision_facts(raw: Any) -> dict[str, Any] | None:
        return decode_impl._decode_revision_facts(raw)

    @staticmethod
    def _normalise_suggestion(value: Any) -> dict[str, Any] | None:
        return decode_impl._normalise_suggestion(value)

    @classmethod
    def _decode_suggestion(cls, raw: Any) -> dict[str, Any] | None:
        return decode_impl._decode_suggestion(cls, raw)

    def _row_to_document(self, row: Any, collection: str | None = None) -> AvailableDocument:
        return reads_impl._row_to_document(self, row, collection)

    @staticmethod
    def _attach_supersedes(documents: list[AvailableDocument]) -> list[AvailableDocument]:
        return reads_impl._attach_supersedes(documents)

    @staticmethod
    def _iso_date(raw: Any) -> str | None:
        return reads_impl._iso_date(raw)

    def get_all(self, collection: str) -> list[AvailableDocument]:
        return reads_impl.get_all(self, collection)

    def get_many(
        self, collection: str, filenames: list[str], *, document_ids: list[str] | None = None
    ) -> list[AvailableDocument]:
        return reads_impl.get_many(self, collection, filenames, document_ids=document_ids)

    async def get_all_async(self, collection: str) -> list[AvailableDocument]:
        return await reads_impl.get_all_async(self, collection)

    def unregister(
        self, collection: str, filename: str, *, permanent: bool = False, document_id: str | None = None
    ) -> None:
        return records_impl.unregister(self, collection, filename, permanent=permanent, document_id=document_id)

    def _retain(self, conn, collection: str, filename: str, *, document_id: str | None = None) -> None:
        return records_impl._retain(self, conn, collection, filename, document_id=document_id)

    def _forget_links_to(self, conn, collection: str, filename: str, *, document_id: str | None = None) -> None:
        return records_impl._forget_links_to(self, conn, collection, filename, document_id=document_id)

    def clear_collection(self, collection: str) -> None:
        return records_impl.clear_collection(self, collection)

    def clear_all(self) -> None:
        return records_impl.clear_all(self)

    @classmethod
    async def dispose_engine_async(cls, db_url: str):
        return await engines_impl.dispose_engine_async(cls, db_url)

    @classmethod
    def dispose_engine(cls, db_url: str):
        return engines_impl.dispose_engine(cls, db_url)

    @classmethod
    def dispose_all_engines(cls):
        return engines_impl.dispose_all_engines(cls)
