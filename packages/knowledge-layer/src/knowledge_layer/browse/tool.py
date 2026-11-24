from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Sequence
from typing import Any
from typing import Literal

from pydantic import Field

from agent.common.action_outcome import ActionOutcome
from agent.common.action_rows import ActionRow
from nat.plugin_api import Builder
from nat.plugin_api import FunctionBaseConfig
from nat.plugin_api import FunctionInfo
from nat.plugin_api import FunctionRef
from nat.plugin_api import register_function

from .compare import _PREVIOUS_WORDS  # noqa: F401
from .compare import _change_line_between  # noqa: F401
from .compare import _stored_chunks  # noqa: F401
from .compare import compare_files  # noqa: F401
from .compare import resolve_compare  # noqa: F401
from .matches import MAX_DISTINCT_CHARS  # noqa: F401
from .matches import MAX_DISTINCT_FILES  # noqa: F401
from .matches import MAX_DISTINCT_MATCHES  # noqa: F401
from .matches import MAX_DISTINCT_PAGES  # noqa: F401
from .matches import MAX_MATCH_CHUNKS  # noqa: F401
from .matches import MAX_MATCH_PASSAGES  # noqa: F401
from .matches import MAX_TRACKED_STRINGS  # noqa: F401
from .matches import FileMatches  # noqa: F401
from .matches import _distinct_lines  # noqa: F401
from .matches import _matched_strings  # noqa: F401
from .matches import _occurrences  # noqa: F401
from .matches import distinct_matches  # noqa: F401
from .matches import group_matches  # noqa: F401
from .matches import pick_passages  # noqa: F401
from .messages import MAX_CONTEXT_LINES  # noqa: F401
from .messages import MAX_SNIPPET_LINES  # noqa: F401
from .messages import _chunk_snippets  # noqa: F401
from .messages import _context_lines  # noqa: F401
from .messages import _context_ranges  # noqa: F401
from .messages import _line_spans  # noqa: F401
from .messages import match_snippets  # noqa: F401
from .messages import match_table  # noqa: F401
from .messages import no_match_message  # noqa: F401
from .messages import search_failed_message  # noqa: F401
from .patterns import _CAPPED_WITHOUT_OWN_MATCH  # noqa: F401
from .patterns import _EQUIVALENT  # noqa: F401
from .patterns import _INFLECTED_MIN_CHARS  # noqa: F401
from .patterns import _INFLECTION_ENDINGS  # noqa: F401
from .patterns import _NEEDS_A_ANCHOR  # noqa: F401
from .patterns import _SEPARATOR  # noqa: F401
from .patterns import _SEPARATOR_CHARS  # noqa: F401
from .patterns import _STEM_MIN_CHARS  # noqa: F401
from .patterns import _TOKEN  # noqa: F401
from .patterns import _TOO_COSTLY  # noqa: F401
from .patterns import _TOO_COSTLY_SCAN  # noqa: F401
from .patterns import MAX_ALTERNATIVES  # noqa: F401
from .patterns import MAX_PATTERN_CHARS  # noqa: F401
from .patterns import MAX_USER_PATTERN_CHARS  # noqa: F401
from .patterns import MIN_PHRASE_CHARS  # noqa: F401
from .patterns import WHOLE_WORD_MAX_CHARS  # noqa: F401
from .patterns import _phrase_pattern  # noqa: F401
from .patterns import inflection_stem  # noqa: F401
from .patterns import phrase_pattern  # noqa: F401
from .patterns import split_alternatives  # noqa: F401
from .patterns import stemmed_pattern  # noqa: F401
from .patterns import user_pattern  # noqa: F401
from .render import MAX_CHAIN_CHANGE_CHARS  # noqa: F401
from .render import MAX_CHANGE_CHARS  # noqa: F401
from .render import _change_bit  # noqa: F401
from .render import _change_text  # noqa: F401
from .render import _compared_with_own_upload  # noqa: F401
from .render import _in_flight_line  # noqa: F401
from .render import _row_line  # noqa: F401
from .render import _scope_of  # noqa: F401
from .render import render_listing  # noqa: F401
from .revisions import _EXTENSION  # noqa: F401
from .revisions import MAX_CHAIN_CANDIDATES  # noqa: F401
from .revisions import MAX_CHAIN_LINES  # noqa: F401
from .revisions import _by_title_block  # noqa: F401
from .revisions import _chain_candidates  # noqa: F401
from .revisions import _chain_line  # noqa: F401
from .revisions import _chain_members  # noqa: F401
from .revisions import _chain_order  # noqa: F401
from .revisions import _name_order  # noqa: F401
from .revisions import _resolve_chain  # noqa: F401
from .revisions import _series_ident  # noqa: F401
from .revisions import _sheet_order  # noqa: F401
from .revisions import _with_supersedes  # noqa: F401
from .revisions import render_revisions  # noqa: F401
from .rows import _SHELF_LABELS  # noqa: F401
from .rows import DEFAULT_PAGE_SIZE  # noqa: F401
from .rows import KNOWN_SHELVES  # noqa: F401
from .rows import MAX_FOLDER_LINES  # noqa: F401
from .rows import MAX_PAGE_SIZE  # noqa: F401
from .rows import MAX_ROW_FACTS  # noqa: F401
from .rows import MAX_ROW_REFERENCES  # noqa: F401
from .rows import MAX_SUMMARY_CHARS  # noqa: F401
from .rows import MAX_TOPIC_COUNTS  # noqa: F401
from .rows import MAX_TYPE_COUNTS  # noqa: F401
from .rows import USER_SHELVES  # noqa: F401
from .rows import FileRow  # noqa: F401
from .rows import Listing  # noqa: F401
from .rows import _attr  # noqa: F401
from .rows import _check_shelf
from .rows import _folder_matches  # noqa: F401
from .rows import _in_folder  # noqa: F401
from .rows import _reading_fields  # noqa: F401
from .rows import _RowKey  # noqa: F401
from .rows import _state_label  # noqa: F401
from .rows import _subfolders  # noqa: F401
from .rows import _topic_profile  # noqa: F401
from .rows import _type_profile  # noqa: F401
from .rows import confirmed_revision_marks  # noqa: F401
from .rows import file_row  # noqa: F401
from .rows import file_rows  # noqa: F401
from .rows import on_shelves  # noqa: F401
from .rows import revision_marks  # noqa: F401
from .rows import select_files  # noqa: F401
from .rows import title_block_marks  # noqa: F401
from .scope import _STEMMED_NOTE  # noqa: F401
from .scope import _TOLERATED  # noqa: F401
from .scope import _TOLERATED_REGEX  # noqa: F401
from .scope import ShelfScope  # noqa: F401
from .scope import _candidate_lines  # noqa: F401
from .scope import _collection_names  # noqa: F401
from .scope import _failed_note  # noqa: F401
from .scope import _scope_statement  # noqa: F401
from .scope import _shelf_lines  # noqa: F401
from .scope import _wanted  # noqa: F401
from .scope import shelf_scopes  # noqa: F401
from .search import SEARCH_SHELVES  # noqa: F401
from .search import _candidate_counts  # noqa: F401
from .search import _collection_filter  # noqa: F401
from .search import _has_literal_word  # noqa: F401
from .search import entries_on_shelf  # noqa: F401
from .text import _FOLD  # noqa: F401
from .text import _coerce_int
from .text import _pages_label  # noqa: F401
from .text import _shorten  # noqa: F401
from .text import _words  # noqa: F401
from .text import fold  # noqa: F401
from .tool_text import _LIST_FILES_DESCRIPTION
from .tree import DEFAULT_TREE_DEPTH  # noqa: F401
from .tree import MAX_CARD_FILES  # noqa: F401
from .tree import MAX_CARD_SUBFOLDERS  # noqa: F401
from .tree import MAX_CURRENT_LINES  # noqa: F401
from .tree import MAX_REPLACED_NAMES  # noqa: F401
from .tree import MAX_TREE_CARDS  # noqa: F401
from .tree import MAX_TREE_DEPTH  # noqa: F401
from .tree import TREE_PARAGRAPH  # noqa: F401
from .tree import FolderCard  # noqa: F401
from .tree import _card_ancestors  # noqa: F401
from .tree import _card_lines  # noqa: F401
from .tree import _card_order  # noqa: F401
from .tree import _confirmed_head  # noqa: F401
from .tree import _count  # noqa: F401
from .tree import _current_lines  # noqa: F401
from .tree import _folder_card  # noqa: F401
from .tree import _revision_series  # noqa: F401
from .tree import _Series  # noqa: F401
from .tree import _series_label  # noqa: F401
from .tree import abstract_lines  # noqa: F401
from .tree import folder_cards  # noqa: F401
from .tree import render_tree  # noqa: F401
from .turn import TurnRows  # noqa: F401
from .turn import _entry_shelf  # noqa: F401
from .turn import _readable_rows  # noqa: F401
from .turn import _scope_entries  # noqa: F401
from .turn import _session_collection  # noqa: F401
from .turn import restrict_rows_to_turn  # noqa: F401
from .turn import shelf_restricted_message  # noqa: F401

