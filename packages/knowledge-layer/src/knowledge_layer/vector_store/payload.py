from __future__ import annotations

import re
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from dataclasses import field
from datetime import UTC
from datetime import date
from datetime import datetime
from typing import Any

from agent.knowledge.base import reading_order
from agent.knowledge.document_classification import canonical_doc_class
from agent.knowledge.document_classification import qdrant_doc_class

from .prefilter import FOLDER_FIELD
from .prefilter import folder_ancestors
from .schema import ADDED_AT_FIELD
from .schema import BOOL_FIELDS
from .schema import CHUNK_ID_FIELD
from .schema import CHUNK_ORDINAL_FIELD
from .schema import DATETIME_FIELDS
from .schema import DOCUMENT_DATE_FIELD
from .schema import FACT_KEYS
from .schema import INDEXED_AT_FIELD
from .schema import INTEGER_FIELDS
from .schema import KEYWORD_FIELDS
from .schema import LEGACY_CHUNKING
from .schema import LEGACY_FIELDS
from .schema import PARAGRAPH_FIELD
from .schema import PROJECT_FACTS_FIELD
from .schema import PROJECT_STATUS_FIELD
from .schema import READING_ORDER_FIELD
from .schema import SCOPE_FIELD
from .schema import TEXT_FIELD
from .schema import TEXT_STEM_FIELD

LLAMA_INTERNAL_KEYS = frozenset({"_node_content", "_node_type", "doc_id", "ref_doc_id", "document_id"})

LIST_FIELDS = frozenset({"tags", "topics", FOLDER_FIELD, PARAGRAPH_FIELD, "references", "dossier_facts", "parties"})

CHUNK_DOC_CLASS_FIELD = "chunk_doc_class"

_PARAGRAPH_REF = re.compile(r"§+\s*(\d+(?:\.\d+)?(?:[a-z](?![a-z]))?)", re.IGNORECASE)

_TRUE_STRINGS = frozenset({"true", "1", "yes", "ja"})
_FALSE_STRINGS = frozenset({"false", "0", "no", "nein", ""})

_POINT_NAMESPACE = uuid.UUID("5b0c7f8e-6b8a-4f0e-9a51-2c1d8f3e7a10")


@dataclass
class ChunkRecord:
    chunk_id: str
    text: str
    embedding: list[float]
    metadata: dict[str, Any] = field(default_factory=dict)
    ordinal: int | None = None


def point_id(chunk_id: str) -> str:
    try:
        return str(uuid.UUID(chunk_id))
    except ValueError, AttributeError, TypeError:
        return str(uuid.uuid5(_POINT_NAMESPACE, str(chunk_id)))


def paragraph_key(number: str) -> str:
    return f"§ {number.strip().rstrip('.')}".casefold()


def paragraph_refs(text: str) -> list[str]:
    return list(dict.fromkeys(paragraph_key(match) for match in _PARAGRAPH_REF.findall(text or "")))


def _as_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        folded = value.strip().casefold()
        if folded in _TRUE_STRINGS:
            return True
        if folded in _FALSE_STRINGS:
            return False
        return None
    if isinstance(value, (int, float)):
        return bool(value)
    return None


def _as_int(value: Any) -> int | None:
    try:
        return int(float(value))
    except TypeError, ValueError:
        return None


def as_rfc3339(value: Any) -> str | None:
    if isinstance(value, datetime):
        moment = value
    elif isinstance(value, date):
        moment = datetime(value.year, value.month, value.day)
    elif isinstance(value, str) and value.strip():
        text = value.strip()
        if re.fullmatch(r"\d{4}:\d{2}:\d{2}.*", text):
            text = text[:10].replace(":", "-") + text[10:]
        try:
            moment = datetime.fromisoformat(text)
        except ValueError:
            return None
    else:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def coerce_field(key: str, value: Any) -> Any:
    if value is None:
        return None
    if key in INTEGER_FIELDS:
        return _as_int(value)
    if key in BOOL_FIELDS:
        return _as_bool(value)
    if key in DATETIME_FIELDS:
        return as_rfc3339(value)
    if key in LIST_FIELDS:
        items = value if isinstance(value, (list, tuple, set)) else [value]
        return [str(item) for item in items if item is not None and str(item)]
    if key in KEYWORD_FIELDS:
        return str(value)
    return value


