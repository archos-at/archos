import logging

logger = logging.getLogger(__name__)


def resolve_doc_classes(chunks) -> dict[tuple[str, str], str]:
    resolved: dict[tuple[str, str], str] = {}
    try:
        from agent.knowledge.factory import get_document_doc_classes
    except Exception:
        logger.warning(
            "document metadata store unavailable; %s falls back to chunk metadata", "doc_class", exc_info=True
        )
        return resolved

    by_collection: dict[str, list[str]] = {}
    seen: set[tuple[str, str]] = set()
    for chunk in chunks:
        collection = (chunk.metadata or {}).get("collection")
        file_name = chunk.file_name
        if not collection or not file_name:
            continue
        key = (collection, file_name)
        if key in seen:
            continue
        seen.add(key)
        by_collection.setdefault(collection, []).append(file_name)

    for collection, file_names in by_collection.items():
        try:
            stored_map = get_document_doc_classes(collection, file_names)
        except Exception:
            logger.warning(
                "document metadata store read failed for collection %s; %s falls back to chunk metadata",
                collection,
                "doc_class",
                exc_info=True,
            )
            stored_map = {}
        for file_name, stored in stored_map.items():
            if stored:
                resolved[(collection, file_name)] = stored
    return resolved


def hit_doc_class(chunk, resolved: dict[tuple[str, str], str]) -> str | None:
    metadata = chunk.metadata or {}
    collection = metadata.get("collection")
    if collection and chunk.file_name:
        stored = resolved.get((collection, chunk.file_name))
        if stored:
            return stored
    return metadata.get("doc_class")


def resolve_display_titles(chunks) -> dict[tuple[str, str], str]:
    resolved: dict[tuple[str, str], str] = {}
    try:
        from agent.knowledge.factory import get_document_display_titles
    except Exception:
        logger.warning(
            "document metadata store unavailable; %s falls back to chunk metadata", "display_title", exc_info=True
        )
        return resolved

    by_collection: dict[str, list[str]] = {}
    seen: set[tuple[str, str]] = set()
    for chunk in chunks:
        collection = (chunk.metadata or {}).get("collection")
        file_name = chunk.file_name
        if not collection or not file_name:
            continue
        key = (collection, file_name)
        if key in seen:
            continue
        seen.add(key)
        by_collection.setdefault(collection, []).append(file_name)

    for collection, file_names in by_collection.items():
        try:
            stored_map = get_document_display_titles(collection, file_names)
        except Exception:
            logger.warning(
                "document metadata store read failed for collection %s; %s falls back to chunk metadata",
                collection,
                "display_title",
                exc_info=True,
            )
            stored_map = {}
        for file_name, stored in stored_map.items():
            if stored:
                resolved[(collection, file_name)] = stored
    return resolved


def hit_display_title(chunk, resolved: dict[tuple[str, str], str]) -> str | None:
    metadata = chunk.metadata or {}
    collection = metadata.get("collection")
    if collection and chunk.file_name:
        stored = resolved.get((collection, chunk.file_name))
        if stored:
            return stored
    if chunk.file_name:
        try:
            from agent.common.norm_registry import guess_display_title

            return guess_display_title(chunk.file_name)
        except Exception:
            return None
    return None


def resolve_folder_paths(chunks) -> dict[tuple[str, str], str]:
    resolved: dict[tuple[str, str], str] = {}
    try:
        from agent.knowledge.factory import get_document_folder_paths
    except Exception:
        logger.warning(
            "document metadata store unavailable; %s falls back to chunk metadata", "folder_path", exc_info=True
        )
        return resolved

    by_collection: dict[str, list[str]] = {}
    seen: set[tuple[str, str]] = set()
    for chunk in chunks:
        collection = (chunk.metadata or {}).get("collection")
        file_name = chunk.file_name
        if not collection or not file_name:
            continue
        key = (collection, file_name)
        if key in seen:
            continue
        seen.add(key)
        by_collection.setdefault(collection, []).append(file_name)

    for collection, file_names in by_collection.items():
        try:
            stored_map = get_document_folder_paths(collection, file_names)
        except Exception:
            logger.warning(
                "document metadata store read failed for collection %s; %s falls back to chunk metadata",
                collection,
                "folder_path",
                exc_info=True,
            )
            stored_map = {}
        for file_name, stored in stored_map.items():
            if stored:
                resolved[(collection, file_name)] = stored
    return resolved


def hit_folder_path(chunk, resolved: dict[tuple[str, str], str]) -> str | None:
    collection = (chunk.metadata or {}).get("collection")
    if collection and chunk.file_name:
        return resolved.get((collection, chunk.file_name))
    return None


def _folder_matches(stored: str | None, requested: str) -> bool:
    have = (stored or "").strip().strip("/").casefold()
    want = (requested or "").strip().strip("/").casefold()
    if not want:
        return True
    if not have:
        return False
    return have == want or have.startswith(f"{want}/")


def _file_name_matches(chunk_name: str | None, requested: str) -> bool:
    have = (chunk_name or "").strip().casefold()
    want = (requested or "").strip().casefold()
    if not have or not want:
        return False
    return have == want or want in have or have in want


def apply_agent_filters(
    chunks,
    doc_class: str | None,
    title_contains: str | None,
    file_name: str | None = None,
    folder: str | None = None,
) -> list:
    resolved_classes = resolve_doc_classes(chunks) if doc_class else {}
    resolved_titles = resolve_display_titles(chunks) if title_contains else {}
    requested_folder = (folder or "").strip().strip("/") or None
    resolved_folders = resolve_folder_paths(chunks) if requested_folder else {}
    needle = title_contains.casefold() if title_contains else None
    requested_name = (file_name or "").strip() or None
    kept = []
    for chunk in chunks:
        if doc_class and hit_doc_class(chunk, resolved_classes) != doc_class:
            continue
        if requested_name and not _file_name_matches(chunk.file_name, requested_name):
            continue
        if requested_folder and not _folder_matches(hit_folder_path(chunk, resolved_folders), requested_folder):
            continue
        if needle:
            haystacks = [chunk.file_name or ""]
            title = hit_display_title(chunk, resolved_titles)
            if title:
                haystacks.append(title)
            if not any(needle in hay.casefold() for hay in haystacks):
                continue
        kept.append(chunk)
    return kept