logger = logging.getLogger(__name__)


_EQUIVALENT.update({"ae": _EQUIVALENT["ä"], "oe": _EQUIVALENT["ö"], "ue": _EQUIVALENT["ü"], "ss": _EQUIVALENT["ß"]})


async def _turn_rows(search_config: Any) -> list[FileRow]:
    from agent.knowledge.restricted_collections import is_restricted_collection

    return [row for row in await _readable_rows(search_config) if not is_restricted_collection(row.collection)]


def _in_flight(collections: Sequence[str]) -> list[str]:
    from agent.knowledge import ingest_status_store

    try:
        pending = ingest_status_store.in_flight_files(list(collections))
    except Exception:  # noqa: BLE001 — a status read never costs the listing
        return []
    return list(dict.fromkeys(name for names in pending.values() for name in names))


class ListFilesConfig(FunctionBaseConfig, name="list_files"):
    knowledge_search: FunctionRef = Field(
        default=FunctionRef("knowledge_search"),
        description="The `knowledge_retrieval` instance whose collection scope this browser shares.",
    )


@register_function(config_type=ListFilesConfig)
async def list_files(config: ListFilesConfig, _builder: Builder):
    search_config = _builder.get_function_config(config.knowledge_search)

    async def _list(
        folder: str | None = None,
        name_contains: str | None = None,
        doc_class: str | None = None,
        added_since: str | None = None,
        shelf: str | None = None,
        sort: str | None = None,
        offset: int | str | None = None,
        limit: int | str | None = None,
        topic: str | None = None,
        revisions_of: str | None = None,
        compare_to: str | None = None,
        view: Literal["files", "tree"] | None = None,
        depth: int | str | None = None,
    ) -> str:
        outcome = ActionOutcome()
        row = ActionRow(
            "list",
            target=(revisions_of or "").strip() or (folder or "").strip().strip("/"),
            query=name_contains,
            shelf=shelf,
        )
        try:
            result = await _list_body(
                search_config,
                outcome,
                folder,
                name_contains,
                doc_class,
                added_since,
                shelf,
                sort,
                offset,
                limit,
                topic,
                revisions_of,
                compare_to,
                view,
                depth,
            )
        except BaseException:
            row.finish("error")
            raise
        outcome.settle(row, default="ok" if outcome.completed else "error", target=outcome.target)
        return result

    yield FunctionInfo.from_fn(_list, description=_LIST_FILES_DESCRIPTION)


