from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from collections.abc import Iterable
from collections.abc import Sequence
from typing import Any

import httpx
from fastapi import APIRouter
from fastapi import Header
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field

from agent.common import provider_limiter
from agent.common.openrouter import limited_async_http_client
from agent.observability.direct_trace import observed_generation

from ._llm_json import extract_json_object
from ._llm_json import message_content
from .filing_fit import MAX_FOLDERS
from .filing_fit import MAX_SCORED_FOLDERS
from .filing_fit import FilingFolder
from .filing_fit import FilingTrace
from .filing_fit import _option
from .filing_fit import _path_key
from .filing_fit import _score_state
from .filing_fit import _without_empty
from .generate_summary import _llm_settings

logger = logging.getLogger(__name__)

MAP_TRACE = "folder-proposals.map"
REDUCE_TRACE = "folder-proposals.reduce"
SCORE_SLOT = "folder-proposals"

MAX_DOCUMENTS = 1000
MAP_CHUNK = 100
MAP_CONCURRENCY = 5
MAX_PROPOSALS = 12
MAX_NAME = 255
MAX_DESCRIPTION = 500
MIN_DOCUMENTS = 2
MAX_TOKENS = 3000

_REQUEST_TIMEOUT_SECONDS = 45.0
VERIFY_BUDGET_S = 60.0

SYSTEM_PROMPT = (
    "An architecture office sorted the root of its shelf into its folders, and the documents below fit none "
    "of those folders. Group them into at most 12 NEW folders that a person in the office would create.\n"
    "Name each new folder in the language of the locale, the way the existing folders are named: match their "
    "numbering and style. Place it either at the root or directly under an existing folder, so its path is "
    'the existing folder\'s path, a "/", and the new name. Give it a one-sentence description of what belongs '
    "in it.\n"
    "Only group documents that clearly belong together. A folder needs at least 2 documents; leave out the "
    "rest. Never name an existing folder.\n"
    'Answer with JSON only: {"proposals": [{"path": "<folder path>", "description": "<one sentence>", '
    '"ids": ["<document id>"]}]}. Use only ids from DOCUMENTS. An empty list is a good answer.'
)

REDUCE_PROMPT = (
    "Candidate new folders were proposed for parts of an architecture office's shelf root, and the documents "
    "they cover fit none of its existing folders. Some candidates mean the same thing. Merge the candidates "
    "that mean the same thing into one folder, named consistently, and give each final folder a one-sentence "
    "description. Give at most 12 final folders. Each final folder is either at the root or directly under an "
    'existing folder, so its path is the existing folder\'s path, a "/", and the new name. Never name an '
    "existing folder. A candidate that belongs in no final folder is left out of every merge list.\n"
    'Answer with JSON only: {"folders": [{"path": "<folder path>", "description": "<one sentence>", '
    '"merge": ["<candidate path>"]}]}. Use only candidate paths from CANDIDATES.'
)

VERIFY_QUESTION = "Which of these new folders does this document belong in? Choose none when none fits."
NONE_OPTION = "None of these new folders fits the document."


class FolderProposalDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., min_length=1, max_length=64)
    file: str = Field(..., min_length=1, max_length=512)
    type: str | None = Field(None, max_length=80, description="Its Dokumentart, a person's or ingestion's.")
    tags: list[str] = Field(default_factory=list, max_length=10)
    summary: str | None = Field(None, max_length=300)


class FolderProposalsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    locale: str = Field("de", max_length=16)
    folders: list[FilingFolder] = Field(default_factory=list, max_length=MAX_FOLDERS)
    documents: list[FolderProposalDocument] = Field(..., max_length=MAX_DOCUMENTS)
    trace: FilingTrace


class FolderProposal(BaseModel):
    path: str
    description: str | None = None
    ids: list[str]
    confidences: dict[str, float] = Field(default_factory=dict)


class FolderProposalsResponse(BaseModel):
    proposals: list[FolderProposal] = Field(default_factory=list)
    model: str | None = None
    error: str | None = None
    trace_id: str | None = None


