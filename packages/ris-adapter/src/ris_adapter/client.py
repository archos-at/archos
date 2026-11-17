from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any
from urllib.parse import urlparse

import httpx
from public_sources import access_for
from public_sources import engine_for
from public_sources import get_source
from public_sources.egress import EgressRefused
from public_sources.engines import ris_xml
from public_sources.engines.ris_xml import RisDocument
from public_sources.engines.ris_xml import RisError
from public_sources.engines.ris_xml import RisHit
from public_sources.engines.ris_xml import RisSearchResult
from public_sources.engines.ris_xml import _as_list
from public_sources.engines.ris_xml import _as_text
from public_sources.engines.ris_xml import _find_all
from public_sources.engines.ris_xml import _find_first
from public_sources.routing import source_transport

logger = logging.getLogger(__name__)

__all__ = [
    "ALLOWED_DOCUMENT_HOSTS",
    "CONTROLLER_FOR_APPLICATION",
    "DEFAULT_BASE_URL",
    "DOCUMENT_PATH_SEGMENTS",
    "PAGE_SIZES",
    "RIS_SOURCE_ID",
    "RisClient",
    "RisDocument",
    "RisError",
    "RisHit",
    "RisSearchResult",
    "_as_list",
    "_as_text",
    "_find_all",
    "_find_first",
    "build_document_url",
    "federal_state_param",
    "html_to_text",
    "parse_search_response",
    "public_host",
    "search_terms",
]

RIS_SOURCE_ID = "at-ris"
_SOURCE = get_source(RIS_SOURCE_ID)
_ACCESS = access_for(_SOURCE)
_ENGINE = engine_for(_SOURCE)

DEFAULT_BASE_URL = _ACCESS.config.base_url


def source_record():
    return _SOURCE


ALLOWED_DOCUMENT_HOSTS = frozenset(_SOURCE.hosts)

CONTROLLER_FOR_APPLICATION: dict[str, str] = dict(_ACCESS.table("controller").values)

PAGE_SIZES: dict[int, str] = {int(size): token for size, token in _ACCESS.table("page_size").values.items()}

DOCUMENT_PATH_SEGMENTS: dict[str, str] = dict(_ACCESS.table("document_segment").values)

_DOC_PREFIX_SEGMENTS: tuple[tuple[str, str], ...] = tuple(_ACCESS.table("document_prefix").values.items())


def search_terms(args: dict[str, Any]) -> dict[str, str]:
    return _ACCESS.params("search", args, group="terms")


def federal_state_param(federal_state: str) -> str:
    return _ACCESS.table("federal_state").lookup(federal_state) if federal_state else ""


def public_host(url: str) -> str:
    return _ENGINE.public_host(url)


def _parse_hit(ref: Any) -> RisHit:
    return ris_xml._parse_hit(ref, _ENGINE.config.host_rewrites)


def parse_search_response(payload: dict[str, Any]) -> RisSearchResult:
    return _ENGINE.search(payload)


def html_to_text(markup: str) -> tuple[str, str]:
    return _ENGINE.text(markup)


