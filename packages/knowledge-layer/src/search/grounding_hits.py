import json
import logging
import math

from knowledge_layer.search.hit_metadata import hit_display_title
from knowledge_layer.search.hit_metadata import hit_doc_class
from knowledge_layer.search.hit_metadata import hit_folder_path
from knowledge_layer.search.hit_metadata import resolve_display_titles
from knowledge_layer.search.hit_metadata import resolve_doc_classes
from knowledge_layer.search.hit_metadata import resolve_folder_paths

from agent.common.estate_paths import estate_path

logger = logging.getLogger(__name__)

_CHUNK_TRUNCATE_CHARS = 2500
PASSAGE_MAX_CHARS = _CHUNK_TRUNCATE_CHARS


def _hit_provenance(chunk):
    from agent.common.provenance import parse_agent_provenance

    return parse_agent_provenance(chunk.metadata or {})


def _chunk_shelf(chunk):
    from agent.common.source_kinds import parse_shelf

    return parse_shelf((chunk.metadata or {}).get("shelf"))


def _ambiguous_file_names(chunks) -> set[str]:
    shelves_by_name: dict[str, set] = {}
    for chunk in chunks:
        name = (chunk.file_name or "").strip()
        if not name:
            continue
        shelves_by_name.setdefault(name.lower(), set()).add(_chunk_shelf(chunk))
    return {name for name, shelves in shelves_by_name.items() if len(shelves) > 1}


def _citation_key_for(file_name: str, shelf, page: int | None, ambiguous: set[str]) -> str:
    from agent.common.source_kinds import shelf_qualifier

    name = file_name
    qualifier = shelf_qualifier(shelf) if name and name.lower() in ambiguous else None
    if qualifier:
        name = f"{name} ({qualifier})"
    return f"{name}, p.{page}" if page is not None else name


def _stored_image_index(metadata: dict) -> int | None:
    index = metadata.get("stored_image_index")
    if index is None or not metadata.get("image_key"):
        return None
    try:
        return int(index)
    except TypeError, ValueError:
        logger.warning("Ignoring unreadable stored_image_index %r", index)
        return None


_IMAGE_FILE_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".heic", ".heif")


_WHOLE_FRAME_AREA = 0.9


def _hit_regions(chunk) -> tuple:
    from agent.common.grounding_block import SourceRegion

    metadata = chunk.metadata or {}
    raw = metadata.get("drawing_data")
    if not raw:
        return ()
    if metadata.get("image_index") is not None and not str(chunk.file_name).lower().endswith(_IMAGE_FILE_SUFFIXES):
        return ()
    try:
        segment = json.loads(raw).get("segment") or {}
        coords = [float(part) for part in segment.get("bbox") or ()]
    except TypeError, ValueError, AttributeError:
        return ()
    if len(coords) != 4 or not all(math.isfinite(part) for part in coords):
        return ()
    x0, y0, x1, y1 = (min(1.0, max(0.0, part)) for part in coords)
    if x1 <= x0 or y1 <= y0 or (x1 - x0) * (y1 - y0) >= _WHOLE_FRAME_AREA:
        return ()
    title = segment.get("title")
    label = title.strip() if isinstance(title, str) and title.strip() else None
    return (SourceRegion(box=(x0, y0, x1, y1), label=label),)


def _metadata_text(value: object) -> str | None:
    return str(value) if value else None


def grounding_hit(chunk, *, resolved, resolved_titles, resolved_folders, ambiguous: set[str]):
    from agent.common.grounding_block import GroundingHit
    from agent.common.licensed_text import EDITION_KEY
    from agent.common.licensed_text import licence_from_metadata

    metadata = chunk.metadata or {}
    shelf = _chunk_shelf(chunk)
    page = chunk.page_number if chunk.page_number and chunk.page_number > 0 else None
    content = chunk.content
    truncated = len(content) > _CHUNK_TRUNCATE_CHARS
    folder_path = hit_folder_path(chunk, resolved_folders)
    return GroundingHit(
        citation_key=_citation_key_for(chunk.file_name, shelf, page, ambiguous),
        file_name=chunk.file_name,
        page=page,
        shelf=shelf,
        collection=_metadata_text(metadata.get("collection")),
        doc_class=hit_doc_class(chunk, resolved),
        display_title=hit_display_title(chunk, resolved_titles) or chunk.file_name,
        folder_path=folder_path,
        clause=_metadata_text(metadata.get("clause_id")),
        score=chunk.score,
        content_type=chunk.content_type.value,
        provenance=_hit_provenance(chunk),
        stored_image_index=_stored_image_index(metadata),
        status_note=None,
        body=content[:_CHUNK_TRUNCATE_CHARS] if truncated else content,
        body_truncated=truncated,
        regions=_hit_regions(chunk),
        page_end=_page_end(chunk, page),
        source_format=_metadata_text(metadata.get("source_format")),
        path=estate_path(shelf, folder_path, chunk.file_name) if chunk.file_name else None,
        licence=licence_from_metadata(metadata),
        revision=_hit_revision(chunk.file_name, shelf),
        edition_id=_metadata_text(metadata.get(EDITION_KEY)),
    )


def _hit_revision(file_name: str | None, shelf):
    from knowledge_layer.revision_series import parse_revision_name

    from agent.common.grounding_block import SourceRevision
    from agent.common.source_kinds import Shelf

    if not file_name or shelf is None or shelf == Shelf.BASE:
        return None
    named = parse_revision_name(file_name)
    if named is None:
        return None
    return SourceRevision(index=named.index.value if named.index else None, date=named.date)


def _page_end(chunk, page: int | None) -> int | None:
    end = str((chunk.metadata or {}).get("page_end") or "")
    return int(end) if page is not None and end.isdigit() and int(end) > page else None


def grounding_hits(chunks) -> tuple:
    resolved = resolve_doc_classes(chunks)
    resolved_titles = resolve_display_titles(chunks)
    resolved_folders = resolve_folder_paths(chunks)
    ambiguous = _ambiguous_file_names(chunks)
    return tuple(
        grounding_hit(
            chunk,
            resolved=resolved,
            resolved_titles=resolved_titles,
            resolved_folders=resolved_folders,
            ambiguous=ambiguous,
        )
        for chunk in chunks
    )
