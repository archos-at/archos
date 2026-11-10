"""``ogc``: geodata services that speak an OGC standard (design 4.2, ADR-0174).

Two of them, both reads, both answering features a format engine turns into
anchored records (``geojson``):

* **OGC API - Features** (OGC 17-069r4), ``service: features``:
  ``{base_url}/collections/{collection}/items`` with ``bbox``, ``datetime``,
  ``limit`` and ``f=json`` (operation ``features``), and the collection's own
  description (operation ``collection``), which is what a monitor watches.
* **WFS 2.0** (OGC 09-025r2), ``service: wfs``: a key-value ``GetFeature`` with
  ``typeNames``, ``bbox``, ``count`` and the record's ``output_format``
  (operation ``features``), and ``GetCapabilities`` (operation ``collection``).

A collection is named in the record (``collections``: our name to the
service's id), so an argument never becomes a path segment unchecked.

**A site point leaves only towards a site-keyed source.** ``bbox`` is the one
argument that says where a project is. A ``public_only`` source refuses a
request that carries one, before it is built: the data-flow register
(ADR-0161) lists only site-keyed sources as receiving a site point, and a
site-keyed source is published only after a privacy reviewer's yes.

OWSLib is not used: it makes its own requests through ``requests``, around the
guarded client every fetch must use, and the two requests above are all a
source here needs.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any
from typing import Literal
from urllib.parse import quote

from public_sources.access.base import AccessConfig
from public_sources.access.base import AccessError
from public_sources.access.base import AccessType
from public_sources.access.base import Fetched
from pydantic import Field

_BBOX_RE = re.compile(r"^-?\d{1,3}(\.\d{1,9})?(,-?\d{1,3}(\.\d{1,9})?){3}$")
_DATETIME_RE = re.compile(r"^[0-9TZ:./+-]{4,60}$")
_MAX_LIMIT = 1000


class OgcConfig(AccessConfig):
    #: ``features``: OGC API - Features; ``wfs``: a WFS 2.0 endpoint.
    service: Literal["features", "wfs"]
    #: The landing page (OGC API) or the WFS endpoint, https on one of the source's hosts.
    base_url: str
    #: Our collection name -> the service's collection id (OGC API) or feature type name (WFS).
    collections: dict[str, str] = Field(min_length=1)
    #: WFS only: the GetFeature output format, e.g. ``application/json``.
    output_format: str = "application/json"
    default_limit: int = Field(default=100, ge=1, le=_MAX_LIMIT)

    def urls(self) -> list[str]:
        return [self.base_url]


class Ogc(AccessType):
    name = "ogc"
    config_model = OgcConfig

    def _collection(self, args: Mapping[str, Any]) -> str:
        name = str(args.get("collection", ""))
        try:
            return self.config.collections[name]
        except KeyError:
            known = ", ".join(sorted(self.config.collections))
            raise AccessError(f"{self.source.id}: no collection {name!r} (known: {known})") from None

    def _site_args(self, args: Mapping[str, Any]) -> dict[str, str]:
        """The location arguments, refused unless the source may receive a site point."""
        bbox = str(args.get("bbox", "") or "")
        if not bbox:
            return {}
        if self.source.data_flow != "site_keyed":
            raise AccessError(f"{self.source.id}: a bbox is a site point, and this source is public_only")
        if not _BBOX_RE.fullmatch(bbox):
            raise AccessError(f"{self.source.id}: bbox is four comma-separated numbers")
        return {"bbox": bbox}

    def _limit(self, args: Mapping[str, Any]) -> str:
        raw = str(args.get("limit", "") or self.config.default_limit)
        if not raw.isdigit() or not 1 <= int(raw) <= _MAX_LIMIT:
            raise AccessError(f"{self.source.id}: limit is 1 to {_MAX_LIMIT}")
        return raw

    async def fetch(self, client, operation: str, args: Mapping[str, Any]) -> Fetched:
        if operation not in {"features", "collection"}:
            raise AccessError(f"{self.source.id}: ogc serves 'features' and 'collection', not {operation!r}")
        collection = self._collection(args)
        if self.config.service == "features":
            return await self._features_api(client, operation, collection, args)
        return await self._wfs(client, operation, collection, args)

    async def _features_api(self, client, operation: str, collection: str, args: Mapping[str, Any]) -> Fetched:
        base = self.config.base_url.rstrip("/")
        url = f"{base}/collections/{quote(collection, safe='')}"
        if operation == "collection":
            return await self._get(client, url, params={"f": "json"})
        params = {**self._site_args(args), "limit": self._limit(args), "f": "json"}
        datetime = str(args.get("datetime", "") or "")
        if datetime:
            if not _DATETIME_RE.fullmatch(datetime):
                raise AccessError(f"{self.source.id}: datetime is an RFC 3339 instant or interval")
            params["datetime"] = datetime
        return await self._get(client, f"{url}/items", params=params)

    async def _wfs(self, client, operation: str, collection: str, args: Mapping[str, Any]) -> Fetched:
        if operation == "collection":
            return await self._get(
                client, self.config.base_url, params={"service": "WFS", "request": "GetCapabilities"}
            )
        params = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": collection,
            "count": self._limit(args),
            "outputFormat": self.config.output_format,
            **self._site_args(args),
        }
        return await self._get(client, self.config.base_url, params=params)
