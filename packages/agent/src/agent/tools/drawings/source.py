from __future__ import annotations

import asyncio
import threading
from collections import OrderedDict
from dataclasses import dataclass

from agent import project_context
from agent.common import bff_http
from agent.common import seaweed_s3
from agent.drawings.dxf_source import UnreadableDrawingError
from agent.drawings.dxf_source import read_dxf
from agent.drawings.site import Site
from agent.drawings.site import build_site
from agent.knowledge.restricted_use import note_collections_read

from ..canvas.calls import Refused
from ..look.resolve import resolve_document

DOCUMENT_FILE_PATH = "/api/internal/document-file"

MAX_DXF_BYTES = 150 * 1024 * 1024

CACHE_SIZE = 4
CACHE_BYTES = 300 * 1024 * 1024

PARSE_TIMEOUT_S = 90

_CacheKey = tuple[str, str, tuple[str, ...]]
_CACHE: OrderedDict[_CacheKey, tuple[Site, int]] = OrderedDict()
_CACHE_LOCK = threading.Lock()
_PARSING: dict[_CacheKey, threading.Lock] = {}

NO_ENVELOPE = (
    "dxf_measure acts for the person in this conversation, and this run carries no signed request "
    "context to act with, so no project file can be read."
)


@dataclass(frozen=True)
class LoadedSite:
    file_name: str
    site: Site


class SiteUnavailableError(Exception): ...


async def load_site(document: str, building_layers: tuple[str, ...] = ()) -> LoadedSite | str:
    try:
        resolved = await resolve_document(document)
    except Refused as refused:
        return str(refused)
    if isinstance(resolved, str):
        return resolved
    if not resolved.collection:
        return f"'{resolved.file_name}' is a base-corpus document, not a drawing of this project."
    if not resolved.file_name.lower().endswith(".dxf"):
        return (
            f"'{resolved.file_name}' is no DXF. dxf_measure reads .dxf files; for an IFC model use ifc_measure, "
            "for a PDF or an image use look."
        )
    header, signature = project_context.get_request_envelope_from_context()
    if not (header and signature):
        return NO_ENVELOPE
    headers = bff_http.SignedEnvelope(header=header, signature=signature).headers()
    try:
        site = await asyncio.wait_for(
            asyncio.to_thread(_site, resolved.collection, resolved.file_name, headers, building_layers),
            PARSE_TIMEOUT_S,
        )
    except SiteUnavailableError as exc:
        return str(exc)
    except TimeoutError:
        return f"'{resolved.file_name}' takes too long to read; ask for an extract of the area in question."
    note_collections_read([resolved.collection])
    return LoadedSite(resolved.file_name, site)


def _site(collection: str, file_name: str, headers: dict[str, str], building_layers: tuple[str, ...]) -> Site:
    bucket, key = _locate(collection, file_name, headers)
    cache_key = (bucket, key, tuple(layer.upper() for layer in building_layers))
    with _CACHE_LOCK:
        parsing = _PARSING.setdefault(cache_key, threading.Lock())
    with parsing:
        cached = _cached(cache_key)
        if cached is not None:
            return cached
        data = _read(bucket, key)
        try:
            site = build_site(read_dxf(data), building_layers)
        except UnreadableDrawingError as exc:
            raise SiteUnavailableError(
                f"'{file_name}' could not be read as DXF. Ask for it to be exported again."
            ) from exc
        _remember(cache_key, site, len(data))
    with _CACHE_LOCK:
        _PARSING.pop(cache_key, None)
    return site


def _cached(cache_key: _CacheKey) -> Site | None:
    with _CACHE_LOCK:
        if cache_key not in _CACHE:
            return None
        _CACHE.move_to_end(cache_key)
        return _CACHE[cache_key][0]


def _remember(cache_key: _CacheKey, site: Site, size: int) -> None:
    with _CACHE_LOCK:
        _CACHE[cache_key] = (site, size)
        while len(_CACHE) > CACHE_SIZE or (len(_CACHE) > 1 and sum(n for _s, n in _CACHE.values()) > CACHE_BYTES):
            _CACHE.popitem(last=False)


def _locate(collection: str, file_name: str, headers: dict[str, str]) -> tuple[str, str]:
    try:
        body = bff_http.get_json(
            DOCUMENT_FILE_PATH, timeout=10.0, query={"collection": collection, "filename": file_name}, headers=headers
        )
    except bff_http.BffRefusedError as exc:
        raise SiteUnavailableError(f"'{file_name}' is not a file this conversation may read.") from exc
    except bff_http.BffError as exc:
        raise SiteUnavailableError("The document service could not be reached; try again shortly.") from exc
    key = body.get("storageKey") if isinstance(body, dict) else None
    if not isinstance(key, str) or not key:
        raise SiteUnavailableError(f"'{file_name}' has no stored file yet.")
    bucket = body.get("storageBucket")
    return (bucket if isinstance(bucket, str) and bucket else seaweed_s3.default_bucket()), key


def _read(bucket: str, key: str) -> bytes:
    client = seaweed_s3.s3_client()
    if client is None:
        raise SiteUnavailableError("This deployment cannot read stored files (no object-store credential).")
    try:
        head = client.head_object(Bucket=bucket, Key=key)
        if int(head.get("ContentLength") or 0) > MAX_DXF_BYTES:
            raise SiteUnavailableError(_TOO_LARGE)
        data = client.get_object(Bucket=bucket, Key=key)["Body"].read(MAX_DXF_BYTES + 1)
        if len(data) > MAX_DXF_BYTES:
            raise SiteUnavailableError(_TOO_LARGE)
        return data
    except SiteUnavailableError:
        raise
    except Exception as exc:  # noqa: BLE001 - any store fault is one sentence to the model, logged by the caller
        raise SiteUnavailableError("The stored DXF could not be read; try again shortly.") from exc


_TOO_LARGE = "The DXF is larger than 150 MB; ask for an extract of the area in question."


def clear_cache() -> None:
    with _CACHE_LOCK:
        _CACHE.clear()
        _PARSING.clear()
