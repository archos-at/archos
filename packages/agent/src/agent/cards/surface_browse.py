from __future__ import annotations

import asyncio
import logging
from typing import Literal

from agent.cards.surface_briefing import _clip
from agent.cards.surface_ranking import _pick_browse

logger = logging.getLogger(__name__)

WORKSPACE_SEARCH_OPERATION = "workspace-search"
_WORKSPACE_SEARCH_LIMIT = 10
_SOURCE_OF_HIT_SHELF: dict[str, Literal["project", "office"]] = {"project": "project", "office_shelf": "office"}


def _search_scopes(shelves: set[str], project_id: str | None) -> list[dict[str, str]]:
    scopes: list[dict[str, str]] = []
    if "project" in shelves and project_id:
        scopes.append({"scope": "project", "projectId": project_id})
    if "office_shelf" in shelves:
        scopes.append({"scope": "office_shelf"})
    return scopes


def _rows_from_search(structured: dict) -> list[dict]:
    section = (structured.get("sections") or {}).get("document") or {}
    rows: list[dict] = []
    for hit in section.get("hits") or []:
        if not isinstance(hit, dict):
            continue
        file_name = str(hit.get("filename") or "").strip()
        source = _SOURCE_OF_HIT_SHELF.get(str(hit.get("shelf") or ""))
        if not file_name or source is None:
            continue
        passage = hit.get("passage") if isinstance(hit.get("passage"), dict) else {}
        snippet = _clip(passage.get("text"), 300)
        page = passage.get("page")
        rows.append(
            {
                "file_name": file_name,
                "snippet": snippet,
                "page": page if isinstance(page, int) and page > 0 else None,
                "source": source,
                "_folder_path": hit.get("folderName") or None,
            }
        )
    return rows


def _interleave(groups: list[list[dict]]) -> list[dict]:
    merged: list[dict] = []
    seen: set[str] = set()
    for rank in range(max((len(group) for group in groups), default=0)):
        _take_rank(groups, rank, seen, merged)
    return merged


def _take_rank(groups: list[list[dict]], rank: int, seen: set[str], merged: list[dict]) -> None:
    for group in groups:
        if rank < len(group) and group[rank]["file_name"] not in seen:
            seen.add(group[rank]["file_name"])
            merged.append(group[rank])


async def _browse_workspace_search(query: str, shelves: set[str], max_files: int) -> tuple[list[dict], dict] | None:
    from agent.project_context import get_project_id_from_context
    from agent.tools.workspace.register import read_operation

    text = query.strip()[:500]
    scopes = _search_scopes(shelves, get_project_id_from_context())
    if not text or not scopes:
        return None
    body = {"text": text, "kinds": ["document"], "limit": _WORKSPACE_SEARCH_LIMIT, "facets": False}
    answers = await asyncio.gather(
        *(read_operation(WORKSPACE_SEARCH_OPERATION, {"query": scope, "body": body}) for scope in scopes)
    )
    if any(answer is None for answer in answers):
        logger.info("surface_documents: workspace-search did not answer; browsing the corpora")
        return None
    total = sum(int(((answer.get("sections") or {}).get("document") or {}).get("total") or 0) for answer in answers)
    documents = _pick_browse(_interleave([_rows_from_search(answer) for answer in answers]), text, max_files)
    scope = scopes[0]["scope"] if len(scopes) == 1 else "office"
    return documents, {"text": text, "scope": scope, "total": total}


def _search_line(search: dict) -> str:
    return (
        f"The workspace search finds {search['total']} document(s) for {search['text']!r}; the card links to the "
        "search page with this query for the rest."
    )