def document_facts(document: Any | None) -> dict[str, Any]:
    if document is None:
        return {}
    facts: dict[str, Any] = {
        "tags": list(getattr(document, "tags", None) or []),
        "topics": list(getattr(document, "topics", None) or []),
        "superseded": bool(getattr(document, "superseded_by", None)),
    }
    if doc_class := getattr(document, "doc_class", None):
        facts["doc_class"] = qdrant_doc_class(doc_class)
    folder_path = getattr(document, "folder_path", None) or None
    facts["folder_path"] = folder_path
    facts[FOLDER_FIELD] = folder_ancestors(folder_path)
    facts[DOCUMENT_DATE_FIELD] = _document_date(document)
    facts[ADDED_AT_FIELD] = as_rfc3339(getattr(document, "added_at", None))
    facts.update(reading_facts(document))
    return facts


def reference_value(kind: str, key: str) -> str:
    return f"{kind}:{key}".casefold()


def fact_value(key: str, value: Any, unit: Any = None) -> str:
    text = " ".join(str(value).split()).casefold().replace(",", ".")
    if key == "building_class":
        roman = {"i": "1", "ii": "2", "iii": "3", "iv": "4", "v": "5"}
        last = text.split()[-1] if text.split() else text
        text = roman.get(last, "".join(ch for ch in text if ch.isdigit()) or text)
    unit_text = " ".join(str(unit).split()).casefold() if unit else ""
    return f"{key}={text} {unit_text}".strip()


def reading_facts(document: Any) -> dict[str, Any]:
    dossier = getattr(document, "dossier", None)
    dossier = dossier if isinstance(dossier, Mapping) else {}
    references = getattr(document, "doc_references", None) or []
    coverage = getattr(document, "coverage", None)
    not_read = coverage.get("not_read") if isinstance(coverage, Mapping) else 0
    return {
        "document_type": dossier.get("document_type") or None,
        "references": list(
            dict.fromkeys(
                reference_value(str(ref["kind"]), str(ref["key"]))
                for ref in references
                if isinstance(ref, Mapping) and ref.get("kind") and ref.get("key")
            )
        ),
        "dossier_facts": list(
            dict.fromkeys(
                fact_value(str(fact["key"]), fact["value"], fact.get("unit"))
                for fact in dossier.get("facts") or []
                if isinstance(fact, Mapping) and fact.get("key") and fact.get("value")
            )
        ),
        "parties": list(
            dict.fromkeys(
                " ".join(str(party["name"]).split()).casefold()
                for party in dossier.get("parties") or []
                if isinstance(party, Mapping) and party.get("name")
            )
        ),
        "pages_not_read": not_read if isinstance(not_read, int) and not_read > 0 else 0,
    }


def _document_date(document: Any) -> str | None:
    revision = getattr(document, "revision_facts", None)
    capture = getattr(document, "capture", None)
    thread = getattr(document, "mail_thread", None)
    for source, key in ((revision, "revision_date"), (capture, "captured_at"), (thread, "latest_sent_at")):
        if isinstance(source, Mapping) and (stamp := as_rfc3339(source.get(key))):
            return stamp
    return None


PROJECT_STATUSES = ("active", "paused", "closed")


def _fact_values(key: str, value: Any) -> list[Any]:
    items = value if isinstance(value, (list, tuple, set)) else [value]
    if key == "building_class":
        return sorted({number for number in (_as_int(item) for item in items) if number is not None})
    return list(dict.fromkeys(str(item) for item in items if item is not None and str(item).strip()))


