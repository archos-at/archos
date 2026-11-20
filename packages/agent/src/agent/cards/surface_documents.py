from __future__ import annotations

import asyncio
import logging

from agent.cards.surface_briefing import _briefing_for_agent
from agent.cards.surface_browse import _browse_workspace_search
from agent.cards.surface_browse import _search_line
from agent.cards.surface_ranking import MAX_SURFACED_FILES
from agent.cards.surface_ranking import SurfaceMode
from agent.cards.surface_retrieval import _surface_named
from agent.cards.surface_retrieval import _surface_search
from agent.cards.surface_targets import _filename_mentioned_in_query
from agent.cards.surface_targets import _match_known_filename
from agent.cards.surface_targets import _target_collections
from agent.cards.surface_targets import _target_shelves
from nat.plugin_api import Builder
from nat.plugin_api import FunctionBaseConfig
from nat.plugin_api import FunctionInfo
from nat.plugin_api import register_function

logger = logging.getLogger(__name__)

_CHUNK_TOP_K = 40

_SHELF_OF_SOURCE: dict[str, str] = {"project": "project", "office": "office_shelf"}


class SurfaceDocumentsConfig(FunctionBaseConfig, name="surface_documents"): ...


_TOOL_DESCRIPTION = (
    "Show the user a REAL project or Büroablage FILE in the UI (preview card). "
    "This is not a citation tool — it does not return quotable passages.\n"
    "WHEN TO CALL — the user asked to SEE or BROWSE their own files, with no "
    "legal question to answer. Examples: 'zeig mir den Brandschutzplan', "
    "'öffne Schnitt.pdf', 'welche Unterlagen habe ich zu Fluchtwegen'.\n"
    "- `filename=` the exact indexed name (inventory or the user) when they "
    "named a file. Opens that one file.\n"
    "- `mode=one` (default) + `query=` when they asked to see the best matching "
    "file and you do not have the name. Opens one file. Not a follow-up to a "
    "citation.\n"
    "- `mode=many` + `query=` only when they are choosing among two or three "
    "NEARLY EQUALLY relevant files of the same kind. Never a catalogue, never "
    "the inventory.\n"
    "- `shelf=office_shelf` / `shelf=project` when they asked to see files on ONE "
    "shelf (Büroablage vs this project). Do not mix the two.\n"
    "Asking for files of a KIND ('hab ich sonst noch Grundrisse', 'welche Fotos "
    "vom Bestand') is a browse: `mode=many` on that shelf, so they can open them.\n"
    "WHEN NOT TO CALL — to say what is on a shelf ('welche Dateien hast du im "
    "Büroablage'), answer from the knowledge-base inventory, or from a listing "
    "where the inventory is incomplete or the question filters by folder, name or "
    "date; file names written in the answer already open on click. To read, "
    "quote, or cite a passage, use `knowledge_search`. "
    "The UI already peeks the cited file; do not also call this tool after citing. "
    "Do not use this for OIB / RIS / web questions.\n"
    "Never invent filenames. After a successful call, talk about the file in "
    "prose; do not dump a filename list."
)


@register_function(config_type=SurfaceDocumentsConfig)
async def surface_documents(tool_config: SurfaceDocumentsConfig, builder: Builder):
    async def _surface(
        query: str = "",
        filename: str | None = None,
        title: str | None = None,
        mode: str | None = None,
        shelf: str | None = None,
    ) -> str:
        query = (query or "").strip()
        filename = (filename or "").strip() or None
        shelf = (shelf or "").strip() or None
        if mode is not None and mode not in ("one", "many"):
            return "Error: `mode` must be `one` (open the best file) or `many` (short browse choice)."
        if shelf == "archiv":  # the argument's old value; remove after one release
            shelf = "office_shelf"
        if shelf is not None and shelf not in ("office_shelf", "project"):
            return "Error: `shelf` must be `office_shelf` (Büroablage) or `project` (this project)."
        if not query and not filename:
            return "Provide `filename=` (open this named file) or `query=` (search). Use `mode=many` only to browse."
        return await _surface_for(query, filename, title, mode, shelf)

    yield FunctionInfo.from_fn(_surface, description=_TOOL_DESCRIPTION)


async def _surface_for(query: str, filename: str | None, title: str | None, mode: str | None, shelf: str | None) -> str:
    from agent.knowledge.inventory import shelf_hint_from_query

    scoped_entries, scope = _scope_from_context()

    hinted = shelf_hint_from_query(query)
    hinted_value = hinted.value if hinted is not None else None
    resolved_shelf = shelf or (hinted_value if hinted_value in ("office_shelf", "project") else None)
    targets = _target_collections(scope, shelf=resolved_shelf, scoped=scoped_entries)
    if not targets:
        return _nothing_in_scope(resolved_shelf)

    meta = await _fetch_document_metadata(targets)
    known_names = list(meta.keys())

    named = filename
    if named:
        named = _match_known_filename(named, known_names)
    if filename and not named and not query:
        return (
            f"No indexed file matches filename={filename!r}. "
            "Check the spelling against the knowledge-base inventory, "
            "or pass a short topic `query` with `mode=many` to browse."
        )
    if not named and query:
        named = _filename_mentioned_in_query(query, known_names)

    effective: SurfaceMode = "many" if mode == "many" and not named else "one"
    documents, search = await _found_documents(named, query, targets, meta, effective, scoped_entries)
    if not documents:
        subject = filename or query
        return (
            f"No project or Büroablage file matched {subject!r}. "
            "Try a narrower `query` (a filename fragment, a Dokumentart, a project name) "
            "or check the knowledge-base inventory for the exact `filename` spelling."
        )
    _add_metadata(documents, meta)
    return _offer_card(documents, search, title, query, filename, effective)


