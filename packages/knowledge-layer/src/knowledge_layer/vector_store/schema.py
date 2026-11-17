from __future__ import annotations

import logging
from enum import StrEnum
from typing import Any

from qdrant_client import QdrantClient
from qdrant_client import models

from agent.common.source_kinds import OFFICE_SHELF_COLLECTION_PREFIXES
from agent.knowledge.base import READING_ORDER

from .config import replication_factor
from .config import shard_number
from .legacy_names import LEGACY_DOCUMENT_ID_FIELD

logger = logging.getLogger(__name__)

DENSE = "dense"
LEXICAL = "lexical"

BM25_MODEL = "qdrant/bm25"
BM25_OPTIONS: dict[str, Any] = {"language": "german", "ascii_folding": True}

BM25_LENGTH_KEY = "bm25_length"
BM25_DEFAULT_LENGTH: dict[str, float] = {"k": 1.2, "b": 0.75, "avg_len": 256.0}
_BM25_LENGTH_KEYS = frozenset(BM25_DEFAULT_LENGTH)


METADATA_KEYS = frozenset({"embed_fingerprint", "embed_model", "bm25_length"})
LEGACY_METADATA_PREFIX = "aiq:"


def current_metadata(metadata: dict[str, Any] | None) -> dict[str, Any]:
    current = dict(metadata or {})
    for key in METADATA_KEYS:
        legacy = LEGACY_METADATA_PREFIX + key
        if legacy in current:
            current.setdefault(key, current[legacy])
    return current


def with_legacy_keys(metadata: dict[str, Any]) -> dict[str, Any]:
    legacy = {LEGACY_METADATA_PREFIX + key: value for key, value in metadata.items() if key in METADATA_KEYS}
    return {**metadata, **legacy}


def adopt_legacy_metadata(client: QdrantClient, collection: str) -> dict[str, Any]:
    stored = client.get_collection(collection).config.metadata or {}
    missing = {key: value for key, value in current_metadata(stored).items() if key not in stored}
    if missing:
        client.update_collection(collection, metadata=missing)
        logger.info("Qdrant collection %s: copied metadata %s from the aiq: prefix", collection, sorted(missing))
    return missing


def bm25_length_of(metadata: dict[str, Any] | None) -> dict[str, float]:
    stored = current_metadata(metadata).get(BM25_LENGTH_KEY)
    if not isinstance(stored, dict):
        return {}
    try:
        length = {key: float(value) for key, value in stored.items() if key in _BM25_LENGTH_KEYS}
    except TypeError, ValueError:
        return {}
    return length if all(value > 0 for value in length.values()) else {}


def effective_bm25_length(length: dict[str, float] | None) -> dict[str, float]:
    return {**BM25_DEFAULT_LENGTH, **(length or {})}


SCOPE_FIELD = "scope"
OFFICE_FIELD = "office_id"
DOCUMENT_ID_FIELD = "document_id"
LICENCE_CLASS_FIELD = "licence_class"
LICENCE_CLASSES = ("public_open", "public_restricted", "licensed")
KNOWLEDGE_EDITION_FIELD = "knowledge_edition_id"
COUNTRY_FIELD = "country_id"
RELEASED_FIELD = "released"
AI_PROCESSING_FIELD = "ai_processing_attested"
QUOTE_MAX_CHARS_FIELD = "quote_max_chars"
TEXT_FIELD = "text"
CHUNK_ID_FIELD = "chunk_id"
PARAGRAPH_FIELD = "paragraph_refs"

TEXT_INDEX = models.TextIndexParams(
    type=models.TextIndexType.TEXT,
    tokenizer=models.TokenizerType.WORD,
    lowercase=True,
    ascii_folding=True,
    phrase_matching=True,
)

KIND_FIELD = "kind"
FOLDER_KIND = "folder"

TEXT_STEM_FIELD = "text_stem"

TEXT_STEM_INDEX = models.TextIndexParams(
    type=models.TextIndexType.TEXT,
    tokenizer=models.TokenizerType.WORD,
    lowercase=True,
    ascii_folding=True,
    phrase_matching=True,
    stemmer=models.SnowballParams(type=models.Snowball.SNOWBALL, language=models.SnowballLanguage.GERMAN),
)

PROJECT_FACTS_FIELD = "project_facts"
PROJECT_STATUS_FIELD = "project_status"
FACT_KEYS: tuple[str, ...] = ("federal_state", "building_class", "construction_method", "uses", "work_type")

LEGACY_FIELDS: dict[str, str] = {
    f"{PROJECT_FACTS_FIELD}.federal_state": f"{PROJECT_FACTS_FIELD}.bundesland",
    f"{PROJECT_FACTS_FIELD}.building_class": f"{PROJECT_FACTS_FIELD}.gebaeudeklasse",
    f"{PROJECT_FACTS_FIELD}.construction_method": f"{PROJECT_FACTS_FIELD}.bauweise",
    f"{PROJECT_FACTS_FIELD}.uses": f"{PROJECT_FACTS_FIELD}.nutzungen",
    f"{PROJECT_FACTS_FIELD}.work_type": f"{PROJECT_FACTS_FIELD}.vorhabensart",
    "clause_id": "punkt_id",
    "clause_depth": "punkt_depth",
    "clause_title": "punkt_title",
    "clause_path": "punkt_path",
    "clause_parent_id": "punkt_parent_id",
    "guideline": "richtlinie",
}
LEGACY_CHUNKING: dict[str, str] = {"clause": "punkt"}


