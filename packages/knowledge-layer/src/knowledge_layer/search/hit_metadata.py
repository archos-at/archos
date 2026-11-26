import logging

logger = logging.getLogger(__name__)


def _hit_key(chunk) -> tuple[str, str] | None:
    metadata = chunk.metadata or {}
    collection = metadata.get("collection")
    if not collection:
        return None
    document_id = metadata.get("document_id")
    if document_id:
        return collection, f"id:{document_id}"
    return (collection, chunk.file_name) if chunk.file_name else None


def _asked(chunks) -> dict[str, tuple[list[str], list[str]]]:
    asked: dict[str, tuple[list[str], list[str]]] = {}
    for chunk in chunks:
        key = _hit_key(chunk)
        if key is None:
            continue
        names, ids = asked.setdefault(key[0], ([], []))
        document_id = (chunk.metadata or {}).get("document_id")
        wanted, value = (ids, str(document_id)) if document_id else (names, chunk.file_name)
        if value not in wanted:
            wanted.append(value)
    return asked


def _resolve(chunks, getter_name: str, what: str) -> dict[tuple[str, str], str]:
    resolved: dict[tuple[str, str], str] = {}
    try:
        from agent.knowledge import factory

        getter = getattr(factory, getter_name)
    except Exception:
        logger.warning("document metadata store unavailable; %s falls back to chunk metadata", what, exc_info=True)
        return resolved

    for collection, (names, ids) in _asked(chunks).items():
        try:
            stored_map = getter(collection, names, document_ids=ids) if ids else getter(collection, names)
        except Exception:
            logger.warning(
                "document metadata store read failed for collection %s; %s falls back to chunk metadata",
                collection,
                what,
                exc_info=True,
            )
            stored_map = {}
        for key, stored in stored_map.items():
            if stored:
                resolved[(collection, f"id:{key}" if key in ids else key)] = stored
    return resolved


def resolve_doc_classes(chunks) -> dict[tuple[str, str], str]:
    return _resolve(chunks, "get_document_doc_classes", "doc_class")


def hit_doc_class(chunk, resolved: dict[tuple[str, str], str]) -> str | None:
    key = _hit_key(chunk)
    stored = resolved.get(key) if key is not None else None
    return stored or (chunk.metadata or {}).get("doc_class")


def resolve_display_titles(chunks) -> dict[tuple[str, str], str]:
    return _resolve(chunks, "get_document_display_titles", "display_title")


def hit_display_title(chunk, resolved: dict[tuple[str, str], str]) -> str | None:
    key = _hit_key(chunk)
    stored = resolved.get(key) if key is not None else None
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
    return _resolve(chunks, "get_document_folder_paths", "folder_path")


def hit_folder_path(chunk, resolved: dict[tuple[str, str], str]) -> str | None:
    key = _hit_key(chunk)
    return resolved.get(key) if key is not None else None


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
