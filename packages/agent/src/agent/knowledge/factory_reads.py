from __future__ import annotations

from typing import TYPE_CHECKING

from . import factory
from .document_classification import MAX_TOPIC_VOCABULARY

if TYPE_CHECKING:
    from .schema import AvailableDocument


def get_document_person_tags(
    collection: str, filenames: list[str], *, document_ids: list[str] | None = None
) -> dict[str, list[str]]:
    return factory._get_document_metadata_store().get_person_tags_batch(
        collection, filenames, document_ids=document_ids
    )


def get_document_person_topics(
    collection: str, filenames: list[str], *, document_ids: list[str] | None = None
) -> dict[str, list[str]]:
    return factory._get_document_metadata_store().get_person_topics_batch(
        collection, filenames, document_ids=document_ids
    )


def get_topic_vocabulary(collection: str, limit: int = MAX_TOPIC_VOCABULARY) -> list[str]:
    return factory._get_document_metadata_store().get_topic_vocabulary(collection, limit)


def get_document_superseded_by(
    collection: str, filenames: list[str], *, document_ids: list[str] | None = None
) -> dict[str, str]:
    return factory._get_document_metadata_store().get_superseded_by_batch(
        collection, filenames, document_ids=document_ids
    )


def get_superseded_files(collection: str) -> dict[str, str]:
    return factory._get_document_metadata_store().get_superseded_files(collection)


def get_superseded_ids(collection: str) -> dict[str, str]:
    return factory._get_document_metadata_store().get_superseded_ids(collection)


def get_document_revision_suggestions(
    collection: str, filenames: list[str], *, document_ids: list[str] | None = None
) -> dict[str, str]:
    return factory._get_document_metadata_store().get_revision_suggestions_batch(
        collection, filenames, document_ids=document_ids
    )


def get_document_doc_class(collection: str, filename: str, *, document_id: str | None = None) -> str | None:
    return factory._get_document_metadata_store().get_doc_class(collection, filename, document_id=document_id)


def get_document_doc_class_suggestions(
    collection: str, filenames: list[str], *, document_ids: list[str] | None = None
) -> dict[str, str]:
    return factory._get_document_metadata_store().get_doc_class_suggestions_batch(
        collection, filenames, document_ids=document_ids
    )


def get_document_doc_classes(
    collection: str, filenames: list[str], *, document_ids: list[str] | None = None
) -> dict[str, str]:
    return factory._get_document_metadata_store().get_doc_classes_batch(
        collection, filenames, document_ids=document_ids
    )


def get_document_display_title(collection: str, filename: str, *, document_id: str | None = None) -> str | None:
    return factory._get_document_metadata_store().get_display_title(collection, filename, document_id=document_id)


def get_document_display_titles(
    collection: str, filenames: list[str], *, document_ids: list[str] | None = None
) -> dict[str, str]:
    return factory._get_document_metadata_store().get_display_titles_batch(
        collection, filenames, document_ids=document_ids
    )


def get_document_folder_paths(
    collection: str, filenames: list[str], *, document_ids: list[str] | None = None
) -> dict[str, str]:
    return factory._get_document_metadata_store().get_folder_paths_batch(
        collection, filenames, document_ids=document_ids
    )


def find_tmp_upload_names(collection: str, filenames: list[str]) -> list[str]:
    return factory._get_document_metadata_store().find_tmp_upload_names(collection, filenames)


def get_document_provenance(collection: str, filename: str, *, document_id: str | None = None) -> dict[str, str] | None:
    return factory._get_document_metadata_store().get_provenance(collection, filename, document_id=document_id)


def list_summary_collections() -> list[str]:
    return factory._get_document_metadata_store().list_collections()


def get_available_documents(collection: str) -> list[AvailableDocument]:
    return factory._get_document_metadata_store().get_all(collection)


def get_documents(
    collection: str, filenames: list[str], *, document_ids: list[str] | None = None
) -> list[AvailableDocument]:
    return factory._get_document_metadata_store().get_many(collection, filenames, document_ids=document_ids)


async def get_available_documents_async(collection: str) -> list[AvailableDocument]:
    return await factory._get_document_metadata_store().get_all_async(collection)
