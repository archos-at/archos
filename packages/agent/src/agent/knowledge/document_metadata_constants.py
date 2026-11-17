from __future__ import annotations

import logging
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)



_OFFICE_TIMEZONE = ZoneInfo("Europe/Vienna")


ENGINE_CACHE_TTL_SECONDS = 3600


ENGINE_CACHE_MAX_SIZE = 10



TABLE_NAME = "document_metadata"



LEGACY_TABLE_NAME = "summaries"


_INDEX_NAME = "idx_document_metadata_collection"


_LEGACY_INDEX_NAME = "idx_summaries_collection"



_OPTIONAL_COLUMNS: tuple[str, ...] = (
    "tags",
    "doc_class",
    "display_title",
    "folder_path",
    "provenance",
    "doc_class_suggestion",
    "tags_set_by",
    "topics",
    "capture",
    "superseded_by",
    "revision_suggestion",
    "change_summary",
    "change_basis",
    "revision_facts",
    "page_count",
    "dossier",
    "doc_references",
    "coverage",
    "mail_thread",
    "mail_origin",
)



_OPTIONAL_COLUMN_TYPES: dict[str, str] = {"page_count": "INTEGER"}



TAGS_SET_BY_PERSON = "person"



SUGGESTION_BASES = ("title_block", "name", "content")



_DOCUMENT_COLUMNS = (
    "filename, summary, tags, doc_class, display_title, folder_path, created_at, "
    "topics, capture, superseded_by, revision_suggestion, change_summary, change_basis, revision_facts, "
    "page_count, dossier, doc_references, coverage, mail_thread, mail_origin"
)



RETAINED_TABLE_NAME = "document_revision_retained"



LEGACY_RETAINED_TABLE_NAME = "document_fassung_retained"



_RETAINED_COLUMNS = ("superseded_by", "revision_suggestion", "change_summary", "change_basis")



REFUSAL_REASON = "Von einer Person abgelehnt."