async def _list_body(
    search_config: Any,
    outcome: ActionOutcome,
    folder: str | None,
    name_contains: str | None,
    doc_class: str | None,
    added_since: str | None,
    shelf: str | None,
    sort: str | None,
    offset: int | str | None,
    limit: int | str | None,
    topic: str | None,
    revisions_of: str | None,
    compare_to: str | None,
    view: Literal["files", "tree"] | None,
    depth: int | str | None,
) -> str:
    shelf, refusal = _check_shelf(shelf)
    if refusal:
        return refusal
    if (revisions_of or "").strip():
        return await _revisions_answer(search_config, outcome, shelf, revisions_of, compare_to)
    sort = (sort or "folder").strip().lower()
    if sort not in ("folder", "name", "newest"):
        return "`sort` must be folder, name or newest."
    added_since = (added_since or "").strip() or None
    if added_since and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", added_since):
        return "`added_since` must be a date written YYYY-MM-DD."
    doc_class, refusal = _canonical_doc_class(doc_class)
    if refusal:
        return refusal

    view = (view or "files").strip().lower()
    if view not in ("files", "tree"):
        return "`view` must be files or tree."
    turn = restrict_rows_to_turn(await _turn_rows(search_config))
    if shelf and turn.allowed is not None and shelf not in turn.allowed:
        return shelf_restricted_message(shelf, turn.allowed)
    rows = turn.rows
    tree = view == "tree"
    listing = select_files(
        rows,
        default_shelves=turn.own_shelves,
        shelf=shelf,
        folder=(folder or "").strip().strip("/") or None,
        name_contains=(name_contains or "").strip() or None,
        doc_class=doc_class,
        added_since=added_since,
        topic=(topic or "").strip() or None,
        sort=sort,
        offset=0 if tree else _coerce_int(offset, 0, low=0, high=100_000),
        limit=len(rows) + 1 if tree else _coerce_int(limit, DEFAULT_PAGE_SIZE, low=1, high=MAX_PAGE_SIZE),
    )
    return await _listing_answer(outcome, turn, listing, shelf=shelf, view=view, depth=depth)


