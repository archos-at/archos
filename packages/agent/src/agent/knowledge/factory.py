import json
import logging
import os
import threading
from collections.abc import Callable
from typing import TYPE_CHECKING
from typing import Any

from agent.common.db_utils import redact_db_url

from .base import BaseIngestor
from .base import BaseRetriever
from .document_classification import MAX_TOPIC_VOCABULARY
from .schema import FileStatus

if TYPE_CHECKING:
    from .document_metadata_store import DocumentMetadataStore
    from .document_metadata_store import LinkOutcome
    from .schema import AvailableDocument

logger = logging.getLogger(__name__)


DEFAULT_RETRIEVER_BACKEND = os.environ.get("KNOWLEDGE_RETRIEVER_BACKEND", "llamaindex")

DEFAULT_INGESTOR_BACKEND = os.environ.get("KNOWLEDGE_INGESTOR_BACKEND", "llamaindex")


_RETRIEVER_REGISTRY: dict[str, type[BaseRetriever]] = {}

_INGESTOR_REGISTRY: dict[str, type[BaseIngestor]] = {}

_RETRIEVER_INSTANCES: dict[tuple[str, str], BaseRetriever] = {}
_retriever_instances_lock = threading.Lock()
_INGESTOR_INSTANCES: dict[str, BaseIngestor] = {}

_ACTIVE_INGESTOR: BaseIngestor | None = None

_ACTIVE_RETRIEVER: BaseRetriever | None = None
_active_retriever_lock = threading.Lock()


def register_retriever(name: str) -> Callable[[type[BaseRetriever]], type[BaseRetriever]]:

    def decorator(cls: type[BaseRetriever]) -> type[BaseRetriever]:
        if name in _RETRIEVER_REGISTRY:
            logger.warning(f"Overwriting existing retriever adapter: {name}")
        _RETRIEVER_REGISTRY[name] = cls
        logger.debug(f"Registered retriever adapter: {name}")
        return cls

    return decorator


def register_ingestor(name: str) -> Callable[[type[BaseIngestor]], type[BaseIngestor]]:

    def decorator(cls: type[BaseIngestor]) -> type[BaseIngestor]:
        if name in _INGESTOR_REGISTRY:
            logger.warning(f"Overwriting existing ingestor adapter: {name}")
        _INGESTOR_REGISTRY[name] = cls
        logger.debug(f"Registered ingestor adapter: {name}")
        return cls

    return decorator


def _retriever_identity(backend: str, config: dict[str, Any]) -> tuple[str, str]:
    try:
        fingerprint = json.dumps(config, sort_keys=True, default=repr)
    except TypeError, ValueError:
        fingerprint = repr(sorted(config.items(), key=lambda item: str(item[0])))
    return backend, fingerprint


def get_retriever(
    backend: str | None = None,
    config: dict[str, Any] | None = None,
) -> BaseRetriever:
    backend = backend or DEFAULT_RETRIEVER_BACKEND

    if backend not in _RETRIEVER_REGISTRY:
        available = list(_RETRIEVER_REGISTRY.keys())
        raise ValueError(f"Unknown retriever backend: {backend}. Available backends: {available}")

    config = config or {}
    identity = _retriever_identity(backend, config)

    cached = _RETRIEVER_INSTANCES.get(identity)
    if cached is not None:
        return cached

    with _retriever_instances_lock:
        cached = _RETRIEVER_INSTANCES.get(identity)
        if cached is not None:
            return cached

        adapter_cls = _RETRIEVER_REGISTRY[backend]
        instance = adapter_cls(config=config)
        _RETRIEVER_INSTANCES[identity] = instance
        logger.info(
            "Created retriever instance for backend %s (%d cached configuration(s))",
            backend,
            len(_RETRIEVER_INSTANCES),
        )
        return instance


