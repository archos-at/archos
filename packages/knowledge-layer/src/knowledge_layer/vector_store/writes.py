from __future__ import annotations

import logging
import re
import time
from collections.abc import Iterable
from collections.abc import Mapping
from collections.abc import Sequence
from typing import Any

from agent.common.source_kinds import office_shelf_organization_id

from .payload import ChunkRecord
from .payload import document_facts
from .payload import project_payload
from .prefilter import FOLDER_FIELD
from .schema import AI_PROCESSING_FIELD
from .schema import COUNTRY_FIELD
from .schema import INDEXED_AT_FIELD
from .schema import KNOWLEDGE_EDITION_FIELD
from .schema import LICENCE_CLASS_FIELD
from .schema import LICENCE_CLASSES
from .schema import OFFICE_FIELD
from .schema import QUOTE_MAX_CHARS_FIELD
from .schema import RELEASED_FIELD
from .scope import is_tenant_scope
from .store import get_store

logger = logging.getLogger(__name__)


def facts_by_file(scope: str, file_names: Iterable[str] | None = None) -> dict[str, dict[str, Any]]:
    if file_names is None:
        from agent.knowledge import get_available_documents

        documents = get_available_documents(scope)
    else:
        from agent.knowledge import get_documents

        documents = get_documents(scope, sorted(set(file_names)))
    return {document.file_name: document_facts(document) for document in documents}


def enrichment(scope: str, config: Mapping[str, Any] | None = None) -> dict[str, Any]:
    config = config or {}
    office_id = config.get("organization_id")
    if not office_id:
        office_id = office_shelf_organization_id(scope)
    base: dict[str, Any] = {
        OFFICE_FIELD: office_id,
        "project_id": config.get("project_id"),
        "grid_document_id": config.get("document_id"),
        "folder_path": config.get("folder_path"),
        INDEXED_AT_FIELD: int(time.time()),
        **licence_mark(scope, config),
    }
    status = config.get("project_status")
    if status or config.get("project_facts") is not None:
        try:
            base.update(project_payload(config.get("project_facts"), status))
        except ValueError:
            logger.error(
                "Qdrant: the ingest job for %s carries project facts with status %r; not written", scope, status
            )
    return base


def licence_mark(scope: str, config: Mapping[str, Any]) -> dict[str, Any]:
    mark: dict[str, Any] = {}
    licence = config.get(LICENCE_CLASS_FIELD)
    if licence in LICENCE_CLASSES:
        mark[LICENCE_CLASS_FIELD] = licence
    elif licence is not None:
        logger.error("Qdrant: the ingest job for %s names an unknown licence class %r; not written", scope, licence)
    edition = config.get(KNOWLEDGE_EDITION_FIELD)
    if isinstance(edition, str) and edition.strip():
        mark[KNOWLEDGE_EDITION_FIELD] = edition.strip()
    country = config.get(COUNTRY_FIELD)
    if isinstance(country, str) and re.fullmatch(r"[A-Z]{2}", country):
        mark[COUNTRY_FIELD] = country
    elif country is not None:
        logger.error("Qdrant: the ingest job for %s names an unknown country %r; not written", scope, country)
    released = config.get(RELEASED_FIELD)
    if isinstance(released, bool):
        mark[RELEASED_FIELD] = released
    elif not is_tenant_scope(scope) and COUNTRY_FIELD not in mark:
        mark[RELEASED_FIELD] = False
    if isinstance(config.get(AI_PROCESSING_FIELD), bool):
        mark[AI_PROCESSING_FIELD] = config[AI_PROCESSING_FIELD]
    cap = config.get(QUOTE_MAX_CHARS_FIELD)
    if isinstance(cap, int) and not isinstance(cap, bool) and cap > 0:
        mark[QUOTE_MAX_CHARS_FIELD] = cap
    return mark


def write_chunks(
    scope: str,
    file_name: str,
    records: Sequence[ChunkRecord],
    *,
    identity: Mapping[str, str],
    config: Mapping[str, Any] | None = None,
) -> int:
    base = enrichment(scope, config)
    facts = facts_by_file(scope, [file_name]).get(file_name, {})
    base.update({key: value for key, value in facts.items() if value is not None})
    return get_store(identity).upsert(scope, records, base)


FOLDER_FACTS = frozenset({"folder_path", FOLDER_FIELD})


def copy_facts(scope: str, file_names: Iterable[str] | None = None, *, fields: Iterable[str] | None = None) -> int:
    store = get_store()
    facts = facts_by_file(scope, file_names)
    wanted = set(fields) if fields is not None else None
    if wanted is not None:
        facts = {name: {key: value for key, value in values.items() if key in wanted} for name, values in facts.items()}
    store.set_file_payloads(scope, facts)
    if wanted is None or "doc_class" in wanted:
        store.restore_chunk_doc_classes(scope, [name for name, values in facts.items() if "doc_class" not in values])
    return len(facts)


def refresh_facts(scope: str, file_names: Iterable[str] | None = None, *, fields: Iterable[str] | None = None) -> None:
    try:
        copy_facts(scope, file_names, fields=fields)
    except Exception:  # noqa: BLE001 - see the docstring
        logger.warning("Qdrant: copying the facts of %s onto its points failed", scope, exc_info=True)
