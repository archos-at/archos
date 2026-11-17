"""``web_document``: a list of published documents, each at a stable URL.

For the many portals that publish a statute as an HTML or XML page and offer
no API (most German Land portals, many cantonal collections, authority
guidance). The record lists the documents by id; the access type fetches one,
sending the validators of the last fetch (``If-None-Match``) when the caller
has them, so a monitor that finds nothing new costs the publisher a 304.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from public_sources.access.base import AccessConfig
from public_sources.access.base import AccessError
from public_sources.access.base import AccessType
from public_sources.access.base import Fetched
from public_sources.access.base import Strict
from pydantic import Field


class Document(Strict):
    id: str
    url: str
    title: str = ""


class WebDocumentConfig(AccessConfig):
    documents: tuple[Document, ...] = Field(min_length=1)

    def urls(self) -> list[str]:
        return [document.url for document in self.documents]


class WebDocument(AccessType):
    name = "web_document"
    config_model = WebDocumentConfig
    served_operations = ("document",)

    def document(self, document_id: str) -> Document:
        for document in self.config.documents:
            if document.id == document_id:
                return document
        raise AccessError(f"{self.source.id}: no document {document_id!r}")

    async def fetch(self, client, operation: str, args: Mapping[str, Any]) -> Fetched:
        if operation != "document":
            raise AccessError(f"{self.source.id}: web_document serves the 'document' operation, not {operation!r}")
        document = self.document(str(args.get("id", "")))
        etag = str(args.get("etag", ""))
        headers = {"If-None-Match": etag} if etag else None
        self.source.require_allowed(document.url)
        response = await client.get(document.url, headers=headers)
        if response.status_code == 304:
            return Fetched(url=document.url, status=304, content_type="", body=b"", etag=etag)
        if response.status_code >= 400:
            raise AccessError(f"{self.source.id}: HTTP {response.status_code} for {document.url}")
        return Fetched(
            url=str(response.url),
            status=response.status_code,
            content_type=response.headers.get("content-type", ""),
            body=response.content,
            etag=response.headers.get("etag", ""),
        )