def get_ingestor(
    backend: str | None = None,
    config: dict[str, Any] | None = None,
) -> BaseIngestor:
    backend = backend or DEFAULT_INGESTOR_BACKEND

    if backend not in _INGESTOR_REGISTRY:
        available = list(_INGESTOR_REGISTRY.keys())
        raise ValueError(f"Unknown ingestor backend: {backend}. Available backends: {available}")

    if backend in _INGESTOR_INSTANCES:
        if config:
            logger.debug(f"Returning cached {backend} ingestor (config parameter ignored)")
        return _INGESTOR_INSTANCES[backend]

    adapter_cls = _INGESTOR_REGISTRY[backend]
    instance = adapter_cls(config=config or {})

    _INGESTOR_INSTANCES[backend] = instance
    logger.info(f"Created singleton ingestor instance for backend: {backend}")

    return instance


def list_retrievers() -> list[str]:
    return list(_RETRIEVER_REGISTRY.keys())


def list_ingestors() -> list[str]:
    return list(_INGESTOR_REGISTRY.keys())


def set_active_ingestor(ingestor: BaseIngestor) -> None:
    global _ACTIVE_INGESTOR
    _ACTIVE_INGESTOR = ingestor
    logger.info("Set active ingestor: %s", ingestor.backend_name)


def get_active_ingestor() -> BaseIngestor | None:
    return _ACTIVE_INGESTOR


def clear_active_ingestor() -> None:
    global _ACTIVE_INGESTOR
    _ACTIVE_INGESTOR = None


def _retriever_config_from_ingestor(ingestor: BaseIngestor) -> dict[str, Any]:
    attr_to_key = {
        "embed_base_url": "embed_base_url",
        "embed_model_name": "embed_model",
    }
    config: dict[str, Any] = {}
    for attr, key in attr_to_key.items():
        value = getattr(ingestor, attr, None)
        if value is not None:
            config[key] = value
    return config


def set_active_retriever(retriever: BaseRetriever) -> None:
    global _ACTIVE_RETRIEVER
    _ACTIVE_RETRIEVER = retriever
    logger.info("Set active retriever: %s", retriever.backend_name)


def get_active_retriever() -> BaseRetriever:
    global _ACTIVE_RETRIEVER
    if _ACTIVE_RETRIEVER is not None:
        return _ACTIVE_RETRIEVER

    with _active_retriever_lock:
        if _ACTIVE_RETRIEVER is not None:
            return _ACTIVE_RETRIEVER

        ingestor = _ACTIVE_INGESTOR
        if ingestor is not None:
            backend: str | None = ingestor.backend_name
            config: dict[str, Any] | None = _retriever_config_from_ingestor(ingestor)
        else:
            backend = None
            config = None

        _ACTIVE_RETRIEVER = get_retriever(backend, config)
        logger.info("Built active retriever: %s", _ACTIVE_RETRIEVER.backend_name)
        return _ACTIVE_RETRIEVER


def clear_active_retriever() -> None:
    global _ACTIVE_RETRIEVER
    _ACTIVE_RETRIEVER = None
    with _retriever_instances_lock:
        _RETRIEVER_INSTANCES.clear()


_document_metadata_store: DocumentMetadataStore | None = None
_document_metadata_store_lock = threading.Lock()

_DEFAULT_METADATA_DB = "sqlite+aiosqlite:///./summaries.db"


def configure_summary_db(db_url: str) -> None:
    global _document_metadata_store
    from .document_metadata_store import DocumentMetadataStore

    with _document_metadata_store_lock:
        _document_metadata_store = DocumentMetadataStore(db_url)
    logger.info("Document metadata store configured: %s", redact_db_url(db_url))


def _get_document_metadata_store() -> DocumentMetadataStore:
    global _document_metadata_store
    if _document_metadata_store is None:
        from .document_metadata_store import DocumentMetadataStore

        with _document_metadata_store_lock:
            if _document_metadata_store is None:
                db_url = os.environ.get("SUMMARY_DB") or os.environ.get("NAT_JOB_STORE_DB_URL") or _DEFAULT_METADATA_DB
                _document_metadata_store = DocumentMetadataStore(db_url)
                logger.info("Document metadata store initialized (lazy env fallback): %s", redact_db_url(db_url))
    return _document_metadata_store


