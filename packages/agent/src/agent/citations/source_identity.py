from __future__ import annotations

import hashlib
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from agent.common.norm_registry import NormRegistry
from agent.citations.citation_keys import parse_citation_key
from agent.citations.entries import SourceEntry
from agent.citations.entries import normalize_url
from agent.citations.registry import SourceRegistry


def is_legal_database_source(entry: SourceEntry) -> bool:
    name = (entry.tool_name or "").lower()
    if name.startswith(("law_lookup", "ris_")) or "ris_search" in name or "ris_fetch" in name:
        return True
    return (entry.collection or "").lower().startswith("ris/")


def source_lane(entry: SourceEntry, registry: NormRegistry | None = None) -> tuple[str, str]:
    from agent.common.norm_registry import lane_for_hit
    from agent.common.norm_registry import lane_for_knowledge_hit

    file_name = None
    if entry.citation_key:
        file_name, _ = parse_citation_key(entry.citation_key)
    classify = lane_for_knowledge_hit if entry.source_type == "knowledge_layer" else lane_for_hit
    return classify(
        doc_class=entry.doc_class,
        file_name=file_name,
        source_url=entry.url,
        collection=entry.collection,
        registry=registry,
        shelf=entry.shelf,
        authored_by=entry.authored_by,
        source_format=entry.source_format,
    )


def document_key(entry: SourceEntry) -> str:
    filename = ""
    if entry.citation_key:
        filename, _page = parse_citation_key(entry.citation_key)
    filename = filename.strip().lower()
    if filename:
        collection = (entry.collection or "").strip().lower()
        return f"doc:{collection}:{filename}" if collection else f"doc:{filename}"
    if entry.url:
        return f"url:{normalize_url(entry.url)}"
    label = (entry.title or entry.tool_name or "").strip().lower()[:120]
    if label:
        return f"label:{label}"
    fingerprint = hashlib.sha256(
        "\x1f".join(
            (entry.source_type or "", entry.tool_name or "", entry.collection or "", entry.chunk_text or "")
        ).encode("utf-8")
    ).hexdigest()[:16]
    return f"anon:{fingerprint}"


def source_label(entry: SourceEntry) -> str | None:
    return entry.citation_key or entry.url or None


def source_origin_token(entry: SourceEntry) -> str:
    if is_legal_database_source(entry):
        return "[RIS]"
    if entry.source_type == "knowledge_layer":
        return "[KB]"
    if entry.url:
        return "[Web]"
    return ""


def agent_authored_document_names(registry: SourceRegistry | None) -> frozenset[str]:
    from agent.common.provenance import is_agent_author
    from agent.common.provenance import normalize_document_name

    names: set[str] = set()
    for entry in registry.all_sources() if registry else ():
        if not is_agent_author(entry.authored_by):
            continue
        file_name, _ = parse_citation_key(entry.citation_key or "")
        base_name = file_name.rsplit("/", 1)[-1]
        names.update(normalize_document_name(value) for value in (base_name, entry.title))
    names.discard("")
    return frozenset(names)
