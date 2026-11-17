"""The document type a person chose when filing a file, held against every later read.

``POST /v1/ingest`` carries it as ``document_type`` (the BFF's filing choice);
the ingest job applies it before the permit check reads the tags, and stores it
as a person's tags once the row exists, so no classifier pass replaces it.
"""

from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)


def filed_document_type(config: dict) -> str | None:
    """The document type a person chose when the file was filed (``document_type``), or ``None``.

    ``POST /v1/ingest`` already refuses a value outside the vocabulary; a job
    queued before a vocabulary change can still carry one, and that is dropped
    with a warning rather than stored, because the store keeps whatever it is
    handed.
    """
    from agent.knowledge.document_classification import DOCUMENT_TYPE_TAGS

    chosen = config.get("document_type")
    if not chosen:
        return None
    if chosen not in DOCUMENT_TYPE_TAGS:
        logger.warning("Ignoring a document_type outside the vocabulary: %r", chosen)
        return None
    return chosen


def with_document_type(tags: list[str] | None, document_type: str) -> list[str]:
    """``tags`` with ``document_type`` as their one document type; the discipline tags stay, up to ``MAX_TAGS``.

    Pure. Every other type tag goes, whether the classifier read it or a person
    chose it earlier: the newest choice is what the document is.
    """
    from agent.knowledge.document_classification import DOCUMENT_TYPE_TAGS
    from agent.knowledge.document_classification import MAX_TAGS

    others = [tag for tag in tags or () if tag not in DOCUMENT_TYPE_TAGS and tag != document_type]
    return [document_type, *others][:MAX_TAGS]


def keep(collection_name: str, file_name: str, document_type: str, tags: list[str] | None) -> None:
    """Store the chosen type on the row as a person's tags, so no later read replaces it. Fail-open.

    The beside-part of :func:`_read_human_set_fields`: the type a person chose
    at filing is a human-set field from the moment it is stored, and it rides
    the store's one marker (``tags_set_by = 'person'``). That marker also keeps
    the row's topics, exactly as a person's edit in the tag editor does.

    The base is the person's tags when the row already has them (a re-upload,
    or a row carried from another spelling), so their discipline tags survive;
    otherwise the classifier's. A store that cannot be read answers ``{}``, and
    the classifier's disciplines are then the base: the type still holds.
    """
    from agent.knowledge import get_document_person_tags
    from agent.knowledge import set_document_tags_by_person

    person = get_document_person_tags(collection_name, [file_name]).get(file_name)
    base = person if person is not None else tags
    if not set_document_tags_by_person(collection_name, file_name, with_document_type(base, document_type)):
        logger.warning("Could not store the chosen document type of %s in %s", file_name, collection_name)


def apply(config: dict, tags: list[str] | None) -> tuple[str | None, list[str] | None]:
    """The chosen type, and ``tags`` with it as their one type (unchanged when none was chosen)."""
    chosen_type = filed_document_type(config)
    return chosen_type, (with_document_type(tags, chosen_type) if chosen_type else tags)


def carry_person_tags(
    collection_name: str, file_name: str, preserved: dict, chosen_type: str | None, tags: list[str] | None
) -> None:
    """Carry a person's tags from a row under another spelling, then store the chosen type on top.

    The upsert already keeps a person's tags on a row of the same name; this
    carries them from a row under another spelling, which retiring the previous
    version removed. The chosen type lands after that carry, so it is written
    onto the person's own tags.
    """
    if "tags" in preserved:
        from agent.knowledge import set_document_tags_by_person

        set_document_tags_by_person(collection_name, file_name, json.loads(preserved["tags"]))
    if chosen_type:
        keep(collection_name, file_name, chosen_type, tags)