def _mirror_facts(collection: str, file_names: list[str] | None = None, *, folders_only: bool = False) -> None:
    from .folder_cards import mark_files

    mark_files(collection, file_names)
    try:
        from knowledge_layer.vector_store import FOLDER_FACTS
        from knowledge_layer.vector_store import refresh_facts
    except ImportError:  # the knowledge layer's store extra is not installed here
        return
    refresh_facts(collection, file_names, fields=FOLDER_FACTS if folders_only else None)


def register_summary(
    collection: str,
    filename: str,
    summary: str | None,
    tags: list[str] | None = None,
    topics: list[str] | None = None,
) -> None:
    if not summary:
        return
    store = _get_document_metadata_store()
    store.register(collection, filename, summary, tags, topics)
    _mirror_facts(collection, [filename, *store.files_linked_to(collection, filename)])


def update_document_tags(collection: str, filename: str, tags: list[str] | None) -> bool:
    changed = _get_document_metadata_store().update_tags(collection, filename, tags)
    if changed:
        _mirror_facts(collection, [filename])
    return changed


def set_document_tags_by_person(collection: str, filename: str, tags: list[str] | None) -> bool:
    changed = _get_document_metadata_store().set_tags_by_person(collection, filename, tags)
    if changed:
        _mirror_facts(collection, [filename])
    return changed


def get_document_person_tags(collection: str, filenames: list[str]) -> dict[str, list[str]]:
    return _get_document_metadata_store().get_person_tags_batch(collection, filenames)


def set_document_topics_by_person(collection: str, filename: str, topics: list[str] | None) -> bool:
    changed = _get_document_metadata_store().set_topics_by_person(collection, filename, topics)
    if changed:
        _mirror_facts(collection, [filename])
    return changed


def get_document_person_topics(collection: str, filenames: list[str]) -> dict[str, list[str]]:
    return _get_document_metadata_store().get_person_topics_batch(collection, filenames)


def get_topic_vocabulary(collection: str, limit: int = MAX_TOPIC_VOCABULARY) -> list[str]:
    return _get_document_metadata_store().get_topic_vocabulary(collection, limit)


def set_document_capture(collection: str, filename: str, capture: dict[str, Any] | None) -> bool:
    return _get_document_metadata_store().set_capture(collection, filename, capture or None)


def set_document_revision_facts(collection: str, filename: str, facts: dict[str, Any] | None) -> bool:
    return _get_document_metadata_store().set_revision_facts(collection, filename, facts or None)


def set_document_reading(
    collection: str,
    filename: str,
    *,
    dossier: dict[str, Any] | None,
    references: list[dict[str, Any]] | None,
    coverage: dict[str, Any] | None,
) -> bool:
    written = _get_document_metadata_store().set_reading(
        collection, filename, dossier=dossier, references=references, coverage=coverage
    )
    if written:
        _mirror_facts(collection, [filename])
    return written


def set_document_page_count(collection: str, filename: str, page_count: int | None) -> bool:
    return _get_document_metadata_store().set_page_count(collection, filename, page_count)


def set_document_superseded_by(collection: str, older: str, newer: str | None) -> bool:
    changed = _get_document_metadata_store().set_superseded_by(collection, older, newer)
    if changed:
        _mirror_facts(collection, [older])
    return changed


def link_document_revision(collection: str, older: str, newer: str) -> LinkOutcome:
    outcome = _get_document_metadata_store().link_revision(collection, older, newer)
    _mirror_facts(collection, [older, newer])
    return outcome


def dismiss_document_revision_suggestion(collection: str, filename: str, older: str) -> bool:
    return _get_document_metadata_store().dismiss_revision_suggestion(collection, filename, older)


def get_document_superseded_by(collection: str, filenames: list[str]) -> dict[str, str]:
    return _get_document_metadata_store().get_superseded_by_batch(collection, filenames)


def get_superseded_files(collection: str) -> dict[str, str]:
    return _get_document_metadata_store().get_superseded_files(collection)


