import asyncio
from typing import Any

from fastapi import Depends
from fastapi import HTTPException
from pydantic import BaseModel
from pydantic import Field

from agent.knowledge import rewrite_document_folder_paths
from agent.knowledge import set_document_display_title
from agent.knowledge import set_document_folder_path
from agent.knowledge import set_document_tags_by_person
from agent.knowledge import set_document_topics_by_person
from agent.knowledge.base import BaseIngestor
from agent.knowledge.document_classification import ALLOWED_TAGS
from agent.knowledge.document_classification import MAX_TAGS
from agent.knowledge.document_classification import MAX_TOPICS
from agent.knowledge.document_classification import normalize_topic

from .collections import _require_ingestor


def _checked_tags(raw: list[str]) -> list[str]:
    deduped: list[str] = []
    for tag in raw:
        if tag not in deduped:
            deduped.append(tag)

    offending = [tag for tag in deduped if tag not in ALLOWED_TAGS]
    if offending:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Tags outside the controlled vocabulary are not allowed",
                "invalid_tags": offending,
            },
        )

    if len(deduped) > MAX_TAGS:
        raise HTTPException(
            status_code=400,
            detail={
                "message": f"At most {MAX_TAGS} tags are allowed per document",
                "max_tags": MAX_TAGS,
                "tag_count": len(deduped),
            },
        )
    return deduped


def _checked_topics(raw: list[str]) -> list[str]:
    invalid = [raw_topic for raw_topic in raw if normalize_topic(raw_topic) is None]
    if invalid:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Topics must be a term of up to three words",
                "invalid_topics": invalid,
            },
        )

    controlled = {tag.casefold() for tag in ALLOWED_TAGS}
    kept: dict[str, str] = {}
    for raw_topic in raw:
        term = normalize_topic(raw_topic)
        folded = term.casefold()
        if folded not in controlled:
            kept.setdefault(folded, term)

    topics = list(kept.values())
    if len(topics) > MAX_TOPICS:
        raise HTTPException(
            status_code=400,
            detail={
                "message": f"At most {MAX_TOPICS} topics are allowed per document",
                "max_topics": MAX_TOPICS,
                "topic_count": len(topics),
            },
        )
    return topics


def _no_summary_404(collection_name: str, file_name: str) -> HTTPException:
    return HTTPException(
        status_code=404,
        detail=f"No summary found for '{file_name}' in collection '{collection_name}'",
    )


class UpdateTagsRequest(BaseModel):
    tags: list[str] = Field(
        default_factory=list,
        description="Controlled document tags; must be a subset of the ingestion vocabulary.",
    )
    topics: list[str] | None = Field(
        default=None,
        description=(
            "Open topics (Themen), free terms of up to three words. Omit to leave the topics as they are; "
            "send tags alone to leave them, too."
        ),
    )


async def update_document_tags_route(
    collection_name: str,
    file_name: str,
    request: UpdateTagsRequest,
    ingestor: BaseIngestor = Depends(_require_ingestor),
) -> dict[str, Any]:
    topics = _checked_topics(request.topics) if request.topics is not None else None
    write_tags = "tags" in request.model_fields_set or request.topics is None
    tags = _checked_tags(request.tags) if write_tags else None

    response: dict[str, Any] = {"collection_name": collection_name, "file_name": file_name}
    if topics is not None:
        if not await asyncio.to_thread(set_document_topics_by_person, collection_name, file_name, topics):
            raise _no_summary_404(collection_name, file_name)
        response["topics"] = topics
    if tags is not None:
        if not await asyncio.to_thread(set_document_tags_by_person, collection_name, file_name, tags):
            raise _no_summary_404(collection_name, file_name)
        response["tags"] = tags
    return response


class UpdateDisplayTitleRequest(BaseModel):
    display_title: str | None = Field(
        default=None,
        description="User-facing document name. Null or blank clears it, restoring the derived default.",
    )


async def update_document_display_title_route(
    collection_name: str,
    file_name: str,
    request: UpdateDisplayTitleRequest,
    ingestor: BaseIngestor = Depends(_require_ingestor),
) -> dict[str, str | None]:
    new_title = (request.display_title or "").strip() or None

    updated = await asyncio.to_thread(set_document_display_title, collection_name, file_name, new_title)
    if not updated:
        raise HTTPException(
            status_code=404,
            detail=f"No summary found for '{file_name}' in collection '{collection_name}'",
        )

    return {
        "collection_name": collection_name,
        "file_name": file_name,
        "display_title": new_title,
    }


class UpdateFolderPathRequest(BaseModel):
    folder_path: str | None = Field(
        default=None,
        description=(
            "The document's new folder path, e.g. 'Brandschutz/Fluchtwege'. Null or blank files it at the project root."
        ),
    )


async def update_document_folder_path_route(
    collection_name: str,
    file_name: str,
    request: UpdateFolderPathRequest,
    ingestor: BaseIngestor = Depends(_require_ingestor),
) -> dict[str, str | None]:
    new_path = (request.folder_path or "").strip() or None

    updated = await asyncio.to_thread(set_document_folder_path, collection_name, file_name, new_path)
    if not updated:
        raise HTTPException(
            status_code=404,
            detail=f"No summary found for '{file_name}' in collection '{collection_name}'",
        )

    return {
        "collection_name": collection_name,
        "file_name": file_name,
        "folder_path": new_path,
    }


class RewriteFolderPathRequest(BaseModel):
    from_path: str = Field(
        ...,
        min_length=1,
        description="The folder path as it was before the rename/move/delete, e.g. 'Brandschutz/Fluchtwege'.",
    )
    to_path: str | None = Field(
        default=None,
        description="The folder path it became. Null or blank re-files the subtree at the project root.",
    )


async def rewrite_folder_paths_route(
    collection_name: str,
    request: RewriteFolderPathRequest,
    ingestor: BaseIngestor = Depends(_require_ingestor),
) -> dict[str, Any]:
    updated = await asyncio.to_thread(
        rewrite_document_folder_paths, collection_name, request.from_path, request.to_path
    )
    return {
        "collection_name": collection_name,
        "from_path": request.from_path,
        "to_path": (request.to_path or "").strip() or None,
        "updated": updated,
    }
