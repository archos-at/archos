import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from knowledge_layer.register import KnowledgeRetrievalConfig

logger = logging.getLogger(__name__)


_warned_legacy_fallback = False


def _normalize_session_collection_name(session_id: str | None) -> str | None:
    if not session_id:
        return None
    from agent.knowledge.base import SESSION_COLLECTION_PREFIX

    if session_id.startswith(SESSION_COLLECTION_PREFIX):
        return session_id
    return f"{SESSION_COLLECTION_PREFIX}{session_id}"


def resolve_base_collection(config: KnowledgeRetrievalConfig) -> str:
    return config.collection_name


def scoped_collections_for_site(
    config: KnowledgeRetrievalConfig, session_id: str | None, base_collection: str | None = None
):
    entries = resolve_scoped_collections(config, session_id, base_collection)
    from agent.common.knowledge_context import base_corpus_readable

    readable = base_corpus_readable()
    if readable is None or readable:
        return entries
    base = base_collection if base_collection is not None else config.collection_name
    return [entry for entry in entries if _shelf_name(entry) != "base" and entry.collection != base]


def resolve_scoped_collections(
    config: KnowledgeRetrievalConfig, session_id: str | None, base_collection: str | None = None
):
    from agent.common.source_kinds import Shelf
    from agent.knowledge.scoping import ScopedCollection

    try:
        from agent.knowledge.scoping import get_scoped_collections_from_context

        header_scope = get_scoped_collections_from_context()
        if header_scope:
            return header_scope
    except ImportError:
        pass

    global _warned_legacy_fallback
    if not _warned_legacy_fallback:
        _warned_legacy_fallback = True
        logger.warning(
            "X-Grid-Collection-Scope header not present, falling back to legacy config-based collection resolution"
        )

    base = base_collection if base_collection is not None else config.collection_name

    if config.use_fixed_collection:
        return [ScopedCollection(base, Shelf.BASE)]

    session_collection = _normalize_session_collection_name(session_id)

    targets: list[ScopedCollection] = []
    if config.include_base_collection and base:
        targets.append(ScopedCollection(base, Shelf.BASE))
    if config.include_session_collection and session_collection:
        targets.append(ScopedCollection(session_collection, Shelf.SESSION))
    targets.extend(ScopedCollection(name, Shelf.PROJECT) for name in config.project_collections)

    seen: set[str] = set()
    ordered: list[ScopedCollection] = []
    for entry in targets:
        if entry.collection and entry.collection not in seen:
            seen.add(entry.collection)
            ordered.append(entry)

    if not ordered:
        return [ScopedCollection(base, Shelf.BASE)]
    return ordered


def _shelf_name(entry) -> str | None:
    shelf = getattr(entry, "shelf", None)
    if shelf is None:
        return None
    return getattr(shelf, "value", None) or str(shelf)


def restrict_scope_to_turn(entries):
    try:
        from agent.common.focus_file import get_turn_shelves

        allowed = get_turn_shelves()
    except Exception:
        allowed = None
    if not allowed:
        return entries
    filtered = [entry for entry in entries if _shelf_name(entry) in allowed or _shelf_name(entry) is None]
    return filtered if filtered else entries


def _resolve_target_collections(
    config: KnowledgeRetrievalConfig, session_id: str | None, base_collection: str | None = None
) -> list[str]:
    return [entry.collection for entry in scoped_collections_for_site(config, session_id, base_collection)]


_NON_EVIDENCE_CHUNKING = "page"


def base_collection_filters(config: KnowledgeRetrievalConfig, caller_filters: dict | None) -> dict:
    clauses: list[dict] = [{"chunking": {"$ne": _NON_EVIDENCE_CHUNKING}}]
    excluded = sorted(set(config.exclude_file_names))
    if excluded:
        clauses.append({"file_name": {"$nin": excluded}})
    if caller_filters:
        clauses.append(caller_filters)

    if len(clauses) == 1:
        return clauses[0]
    return {"$and": clauses}