def set_document_revision_suggestion(collection: str, filename: str, suggestion: dict[str, Any] | None) -> bool:
    return _get_document_metadata_store().set_revision_suggestion(collection, filename, suggestion)


def get_document_revision_suggestions(collection: str, filenames: list[str]) -> dict[str, str]:
    return _get_document_metadata_store().get_revision_suggestions_batch(collection, filenames)


def set_document_change_summary(collection: str, filename: str, summary: str | None, basis: str | None) -> bool:
    return _get_document_metadata_store().set_change_summary(collection, filename, summary, basis)


def set_document_doc_class(collection: str, filename: str, doc_class: str | None) -> bool:
    changed = _get_document_metadata_store().set_doc_class(collection, filename, doc_class)
    if changed:
        _mirror_facts(collection, [filename])
    return changed


def get_document_doc_class(collection: str, filename: str) -> str | None:
    return _get_document_metadata_store().get_doc_class(collection, filename)


def set_document_doc_class_suggestion(collection: str, filename: str, doc_class: str | None) -> bool:
    return _get_document_metadata_store().set_doc_class_suggestion(collection, filename, doc_class)


def get_document_doc_class_suggestions(collection: str, filenames: list[str]) -> dict[str, str]:
    return _get_document_metadata_store().get_doc_class_suggestions_batch(collection, filenames)


def get_document_doc_classes(collection: str, filenames: list[str]) -> dict[str, str]:
    return _get_document_metadata_store().get_doc_classes_batch(collection, filenames)


def set_document_display_title(collection: str, filename: str, display_title: str | None) -> bool:
    return _get_document_metadata_store().set_display_title(collection, filename, display_title)


def get_document_display_title(collection: str, filename: str) -> str | None:
    return _get_document_metadata_store().get_display_title(collection, filename)


def get_document_display_titles(collection: str, filenames: list[str]) -> dict[str, str]:
    return _get_document_metadata_store().get_display_titles_batch(collection, filenames)


def set_document_folder_path(collection: str, filename: str, folder_path: str | None) -> bool:
    from .folder_cards import enabled_for_collection as folder_cards_enabled
    from .folder_cards import mark_folders

    store = _get_document_metadata_store()
    left = (
        store.get_folder_paths_batch(collection, [filename]).get(filename) if folder_cards_enabled(collection) else None
    )
    changed = store.set_folder_path(collection, filename, (folder_path or "").strip() or None)
    if changed:
        mark_folders(collection, [left])
        _mirror_facts(collection, [filename])
    return changed


def get_document_folder_paths(collection: str, filenames: list[str]) -> dict[str, str]:
    return _get_document_metadata_store().get_folder_paths_batch(collection, filenames)


def find_tmp_upload_names(collection: str, filenames: list[str]) -> list[str]:
    return _get_document_metadata_store().find_tmp_upload_names(collection, filenames)


def set_document_provenance(collection: str, filename: str, provenance: dict[str, str] | None) -> bool:
    return _get_document_metadata_store().set_provenance(collection, filename, provenance or None)


def get_document_provenance(collection: str, filename: str) -> dict[str, str] | None:
    return _get_document_metadata_store().get_provenance(collection, filename)


def rewrite_document_folder_paths(collection: str, from_path: str, to_path: str | None) -> int:
    count, moved = _get_document_metadata_store().rewrite_folder_paths_moved(collection, from_path, to_path)
    if moved:
        from .folder_cards import mark_folders

        mark_folders(collection, [from_path])
        _mirror_facts(collection, moved, folders_only=True)
    return count


def list_summary_collections() -> list[str]:
    return _get_document_metadata_store().list_collections()


def get_available_documents(collection: str) -> list[AvailableDocument]:
    return _get_document_metadata_store().get_all(collection)


def get_documents(collection: str, filenames: list[str]) -> list[AvailableDocument]:
    return _get_document_metadata_store().get_many(collection, filenames)


async def get_available_documents_async(collection: str) -> list[AvailableDocument]:
    return await _get_document_metadata_store().get_all_async(collection)