def _user_content(locale: str, folders: Sequence[FilingFolder], sections: Sequence[tuple[str, list[dict]]]) -> str:
    language = "German" if locale.lower().startswith("de") else "English"
    lines = [f"Write each folder name and description in {language}.", "", "FOLDERS"]
    lines += [json.dumps(_without_empty(folder.model_dump()), ensure_ascii=False) for folder in folders]
    for title, rows in sections:
        lines += ["", title]
        lines += [json.dumps(row, ensure_ascii=False) for row in rows]
    return "\n".join(lines)


def _document_rows(documents: Sequence[FolderProposalDocument]) -> list[dict]:
    return [_without_empty(document.model_dump()) for document in documents]


def _candidate_rows(candidates: Sequence[FolderProposal]) -> list[dict]:
    return [
        _without_empty({"path": candidate.path, "description": candidate.description, "documents": len(candidate.ids)})
        for candidate in candidates
    ]


def _checked_path(raw: object, existing: set[str]) -> str | None:
    if not isinstance(raw, str):
        return None
    segments = [segment.strip() for segment in raw.strip().split("/")]
    if any(not segment for segment in segments):
        return None
    if _path_key("/".join(segments)) in existing or len(segments[-1]) > MAX_NAME:
        return None
    parent = "/".join(segments[:-1])
    if parent and _path_key(parent) not in existing:
        return None
    return "/".join(segments)


def _checked_ids(raw: object, documents: set[str], used: set[str]) -> list[str]:
    if not isinstance(raw, list):
        return []
    ids: list[str] = []
    for value in raw:
        document_id = str(value)
        if document_id in documents and document_id not in used and document_id not in ids:
            ids.append(document_id)
    return ids


def _description(raw: object) -> str | None:
    return str(raw or "").strip()[:MAX_DESCRIPTION] or None


def _union(*lists: Sequence[str]) -> list[str]:
    return list(dict.fromkeys(document_id for ids in lists for document_id in ids))


def group_by_path(candidates: Iterable[FolderProposal]) -> list[FolderProposal]:
    grouped: dict[str, FolderProposal] = {}
    for candidate in candidates:
        key = _path_key(candidate.path)
        first = grouped.get(key)
        if first is None:
            grouped[key] = candidate
        else:
            grouped[key] = FolderProposal(
                path=first.path,
                description=first.description or candidate.description,
                ids=_union(first.ids, candidate.ids),
            )
    return list(grouped.values())


def _disjoint(folders: Sequence[FolderProposal], documents: set[str]) -> list[FolderProposal]:
    found: list[FolderProposal] = []
    used: set[str] = set()
    for folder in folders:
        if len(found) >= MAX_PROPOSALS:
            break
        ids = _checked_ids(folder.ids, documents, used)
        if len(ids) < MIN_DOCUMENTS:
            continue
        found.append(FolderProposal(path=folder.path, description=folder.description, ids=ids))
        used.update(ids)
    return found


def _checked_folders(
    raw: object, existing: set[str], documents: set[str], ids_of: Callable[[dict[str, Any]], object]
) -> list[FolderProposal] | None:
    if not isinstance(raw, list):
        return None
    named: list[FolderProposal] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        path = _checked_path(item.get("path"), existing)
        if path is not None:
            ids = _checked_ids(ids_of(item), documents, set())
            named.append(FolderProposal(path=path, description=_description(item.get("description")), ids=ids))
    return _disjoint(group_by_path(named), documents)


def _parse_proposals(
    data: dict[str, Any], folders: Sequence[FilingFolder], documents: Sequence[FolderProposalDocument]
) -> list[FolderProposal] | None:
    existing = {_path_key(folder.path) for folder in folders}
    return _checked_folders(
        data.get("proposals"), existing, {document.id for document in documents}, lambda item: item.get("ids")
    )


def parse_proposals(data: dict[str, Any], request: FolderProposalsRequest) -> list[FolderProposal] | None:
    return _parse_proposals(data, request.folders, request.documents)


def _merged_ids(merge: object, candidates: dict[str, FolderProposal]) -> list[str]:
    if not isinstance(merge, list):
        return []
    ids: list[str] = []
    for name in merge:
        candidate = candidates.get(_path_key(str(name)))
        if candidate is not None:
            ids.extend(candidate.ids)
    return ids


