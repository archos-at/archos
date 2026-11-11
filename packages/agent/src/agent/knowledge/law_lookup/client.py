"""The requests a law lookup makes to its source: a search, and a document by its URL.

Both are the record's: the search is the ``rest`` access type's ``search``
operation rendered from the record's templates and tables, and the answer is
read by the record's format engine. What this module adds is the transport
discipline every source read shares: the public-source fetcher's transport
(``public_sources.routing.source_transport``), every hop of a redirect checked
against the record's hosts, bounded retries on transport errors and 5xx, a
size bound and no binary payloads.
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import Any

import httpx
from public_sources.egress import EgressRefused
from public_sources.engines import EngineError
from public_sources.routing import source_transport

from agent.knowledge.law_lookup.source import LawSource

logger = logging.getLogger(__name__)

_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
#: The search arguments that carry a day; checked before a request is built.
_DATE_ARGS = ("date_from", "date_to")


class SourceRequestError(Exception):
    """A request the source refused or could not answer: deterministic or exhausted, never raised past a stage."""


@dataclass(frozen=True)
class Document:
    """A document's text as the format engine read it."""

    url: str
    title: str
    text: str


class SourceClient:
    """Async reads of one law source, with a pooled connection and bounded retries."""

    def __init__(
        self,
        law: LawSource,
        *,
        base_url: str = "",
        timeout: float = 60.0,
        max_document_bytes: int = 10 * 1024 * 1024,
        max_retries: int = 3,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.law = law
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_document_bytes = max_document_bytes
        self.max_retries = max(1, max_retries)
        self._transport = transport
        self._client: httpx.AsyncClient | None = None

    def _http_client(self) -> httpx.AsyncClient:
        """The client whose requests the public-source fetcher makes; without a fetcher, a refusal."""
        if self._client is None or self._client.is_closed:
            try:
                transport = source_transport(self.law.transport_key, inner=self._transport)
            except EgressRefused as exc:
                raise SourceRequestError(f"{self.law.source.id} is not reachable from here: {exc}") from exc
            self._client = httpx.AsyncClient(
                timeout=self.timeout,
                follow_redirects=True,
                transport=transport,
                # An environment proxy would take a request past the guard.
                trust_env=False,
                # EVERY HOP IS CHECKED, NOT THE FIRST ONE: a source endpoint that reflects a
                # parameter into `Location` would otherwise turn the host check into a formality.
                event_hooks={"request": [self._reject_foreign_hop]},
                headers={"Accept": "application/json, text/html;q=0.9, */*;q=0.8", "User-Agent": "law-lookup/1.0"},
            )
        return self._client

    async def _reject_foreign_hop(self, request: httpx.Request) -> None:
        self._validate_url(str(request.url))

    def _validate_url(self, url: str) -> None:
        if not self.law.source.allows(url):
            hosts = ", ".join(sorted(self.law.source.hosts))
            raise SourceRequestError(f"Refusing to fetch {url}: not https on a host of the source ({hosts})")

    async def aclose(self) -> None:
        """Close the pooled connection (idempotent)."""
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
        self._client = None

    async def search(self, args: dict[str, Any]) -> Any:
        """Run the record's search operation for ``args``; the engine's parsed result.

        ``args`` are the operation's template arguments (paging included). The
        query is the record's parameters in the record's order, empty ones left out.
        """
        for name in _DATE_ARGS:
            value = str(args.get(name) or "")
            if value and not _DATE_RE.fullmatch(value):
                raise SourceRequestError(f"{name} must use the YYYY-MM-DD format, got '{value}'")
        operation = self.law.lookup.search
        if not operation:
            raise SourceRequestError(f"{self.law.source.id} offers no search")
        try:
            url = self.law.access.url(operation, args, base_url=self.base_url or None)
            query = self.law.access.params(operation, args)
        except Exception as exc:  # an argument the record has no entry for
            raise SourceRequestError(str(exc)) from exc
        response = await self._get_with_retries(url, params=query)
        try:
            payload = response.json()
        except ValueError as exc:
            raise SourceRequestError(f"{self.law.source.id} returned a non-JSON search answer") from exc
        try:
            return self.law.engine.search(payload)
        except EngineError as exc:
            raise SourceRequestError(str(exc)) from exc

    async def fetch_document(self, url: str) -> Document:
        """Fetch a whole document and read it to plain text; binary payloads are refused."""
        url = self.law.public_host(url)
        self._validate_url(url)
        response = await self._get_with_retries(url)
        if len(response.content) > self.max_document_bytes:
            limit = self.max_document_bytes // (1024 * 1024)
            raise SourceRequestError(f"Document exceeds the {limit} MiB size limit: {url}")
        content_type = response.headers.get("content-type", "").lower()
        if any(binary in content_type for binary in ("pdf", "rtf", "octet-stream", "msword")):
            raise SourceRequestError(f"Document at {url} is only available as a binary format ({content_type}).")
        # The parse is CPU-bound: off the event loop, so other turns keep moving on a large law.
        title, text = await asyncio.to_thread(self.law.engine.text, response.text)
        if not text:
            raise SourceRequestError(f"Document at {url} contained no extractable text")
        return Document(url=str(response.url), title=title, text=text)

    async def _get_with_retries(self, url: str, params: dict[str, str] | None = None) -> httpx.Response:
        """GET with exponential backoff on transport errors and 5xx; a 5xx the engine reads as a refusal is final."""
        last_error: Exception | None = None
        client = self._http_client()
        for attempt in range(self.max_retries):
            response, last_error = await self._attempt(client, url, params)
            if response is not None:
                return response
            if attempt < self.max_retries - 1:
                await asyncio.sleep(2**attempt)
        if isinstance(last_error, SourceRequestError):
            raise last_error
        raise SourceRequestError(f"Request failed after {self.max_retries} attempts: {last_error}") from last_error

    async def _attempt(self, client, url: str, params) -> tuple[httpx.Response | None, Exception | None]:
        """One GET: the accepted response, or the error to retry on; a refusal is raised, never retried."""
        try:
            response = await client.get(url, params=params)
        except EgressRefused as exc:  # deterministic: a retry would be refused the same way
            raise SourceRequestError(f"Request refused: {exc}") from exc
        except httpx.HTTPError as exc:
            return None, exc
        if response.status_code < 500:
            return self._accepted(response, url), None
        self._raise_refusal(response)
        return None, SourceRequestError(f"Request failed with HTTP {response.status_code}")

    @staticmethod
    def _accepted(response: httpx.Response, url: str) -> httpx.Response:
        if response.is_error:
            raise SourceRequestError(f"Request failed with HTTP {response.status_code}: {url}")
        return response

    def _raise_refusal(self, response: httpx.Response) -> None:
        """A 5xx carrying the source's own error (a validation refusal) is not retried."""
        search = getattr(self.law.engine, "search", None)
        if search is None:
            return
        try:
            search(response.json())
        except EngineError as exc:
            raise SourceRequestError(str(exc)) from exc
        except Exception:  # noqa: BLE001, S110 — any other body is a plain server error, retried
            pass