LEGACY_KEYWORD_FIELDS: tuple[str, ...] = tuple(
    old for old in LEGACY_FIELDS.values() if old not in {f"{PROJECT_FACTS_FIELD}.gebaeudeklasse", "punkt_depth"}
)


def fact_field(key: str) -> str:
    if key not in FACT_KEYS:
        raise ValueError(f"{key!r} is not a project fact")
    return f"{PROJECT_FACTS_FIELD}.{key}"


KEYWORD_FIELDS: tuple[str, ...] = (
    SCOPE_FIELD,
    CHUNK_ID_FIELD,
    "file_name",
    "clause_id",
    "page_label",
    "chunking",
    "content_type",
    "doc_class",
    "guideline",
    OFFICE_FIELD,
    "project_id",
    LEGACY_DOCUMENT_ID_FIELD,
    DOCUMENT_ID_FIELD,
    LICENCE_CLASS_FIELD,
    KNOWLEDGE_EDITION_FIELD,
    COUNTRY_FIELD,
    "folder_path",
    "folder_ancestors",
    "tags",
    "topics",
    KIND_FIELD,
    PROJECT_STATUS_FIELD,
    *(f"{PROJECT_FACTS_FIELD}.{key}" for key in FACT_KEYS if key != "building_class"),
    *LEGACY_KEYWORD_FIELDS,
    PARAGRAPH_FIELD,
    "clause_path",
    "clause_parent_id",
    "clause_title",
    "page_end",
    "drawing_type",
    "drawing_scale",
    "image_format",
    "image_key",
    "authored_by",
    "approved_by",
    "producer",
    "source_format",
    "document_type",
    "references",
    "dossier_facts",
    "parties",
)
READING_ORDER_FIELD = READING_ORDER
INDEXED_AT_FIELD = "indexed_at"
CHUNK_ORDINAL_FIELD = "chunk_ordinal"

INTEGER_FIELDS: tuple[str, ...] = (
    "clause_depth",
    "punkt_depth",
    "section_order",
    READING_ORDER_FIELD,
    CHUNK_ORDINAL_FIELD,
    INDEXED_AT_FIELD,
    f"{PROJECT_FACTS_FIELD}.building_class",
    f"{PROJECT_FACTS_FIELD}.gebaeudeklasse",
    "section_part",
    "table_index",
    "table_part",
    "image_index",
    "stored_image_index",
    "segment_index",
    "pages_not_read",
)
DOCUMENT_DATE_FIELD = "document_date"
ADDED_AT_FIELD = "added_at"
DATETIME_FIELDS: tuple[str, ...] = (DOCUMENT_DATE_FIELD, ADDED_AT_FIELD)
BOOL_FIELDS: tuple[str, ...] = ("superseded", RELEASED_FIELD)

TEXT_FIELDS: tuple[str, ...] = (TEXT_FIELD, TEXT_STEM_FIELD)

INDEXED_FIELDS = frozenset(KEYWORD_FIELDS + INTEGER_FIELDS + DATETIME_FIELDS + BOOL_FIELDS + TEXT_FIELDS)

TENANT_PREFIXES = (*OFFICE_SHELF_COLLECTION_PREFIXES, "proj_", "s_")

EMBED_IDENTITY_KEYS = ("embed_fingerprint", "embed_model")


class Physical(StrEnum):
    CORPUS = "corpus"
    OFFICE = "office"


ALIASES = {Physical.CORPUS: "piloti_corpus", Physical.OFFICE: "piloti_office"}
FIRST_VERSION = "_v1"

WRITE_CONSISTENCY_FACTOR = 1


def physical_for_scope(scope: str) -> Physical:
    return Physical.OFFICE if scope.startswith(TENANT_PREFIXES) else Physical.CORPUS


def _field_schema(field: str) -> Any:
    if field == SCOPE_FIELD:
        return models.KeywordIndexParams(type=models.KeywordIndexType.KEYWORD, is_tenant=True)
    if field == TEXT_FIELD:
        return TEXT_INDEX
    if field == TEXT_STEM_FIELD:
        return TEXT_STEM_INDEX
    if field in INTEGER_FIELDS:
        return models.PayloadSchemaType.INTEGER
    if field in BOOL_FIELDS:
        return models.PayloadSchemaType.BOOL
    if field in DATETIME_FIELDS:
        return models.PayloadSchemaType.DATETIME
    return models.PayloadSchemaType.KEYWORD