async def _revisions_answer(
    search_config: Any,
    outcome: ActionOutcome,
    shelf: str | None,
    revisions_of: str | None,
    compare_to: str | None,
) -> str:
    turn = restrict_rows_to_turn(await _turn_rows(search_config))
    if shelf and turn.allowed is not None and shelf not in turn.allowed:
        return shelf_restricted_message(shelf, turn.allowed)
    if compare_to is not None:
        pair, refusal = resolve_compare(
            turn.rows, revisions_of or "", compare_to, shelf=shelf, default_shelves=turn.own_shelves
        )
        if pair is None:
            return refusal
        return await compare_files(pair)
    outcome.completed = True
    return render_revisions(turn.rows, revisions_of or "", shelf=shelf, default_shelves=turn.own_shelves)


def _canonical_doc_class(doc_class: str | None) -> tuple[str | None, str | None]:
    doc_class = (doc_class or "").strip() or None
    if doc_class is None:
        return None, None
    from agent.knowledge.document_classification import DOCUMENT_CLASSES
    from agent.knowledge.document_classification import canonical_doc_class

    current_doc_class = canonical_doc_class(doc_class)
    if current_doc_class is None:
        return None, f"Invalid doc_class {doc_class!r}. Valid values: {', '.join(DOCUMENT_CLASSES)}."
    return current_doc_class, None


async def _listing_answer(
    outcome: ActionOutcome,
    turn: TurnRows,
    listing: Listing,
    *,
    shelf: str | None,
    view: str,
    depth: int | str | None,
) -> str:
    rows = turn.rows
    tree = view == "tree"
    collections = sorted({row.collection for row in rows if row.shelf in listing.shelves and row.collection})
    in_flight = await asyncio.to_thread(_in_flight, collections) if collections else []
    logger.info("list_files: %d of %d row(s) selected, view=%s", listing.total, len(rows), view)
    outcome.completed = True
    outcome.target = listing.folder
    outcome.files = len(listing.rows)
    if not tree:
        outcome.folders = len(listing.subfolders)
        return render_listing(listing, in_flight=in_flight)
    cards = folder_cards(
        listing.rows,
        root=listing.folder,
        depth=_coerce_int(depth, DEFAULT_TREE_DEPTH, low=1, high=MAX_TREE_DEPTH),
        series_rows=on_shelves(rows, shelf=shelf, default_shelves=turn.own_shelves),
    )
    from agent.knowledge.folder_cards import listing_abstracts

    outcome.folders = len(cards)
    return render_tree(
        cards,
        total_rows=listing.total,
        notes=listing.notes,
        scope=_scope_of(listing),
        in_flight=in_flight,
        abstracts=abstract_lines(await listing_abstracts(collections)),
    )