def _scope_from_context() -> tuple[list | None, list[str] | None]:
    from agent.knowledge.scoping import get_collection_scope_from_context
    from agent.knowledge.scoping import get_scoped_collections_from_context

    try:
        scoped_entries = get_scoped_collections_from_context()
    except Exception:
        logger.debug("surface_documents: could not read scoped collections", exc_info=True)
        scoped_entries = None
    try:
        scope = get_collection_scope_from_context()
    except Exception:
        logger.debug("surface_documents: could not read collection scope", exc_info=True)
        scope = None
    return scoped_entries, scope


def _nothing_in_scope(resolved_shelf: str | None) -> str:
    if resolved_shelf == "office_shelf":
        return (
            "No Büroablage documents are in scope to search. The OIB corpus is "
            "Basiswissen, not the Büroablage — answer from the inventory's "
            "Büroablage group (empty means empty)."
        )
    return (
        "No project or Büroablage documents are in scope to search, so there is "
        "nothing to surface. Answer from the other available sources instead."
    )


async def _found_documents(
    named: str | None,
    query: str,
    targets: list[str],
    meta: dict[str, dict],
    effective: SurfaceMode,
    scoped_entries: list | None,
) -> tuple[list[dict], dict | None]:
    from agent.common.retrieval_settings import get_retrieval_setting

    chunk_top_k = get_retrieval_setting("surface.chunk_top_k", _CHUNK_TOP_K)
    max_files = get_retrieval_setting("surface.max_files", MAX_SURFACED_FILES)
    if named:
        return await _surface_named(named, targets, meta, query or named, chunk_top_k), None
    browsed = None
    if effective == "many":
        browsed = await _browse_workspace_search(query, _target_shelves(targets, scoped_entries), max_files)
    if browsed is not None:
        return browsed
    return await _surface_search(query, targets, effective, chunk_top_k, max_files), None


def _add_metadata(documents: list[dict], meta: dict[str, dict]) -> None:
    for doc in documents:
        info = meta.get(doc["file_name"])
        if info:
            _copy_metadata(doc, info)


def _copy_metadata(doc: dict, info: dict) -> None:
    if info.get("summary"):
        doc["summary"] = info["summary"]
    doc["_tags"] = info.get("tags") or []
    doc["_folder_path"] = info.get("folder_path") or None


def _offer_card(
    documents: list[dict],
    search: dict | None,
    title: str | None,
    query: str,
    filename: str | None,
    effective: SurfaceMode,
) -> str:
    from agent.cards.models import answer_card_adapter
    from agent.cards.registry import get_card_registry

    heading = (title or "").strip()
    if not heading:
        heading = documents[0]["file_name"] if effective == "one" else f"Passende Unterlagen – {query}"

    card = {
        "type": "document_grid",
        "title": heading,
        "query": query or filename,
        "documents": [{k: v for k, v in doc.items() if not k.startswith("_")} for doc in documents],
    }
    if search is not None:
        card["search"] = {"text": search["text"], "scope": search["scope"]}
    try:
        validated = answer_card_adapter.validate_python(card).model_dump(exclude_none=True)
    except Exception as exc:
        logger.exception("surface_documents: failed to build document_grid card")
        return f"Error: could not build the document card ({exc})."

    registry = get_card_registry()
    if registry is None:
        logger.info("surface_documents: no card registry; %d file(s) dropped", len(documents))
        return "Noted, but no card channel is available in this context; continue with your written answer."

    registry.add(validated)
    from agent.common.turn_status import record_lane_hit

    for doc in documents:
        record_lane_hit(str(doc["file_name"]), shelf=_SHELF_OF_SOURCE.get(str(doc.get("source") or "")))
    logger.info(
        "surface_documents: mode=%s surfaced %d file(s) query=%r filename=%r",
        effective,
        len(documents),
        query,
        filename,
    )
    briefing = _briefing_for_agent(query or filename or "", documents, effective)
    if search is not None:
        briefing = f"{briefing}\n{_search_line(search)}"
    return briefing


async def _fetch_document_metadata(collections: list[str]) -> dict[str, dict]:
    from agent.knowledge.factory import get_available_documents_async

    async def _for(collection: str) -> list:
        try:
            return await get_available_documents_async(collection)
        except Exception:
            logger.debug("surface_documents: metadata lookup failed for %s", collection, exc_info=True)
            return []

    out: dict[str, dict] = {}
    for docs in await asyncio.gather(*(_for(c) for c in collections)):
        _add_documents(out, docs)
    return out


def _add_documents(out: dict[str, dict], docs: list) -> None:
    for doc in docs:
        name = getattr(doc, "file_name", None)
        if name and name not in out:
            out[name] = {
                "summary": getattr(doc, "summary", None),
                "tags": getattr(doc, "tags", None),
                "folder_path": getattr(doc, "folder_path", None),
            }
