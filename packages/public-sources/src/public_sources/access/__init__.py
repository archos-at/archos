from __future__ import annotations

from public_sources.access.base import AccessError
from public_sources.access.base import AccessType
from public_sources.access.base import Fetched
from public_sources.access.http_eli import HttpEli
from public_sources.access.ogc import Ogc
from public_sources.access.rest import Rest
from public_sources.access.web_document import WebDocument

ACCESS_TYPES: dict[str, type[AccessType]] = {cls.name: cls for cls in (Rest, HttpEli, WebDocument, Ogc)}


def access_type(name: str) -> type[AccessType]:
    try:
        return ACCESS_TYPES[name]
    except KeyError:
        raise ValueError(f"unknown protocol {name!r}; known: {', '.join(sorted(ACCESS_TYPES))}") from None


def access_for(source) -> AccessType:
    return access_type(source.protocol)(source)


__all__ = ["ACCESS_TYPES", "AccessError", "AccessType", "Fetched", "access_for", "access_type"]
