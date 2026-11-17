from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)


def filed_document_type(config: dict) -> str | None:
    from agent.knowledge.document_classification import DOCUMENT_TYPE_TAGS

    chosen = config.get("document_type")
    if not chosen:
        return None
    if chosen not in DOCUMENT_TYPE_TAGS:
        logger.warning("Ignoring a document_type outside the vocabulary: %r", chosen)
        return None
    return chosen


def with_document_type(tags: list[str] | None, document_type: str) -> list[str]:
    from agent.knowledge.document_classification import DOCUMENT_TYPE_TAGS
    from agent.knowledge.document_classification import MAX_TAGS

    others = [tag for tag in tags or () if tag not in DOCUMENT_TYPE_TAGS and tag != document_type]
    return [document_type, *others][:MAX_TAGS]


def keep(collection_name: str, file_name: str, document_type: str, tags: list[str] | None) -> None:
    from agent.knowledge import get_document_person_tags
    from agent.knowledge import set_document_tags_by_person

    person = get_document_person_tags(collection_name, [file_name]).get(file_name)
    base = person if person is not None else tags
    if not set_document_tags_by_person(collection_name, file_name, with_document_type(base, document_type)):
        logger.warning("Could not store the chosen document type of %s in %s", file_name, collection_name)


def apply(config: dict, tags: list[str] | None) -> tuple[str | None, list[str] | None]:
    chosen_type = filed_document_type(config)
    return chosen_type, (with_document_type(tags, chosen_type) if chosen_type else tags)


def carry_person_tags(
    collection_name: str, file_name: str, preserved: dict, chosen_type: str | None, tags: list[str] | None
) -> None:
    if "tags" in preserved:
        from agent.knowledge import set_document_tags_by_person

        set_document_tags_by_person(collection_name, file_name, json.loads(preserved["tags"]))
    if chosen_type:
        keep(collection_name, file_name, chosen_type, tags)