def project_payload(facts: Mapping[str, Any] | None, status: str) -> dict[str, Any]:
    if status not in PROJECT_STATUSES:
        raise ValueError(f"project status {status!r} is not one of {', '.join(PROJECT_STATUSES)}")
    shaped: dict[str, Any] = {}
    for key in FACT_KEYS:
        values = _fact_values(key, (facts or {}).get(key))
        if key == "federal_state":
            if values:
                shaped[key] = values[0]
        else:
            shaped[key] = values
    return {PROJECT_FACTS_FIELD: shaped, PROJECT_STATUS_FIELD: status}


def build_payload(scope: str, record: ChunkRecord, enrichment: Mapping[str, Any] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        key: value for key, value in (record.metadata or {}).items() if key not in LLAMA_INTERNAL_KEYS
    }
    payload.update({key: value for key, value in (enrichment or {}).items() if value is not None})
    typed: dict[str, Any] = {}
    for key, value in payload.items():
        coerced = coerce_field(key, value)
        if coerced is not None:
            typed[key] = coerced
    if isinstance(typed.get("doc_class"), str):
        typed["doc_class"] = qdrant_doc_class(typed["doc_class"])
    typed[FOLDER_FIELD] = folder_ancestors(typed.get("folder_path"))
    typed[SCOPE_FIELD] = scope
    typed[TEXT_FIELD] = record.text or ""
    typed[TEXT_STEM_FIELD] = typed[TEXT_FIELD]
    typed[CHUNK_ID_FIELD] = str(record.chunk_id)
    typed[READING_ORDER_FIELD] = reading_order(typed.get("page_label"))
    if record.ordinal is not None:
        typed[CHUNK_ORDINAL_FIELD] = int(record.ordinal)
    typed[PARAGRAPH_FIELD] = paragraph_refs(typed[TEXT_FIELD])
    typed[CHUNK_DOC_CLASS_FIELD] = qdrant_doc_class(str((record.metadata or {}).get("doc_class") or ""))
    return typed


ENRICHED_FIELDS = frozenset(
    {"office_id", "project_id", "grid_document_id", "folder_path", FOLDER_FIELD, "tags", "topics", "superseded"}
    | {"doc_class", INDEXED_AT_FIELD, *DATETIME_FIELDS}
)


def chunk_own_payload(scope: str, record: ChunkRecord) -> dict[str, Any]:
    return {key: value for key, value in build_payload(scope, record).items() if key not in ENRICHED_FIELDS}


STORE_ONLY_FIELDS = frozenset(
    {TEXT_FIELD, TEXT_STEM_FIELD, SCOPE_FIELD, CHUNK_ID_FIELD, READING_ORDER_FIELD}
    | {"office_id", "project_id"}
    | {
        CHUNK_ORDINAL_FIELD,
        "folder_path",
        FOLDER_FIELD,
        "tags",
        "topics",
        "superseded",
        PROJECT_FACTS_FIELD,
        PROJECT_STATUS_FIELD,
        PARAGRAPH_FIELD,
        CHUNK_DOC_CLASS_FIELD,
        INDEXED_AT_FIELD,
        *DATETIME_FIELDS,
    }
)


def chunk_metadata(payload: Mapping[str, Any]) -> dict[str, Any]:
    metadata = {key: value for key, value in payload.items() if key not in STORE_ONLY_FIELDS}
    if CHUNK_DOC_CLASS_FIELD in payload:
        metadata.pop("doc_class", None)
        if payload[CHUNK_DOC_CLASS_FIELD]:
            metadata["doc_class"] = payload[CHUNK_DOC_CLASS_FIELD]
    if isinstance(metadata.get("doc_class"), str):
        metadata["doc_class"] = canonical_doc_class(metadata["doc_class"]) or metadata["doc_class"]
    return _english_clause_keys(metadata)


def _english_clause_keys(metadata: dict[str, Any]) -> dict[str, Any]:
    for new, old in LEGACY_FIELDS.items():
        if old in metadata and not old.startswith(PROJECT_FACTS_FIELD):
            legacy = metadata.pop(old)
            metadata.setdefault(new, legacy)
    chunking = metadata.get("chunking")
    if isinstance(chunking, str):
        metadata["chunking"] = {old: new for new, old in LEGACY_CHUNKING.items()}.get(chunking, chunking)
    return metadata
