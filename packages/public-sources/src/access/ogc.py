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
    service: Literal["features", "wfs"]
    base_url: str
    collections: dict[str, str] = Field(min_length=1)
    output_format: str = "application/json"
    default_limit: int = Field(default=100, ge=1, le=_MAX_LIMIT)

    def urls(self) -> list[str]:
        return [self.base_url]


class Ogc(AccessType):
    served_operations = ("features", "collection")
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