def create_collection(
    client: QdrantClient,
    physical: Physical,
    name: str,
    dense_size: int,
    identity: dict[str, str],
    *,
    shards: int | None = None,
    replication: int | None = None,
    bm25_length: dict[str, float] | None = None,
) -> None:
    tenant = physical is Physical.OFFICE
    rf = replication or replication_factor()
    client.create_collection(
        name,
        vectors_config={DENSE: models.VectorParams(size=dense_size, distance=models.Distance.COSINE)},
        sparse_vectors_config={LEXICAL: models.SparseVectorParams(modifier=models.Modifier.IDF)},
        shard_number=(shards or shard_number()) if tenant else 1,
        replication_factor=rf,
        write_consistency_factor=WRITE_CONSISTENCY_FACTOR,
        hnsw_config=models.HnswConfigDiff(payload_m=16) if tenant else None,
        quantization_config=models.TurboQuantization(
            turbo=models.TurboQuantQuantizationConfig(bits=models.TurboQuantBitSize.BITS4)
        ),
        strict_mode_config=models.StrictModeConfig(
            enabled=True, unindexed_filtering_retrieve=False, unindexed_filtering_update=False
        ),
        metadata=_metadata(identity, bm25_length),
    )
    ensure_payload_indexes(client, name)


def _metadata(identity: dict[str, Any], bm25_length: dict[str, float] | None) -> dict[str, Any]:
    metadata = {
        key: value
        for key, value in current_metadata(identity).items()
        if key != BM25_LENGTH_KEY and not key.startswith(LEGACY_METADATA_PREFIX)
    }
    if bm25_length:
        metadata[BM25_LENGTH_KEY] = {key: float(value) for key, value in bm25_length.items()}
    return with_legacy_keys(metadata)


def text_index_drift(params: Any) -> str | None:
    wanted = TEXT_INDEX.model_dump(include={"tokenizer", "lowercase", "ascii_folding", "phrase_matching"})
    found = {key: getattr(params, key, None) for key in wanted}
    drift = {key: (found[key], value) for key, value in wanted.items() if found[key] != value}
    if not drift:
        return None
    return ", ".join(f"{key} is {have!r}, wants {want!r}" for key, (have, want) in sorted(drift.items()))


def ensure_payload_indexes(client: QdrantClient, collection: str) -> list[str]:
    adopt_legacy_metadata(client, collection)
    schema = client.get_collection(collection).payload_schema or {}
    text = schema.get(TEXT_FIELD)
    drift = text_index_drift(text.params) if text is not None else None
    if drift:
        logger.error(
            "Qdrant collection %s: the %r full-text index was built differently (%s). Phrase and exact-term "
            "matching on numbers (§ 3, 5.1.1) is wrong until it is rebuilt: copy into a new _vN collection and "
            "switch the alias (scripts/qdrant_rebuild.py, docs/deployment/qdrant-runbook.md)",
            collection,
            TEXT_FIELD,
            drift,
        )
    missing = sorted(INDEXED_FIELDS - set(schema))
    for field in missing:
        client.create_payload_index(collection, field, field_schema=_field_schema(field), wait=True)
    if missing and schema:
        logger.info("Qdrant collection %s: created missing payload indexes %s", collection, missing)
    return missing


def _alias_exists(client: QdrantClient, alias: str) -> bool:
    return any(entry.alias_name == alias for entry in client.get_aliases().aliases)


def _create_alias(client: QdrantClient, name: str, alias: str) -> None:
    if _alias_exists(client, alias):
        return
    try:
        client.update_collection_aliases(
            change_aliases_operations=[
                models.CreateAliasOperation(create_alias=models.CreateAlias(collection_name=name, alias_name=alias))
            ]
        )
    except Exception:
        if not _alias_exists(client, alias):
            raise


def identity_mismatch(stored: dict[str, Any] | None, identity: dict[str, str]) -> str | None:
    stored = current_metadata(stored)
    fingerprint = EMBED_IDENTITY_KEYS[0]
    if stored.get(fingerprint) == identity.get(fingerprint):
        return None
    return (
        f"embedding mismatch: Qdrant collection was written with {stored.get(EMBED_IDENTITY_KEYS[1])!r}, "
        f"this process embeds with {identity.get(EMBED_IDENTITY_KEYS[1])!r}"
    )


def _create_or_adopt(client: QdrantClient, physical: Physical, dense_size: int, identity: dict[str, str]) -> None:
    alias = ALIASES[physical]
    name = alias + FIRST_VERSION
    try:
        create_collection(client, physical, name, dense_size, identity)
        logger.info("Created Qdrant collection %s", name)
    except Exception:
        if not client.collection_exists(name):
            raise
        logger.info("Qdrant collection %s exists without alias %s; finishing it", name, alias)
        ensure_payload_indexes(client, name)
    _create_alias(client, name, alias)


def ensure_collection(client: QdrantClient, physical: Physical, dense_size: int, identity: dict[str, str]) -> None:
    alias = ALIASES[physical]
    if not _alias_exists(client, alias):
        _create_or_adopt(client, physical, dense_size, identity)
    info = client.get_collection(alias)
    mismatch = identity_mismatch(info.config.metadata, identity)
    if mismatch:
        raise RuntimeError(f"{alias}: {mismatch}")
    ensure_payload_indexes(client, alias)