def _parse_final(
    data: dict[str, Any], folders: Sequence[FilingFolder], candidates: Sequence[FolderProposal]
) -> list[FolderProposal] | None:
    existing = {_path_key(folder.path) for folder in folders}
    by_key = {_path_key(candidate.path): candidate for candidate in candidates}
    documents = {document_id for candidate in candidates for document_id in candidate.ids}
    return _checked_folders(
        data.get("folders"), existing, documents, lambda item: _merged_ids(item.get("merge"), by_key)
    )


def _metadata(request: FolderProposalsRequest, **counts: int) -> dict[str, Any]:
    return {
        "batch_id": request.trace.batch_id,
        "project_id": request.trace.project_id or "",
        "shelf": request.trace.shelf,
        "folders": len(request.folders),
        **counts,
    }


async def _call(
    cred: Any, *, system: str, user: str, trace: str, metadata: dict[str, Any]
) -> tuple[dict[str, Any] | None, str | None, str | None]:
    payload = cred.request_body(
        {
            "model": cred.model,
            "temperature": 0,
            "max_tokens": MAX_TOKENS,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        }
    )
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {cred.api_key}"}
    trace_id: str | None = None
    try:
        async with (
            observed_generation(trace, model=cred.model, messages=payload["messages"], metadata=metadata) as generation,
            limited_async_http_client(cls=provider_limiter.INTERACTIVE, timeout=_REQUEST_TIMEOUT_SECONDS) as client,
        ):
            trace_id = generation.trace_id
            response = await client.post(f"{cred.base_url}/chat/completions", json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            generation.finish(data)
        content, _finish = message_content(data)
        return extract_json_object(content), None, trace_id
    except httpx.HTTPError as exc:
        logger.warning("Folder proposal LLM call failed: %s", type(exc).__name__)
        return None, "llm_request_failed", trace_id
    except KeyError, IndexError, TypeError, ValueError:
        logger.warning("Folder proposal LLM response had an unexpected shape")
        return None, "llm_response_malformed", trace_id


async def _map_chunk(
    cred: Any, request: FolderProposalsRequest, chunk: Sequence[FolderProposalDocument], gate: asyncio.Semaphore
) -> tuple[list[FolderProposal] | None, str | None]:
    user = _user_content(request.locale, request.folders, [("DOCUMENTS", _document_rows(chunk))])
    async with gate:
        answer, error, trace_id = await _call(
            cred,
            system=SYSTEM_PROMPT,
            user=user,
            trace=MAP_TRACE,
            metadata=_metadata(request, documents=len(chunk)),
        )
    if answer is None:
        logger.warning("Folder proposal chunk skipped: %s", error)
        return None, trace_id
    proposals = _parse_proposals(answer, request.folders, chunk)
    if proposals is None:
        logger.warning("Folder proposal chunk skipped: llm_response_malformed")
    return proposals, trace_id


async def _map_shelf(cred: Any, request: FolderProposalsRequest) -> tuple[list[list[FolderProposal]], str | None]:
    gate = asyncio.Semaphore(MAP_CONCURRENCY)
    documents = request.documents
    chunks = [documents[start : start + MAP_CHUNK] for start in range(0, len(documents), MAP_CHUNK)]
    results = await asyncio.gather(*(_map_chunk(cred, request, chunk, gate) for chunk in chunks))
    trace_id = next((trace for _proposals, trace in results if trace), None)
    answered = [proposals for proposals, _trace in results if proposals is not None]
    return answered, trace_id


async def _reduce(
    cred: Any, request: FolderProposalsRequest, candidates: Sequence[FolderProposal]
) -> tuple[list[FolderProposal] | None, str | None, str | None]:
    user = _user_content(request.locale, request.folders, [("CANDIDATES", _candidate_rows(candidates))])
    answer, error, trace_id = await _call(
        cred,
        system=REDUCE_PROMPT,
        user=user,
        trace=REDUCE_TRACE,
        metadata=_metadata(request, candidates=len(candidates)),
    )
    if answer is None:
        return None, error, trace_id
    final = _parse_final(answer, request.folders, candidates)
    if final is None:
        return None, "llm_response_malformed", trace_id
    return final, None, trace_id


async def _verify(
    documents: Sequence[FolderProposalDocument], proposals: Sequence[FolderProposal], organization_id: str | None
) -> None:
    from agent.common.decisions import choice
    from agent.common.decisions import decide_many

    if not proposals or len(proposals) > MAX_SCORED_FOLDERS:
        return
    slots = [(index, document_id) for index, proposal in enumerate(proposals) for document_id in proposal.ids]
    by_id = {document.id: document for document in documents}
    options = {f"f{index}": _option(proposal.path, proposal.description) for index, proposal in enumerate(proposals)}
    options["none"] = NONE_OPTION
    decisions = await decide_many(
        [_score_state(by_id[document_id]) for _index, document_id in slots],
        {"folder": choice(VERIFY_QUESTION, options)},
        slot=SCORE_SLOT,
        organization_id=organization_id,
    )
    _apply_confidences(proposals, slots, decisions)


def _apply_confidences(
    proposals: Sequence[FolderProposal], slots: Sequence[tuple[int, str]], decisions: Sequence[Any]
) -> None:
    for (index, document_id), decision in zip(slots, decisions, strict=True):
        if decision is None:
            continue
        _chosen, distribution = decision.choice("folder")
        proposals[index].confidences[document_id] = round(distribution.get(f"f{index}", 0.0), 3)


def _fallback(request: FolderProposalsRequest, candidates: Sequence[FolderProposal]) -> list[FolderProposal]:
    existing = {_path_key(folder.path) for folder in request.folders}
    valid = [candidate for candidate in candidates if _checked_path(candidate.path, existing) is not None]
    ranked = sorted(valid, key=lambda candidate: len(candidate.ids), reverse=True)
    return _disjoint(ranked, {document_id for candidate in ranked for document_id in candidate.ids})


async def _verify_within_budget(
    documents: Sequence[FolderProposalDocument], proposals: Sequence[FolderProposal], organization_id: str | None
) -> None:
    try:
        await asyncio.wait_for(_verify(documents, proposals, organization_id), timeout=VERIFY_BUDGET_S)
    except TimeoutError:
        logger.warning(
            "Folder proposal verification ran over %s s; keeping proposals without confidences", VERIFY_BUDGET_S
        )


async def _propose(cred: Any, request: FolderProposalsRequest, organization_id: str | None) -> FolderProposalsResponse:
    answered, trace_id = await _map_shelf(cred, request)
    if not answered:
        return FolderProposalsResponse(error="llm_request_failed", model=cred.model, trace_id=trace_id)
    producing = [proposals for proposals in answered if proposals]
    candidates = group_by_path(proposal for proposals in producing for proposal in proposals)
    final: list[FolderProposal] = candidates
    if len(producing) > 1:
        reduced, error, reduce_trace = await _reduce(cred, request, candidates)
        trace_id = reduce_trace or trace_id
        if reduced is None:
            logger.warning("Folder proposal reduce failed (%s); proposing the grouped candidates", error)
            reduced = _fallback(request, candidates)
        final = reduced
    await _verify_within_budget(request.documents, final, organization_id)
    return FolderProposalsResponse(proposals=final, model=cred.model, trace_id=trace_id)


def add_folder_proposals_routes(router: APIRouter) -> None:

    @router.post(
        "/v1/folder-proposals",
        response_model=FolderProposalsResponse,
        tags=["documents"],
        summary="Propose new folders for the shelf root's documents that fit no folder",
        description="Reads metadata the BFF sends; proposes only folders built from the input. A person decides.",
    )
    async def folder_proposals(
        request: FolderProposalsRequest,
        x_grid_organization_id: str | None = Header(default=None),
    ) -> FolderProposalsResponse:
        if not request.documents:
            return FolderProposalsResponse()

        cred = await asyncio.to_thread(_llm_settings, x_grid_organization_id)
        if not cred.api_key:
            return FolderProposalsResponse(error="llm_not_configured")
        return await _propose(cred, request, x_grid_organization_id)