def reconcile_collection_summaries(
    ingestor: BaseIngestor,
    collection: str,
    file_names: list[str] | None = None,
) -> int:
    if file_names is not None:
        indexed_names = set(file_names)
    else:
        try:
            indexed_files = ingestor.list_files(collection)
        except Exception as e:
            logger.warning("Reconciliation: failed to list indexed files for %s: %s", collection, e)
            return 0
        indexed_names = {f.file_name for f in indexed_files if f.status == FileStatus.SUCCESS}

    if not indexed_names:
        return 0

    existing_names = {doc.file_name for doc in get_available_documents(collection)}
    missing_names = indexed_names - existing_names
    if not missing_names:
        return 0

    from .document_classification import fallback_summary_from_text

    sample_fn = getattr(ingestor, "get_document_text_sample", None)

    backfilled = 0
    for file_name in sorted(missing_names):
        text_sample = None
        if callable(sample_fn):
            try:
                text_sample = sample_fn(collection, file_name)
            except Exception as e:
                logger.warning("Reconciliation: failed to sample text for %s in %s: %s", file_name, collection, e)

        summary = fallback_summary_from_text(text_sample) if text_sample else None
        if not summary:
            summary = f"Indexed document: {file_name}"

        register_summary(collection, file_name, summary)
        backfilled += 1
        logger.warning(
            "Reconciliation: backfilled missing summary for %s in %s "
            "(primary summary path silently produced no row for an ingested document)",
            file_name,
            collection,
        )

    logger.warning(
        "Reconciliation: backfilled %d/%d document(s) missing summaries in %s",
        backfilled,
        len(indexed_names),
        collection,
    )
    return backfilled


def unregister_summary(collection: str, filename: str, *, permanent: bool = False) -> None:
    from .folder_cards import enabled_for_collection as folder_cards_enabled
    from .folder_cards import mark_folders

    store = _get_document_metadata_store()
    linked = store.files_linked_to(collection, filename)
    left = (
        store.get_folder_paths_batch(collection, [filename]).get(filename) if folder_cards_enabled(collection) else None
    )
    store.unregister(collection, filename, permanent=permanent)
    mark_folders(collection, [left])
    if linked:
        _mirror_facts(collection, linked)


def clear_collection_summaries(collection: str) -> None:
    _get_document_metadata_store().clear_collection(collection)


def clear_all_summaries() -> None:
    _get_document_metadata_store().clear_all()


def is_retriever_registered(name: str) -> bool:
    return name in _RETRIEVER_REGISTRY


def is_ingestor_registered(name: str) -> bool:
    return name in _INGESTOR_REGISTRY


def get_default_retriever_backend() -> str:
    return DEFAULT_RETRIEVER_BACKEND


def get_default_ingestor_backend() -> str:
    return DEFAULT_INGESTOR_BACKEND


def get_knowledge_layer_config() -> dict[str, Any]:
    return {
        "retriever": {
            "default_backend": DEFAULT_RETRIEVER_BACKEND,
            "available_backends": list(_RETRIEVER_REGISTRY.keys()),
        },
        "ingestor": {
            "default_backend": DEFAULT_INGESTOR_BACKEND,
            "available_backends": list(_INGESTOR_REGISTRY.keys()),
        },
    }


_SEARCH_RETRIEVER: BaseRetriever | None = None


def set_search_retriever(retriever: BaseRetriever | None) -> None:
    global _SEARCH_RETRIEVER
    _SEARCH_RETRIEVER = retriever


def clear_search_retriever(retriever: BaseRetriever) -> None:
    global _SEARCH_RETRIEVER
    if _SEARCH_RETRIEVER is retriever:
        _SEARCH_RETRIEVER = None


async def warm_search_query(query: str) -> None:
    retriever = _SEARCH_RETRIEVER
    if retriever is None or not query:
        return
    try:
        from agent.common.query_expansion import augmented_query

        await retriever.warm_query(augmented_query(query, log_miss=False))
    except Exception:  # noqa: BLE001 - a warm-up is worth less than the turn
        logger.debug("Search warm-up failed", exc_info=True)