class RisClient:
    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 30.0,
        max_document_bytes: int = 10 * 1024 * 1024,
        cache_ttl_seconds: float = 3600.0,
        cache_max_entries: int = 64,
        max_retries: int = 3,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_document_bytes = max_document_bytes
        self.cache_ttl_seconds = cache_ttl_seconds
        self.cache_max_entries = cache_max_entries
        self.max_retries = max(1, max_retries)
        self._transport = transport
        self._client: httpx.AsyncClient | None = None
        self._doc_cache: dict[str, tuple[float, RisDocument]] = {}

    def _http_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            try:
                transport = source_transport(RIS_SOURCE_ID, inner=self._transport)
            except EgressRefused as exc:
                raise RisError(f"OGD-RIS is not reachable from here: {exc}") from exc
            self._client = self._new_client(transport)
        return self._client

    def _new_client(self, transport: httpx.AsyncBaseTransport | None) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=self.timeout,
            follow_redirects=True,
            transport=transport,
            trust_env=False,
            event_hooks={"request": [self._reject_non_ris_hop]},
            headers={
                "Accept": "application/json, text/html;q=0.9, */*;q=0.8",
                "User-Agent": "grid-oib-agent-ris-adapter/1.0 (+https://data.bka.gv.at/ris/api/v2.6)",
            },
        )

    async def _reject_non_ris_hop(self, request: httpx.Request) -> None:
        self._validate_document_url(str(request.url))

    async def aclose(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
        self._client = None

    async def _get_with_retries(self, url: str, params: dict[str, str] | None = None) -> httpx.Response:
        last_error: Exception | None = None
        client = self._http_client()  # once per request, not per retry
        for attempt in range(self.max_retries):
            try:
                response = await client.get(url, params=params)
                if response.status_code >= 500:
                    try:
                        parse_search_response(response.json())
                    except RisError:
                        raise
                    except Exception:
                        pass
                    last_error = RisError(f"OGD-RIS request failed with HTTP {response.status_code}")
                else:
                    response.raise_for_status()
                    return response
            except RisError:
                raise
            except EgressRefused as exc:  # deterministic: a retry would be refused the same way
                raise RisError(f"OGD-RIS request refused: {exc}") from exc
            except httpx.HTTPStatusError as exc:
                raise RisError(f"OGD-RIS request failed with HTTP {exc.response.status_code}: {url}") from exc
            except httpx.HTTPError as exc:
                last_error = exc
            if attempt < self.max_retries - 1:
                await asyncio.sleep(2**attempt)
        if isinstance(last_error, RisError):
            raise last_error
        raise RisError(f"OGD-RIS request failed after {self.max_retries} attempts: {last_error}") from last_error

    async def search(
        self,
        application: str,
        params: dict[str, str] | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> RisSearchResult:
        if application not in CONTROLLER_FOR_APPLICATION:
            valid = ", ".join(sorted(CONTROLLER_FOR_APPLICATION))
            raise RisError(f"Unknown RIS application '{application}'. Valid applications: {valid}")

        if page_size not in PAGE_SIZES:
            page_size = 20

        query = _ACCESS.params(
            "search", {"application": application, "page_size": page_size, "page": max(1, page)}, group="paging"
        )
        query.update({k: v for k, v in (params or {}).items() if v})

        url = _ACCESS.url("search", {"application": application}, base_url=self.base_url)
        response = await self._get_with_retries(url, params=query)
        try:
            payload = response.json()
        except ValueError as exc:
            raise RisError("OGD-RIS returned a non-JSON response") from exc

        return parse_search_response(payload)

    async def fetch_document_text(self, url: str) -> RisDocument:
        url = public_host(url)
        self._validate_document_url(url)

        cached = self._doc_cache.get(url)
        if cached and (time.monotonic() - cached[0]) < self.cache_ttl_seconds:
            return cached[1]

        response = await self._get_with_retries(url)

        if len(response.content) > self.max_document_bytes:
            raise RisError(f"RIS document exceeds the {self.max_document_bytes // (1024 * 1024)} MiB size limit: {url}")

        content_type = response.headers.get("content-type", "").lower()
        if any(binary in content_type for binary in ("pdf", "rtf", "octet-stream", "msword")):
            raise RisError(
                f"Document at {url} is only available as a binary format ({content_type}). "
                "Use the document's Html content URL from ris_search instead."
            )

        title, text = await asyncio.to_thread(html_to_text, response.text)
        if not text:
            raise RisError(f"RIS document at {url} contained no extractable text")

        document = RisDocument(url=str(response.url), title=title, text=text)
        self._cache_document(url, document)
        return document

    def _cache_document(self, url: str, document: RisDocument) -> None:
        if self.cache_max_entries <= 0:
            return
        if len(self._doc_cache) >= self.cache_max_entries:
            oldest = min(self._doc_cache, key=lambda key: self._doc_cache[key][0])
            del self._doc_cache[oldest]
        self._doc_cache[url] = (time.monotonic(), document)

    @staticmethod
    def _validate_document_url(url: str) -> None:
        parsed = urlparse(url)
        if parsed.scheme != "https":
            raise RisError(f"Only https RIS URLs can be fetched, got: {url}")
        if parsed.hostname not in ALLOWED_DOCUMENT_HOSTS:
            allowed = ", ".join(sorted(ALLOWED_DOCUMENT_HOSTS))
            raise RisError(f"Refusing to fetch non-RIS URL (host '{parsed.hostname}'). Allowed hosts: {allowed}")


def build_document_url(reference: str, application: str = "") -> str:
    reference = reference.strip()
    if not re.fullmatch(r"[A-Za-z0-9_.\-]+", reference):
        raise RisError(
            f"'{reference}' is neither a RIS URL nor a document number. "
            "Pass a document number from ris_search (e.g. NOR40217157) or a https://www.ris.bka.gv.at/... URL."
        )

    segment = DOCUMENT_PATH_SEGMENTS.get(application) if application else None
    if segment is None:
        upper = reference.upper()
        for prefix, prefix_segment in _DOC_PREFIX_SEGMENTS:
            if upper.startswith(prefix):
                segment = prefix_segment
                break
    if segment is None:
        raise RisError(
            f"Cannot determine the RIS application for document number '{reference}'. "
            "Pass the 'application' argument (e.g. BrKons, LrKons, Vfgh, Vwgh, Justiz, Bvwg, Lvwg) "
            "or pass the document URL from ris_search directly."
        )

    return _ACCESS.url("document", {"segment": segment, "reference": reference})
