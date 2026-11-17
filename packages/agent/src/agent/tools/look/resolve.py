from __future__ import annotations

import asyncio
import unicodedata
from dataclasses import dataclass

from agent import project_context
from agent.common.bff_http import SignedEnvelope
from agent.common.focus_file import get_focused_document_id
from agent.common.focus_file import get_focused_file_name

from ..canvas import target as canvas_target
from ..canvas.calls import call
from ..canvas.calls import envelope
from ..canvas.target import Target
from ..canvas.target import Unresolved
from ..canvas.target import collection_of
from ..canvas.target import is_uuid
from ..canvas.target import match_document
from ..canvas.target import probe_collections
from ..canvas.target import resolve_target

NO_FILE = "I do not know which file this document is. Name it in `document` (the file name from the inventory)."
NOT_FOUND = (
    "Not found: '{name}' is neither a base-corpus document nor a file of this conversation. Name it exactly as the "
    "inventory or a hit's `Citation:` line lists it, or ask which document is meant; do not guess."
)


@dataclass(frozen=True)
class Resolved:

    file_name: str
    collection: str = ""
    target: Target | None = None
    signed: SignedEnvelope | None = None
    read_by_bff: bool = False


def _key(value: str | None) -> str:
    return unicodedata.normalize("NFC", value or "").strip().casefold()


def _signed_or_none() -> SignedEnvelope | None:
    header, signature = project_context.get_request_envelope_from_context()
    return SignedEnvelope(header=header, signature=signature) if header and signature else None


async def _is_base_corpus(name: str) -> bool:
    from knowledge_layer.view_image import _find_pdf

    return await asyncio.to_thread(_find_pdf, name) is not None


async def _probe(file_name: str) -> str:
    from knowledge_layer.view_image import _resolve_storage_location

    for collection in probe_collections():
        if await _resolve_storage_location(collection, file_name) is not None:
            return collection
    return ""


async def _collection(file_name: str, known: str | None) -> str:
    if known:
        return known
    if (listed := collection_of(file_name)) is not None:
        return listed
    return await _probe(file_name)


async def _file_name(target: Target, signed: SignedEnvelope) -> str | None:
    if target.file_name:
        return target.file_name
    body = await call({"op": "list"}, target, signed)
    name = body.get("documentName")
    return name if isinstance(name, str) and name else None


async def _named(name: str, signed: SignedEnvelope | None) -> Resolved | str:
    row = match_document(name)
    if isinstance(row, Unresolved):
        if row.ambiguous:
            return row.message
        file_name, collection = name, await _probe(name)
        if not collection:
            return NOT_FOUND.format(name=name)
    else:
        file_name, collection = row.file_name, row.collection
    if signed is None:
        return Resolved(file_name, collection)
    document_id = await asyncio.to_thread(canvas_target.lookup_document_id, collection, file_name, signed)
    target = Target(document_id, file_name, collection) if document_id else None
    return Resolved(file_name, collection, target, signed if target else None)


async def _open(document: str) -> Resolved | str:
    signed = envelope()
    target = await resolve_target(document, signed)
    if isinstance(target, Unresolved):
        return target.message
    read_by_bff = not target.file_name
    file_name = await _file_name(target, signed)
    if not file_name:
        return NO_FILE
    return Resolved(file_name, await _collection(file_name, target.collection), target, signed, read_by_bff)


async def resolve_document(document: str) -> Resolved | str:
    named = (document or "").strip()
    focus_id = get_focused_document_id()
    if named and focus_id and _key(named) == _key(get_focused_file_name()):
        return await _open(focus_id)
    if not named or is_uuid(named):
        return await _open(named)
    if await _is_base_corpus(named):
        return Resolved(named)
    return await _named(named, _signed_or_none())
