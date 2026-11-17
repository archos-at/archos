from __future__ import annotations

import os
from typing import Annotated
from urllib.parse import urlsplit
from urllib.parse import urlunsplit

from pydantic import AfterValidator
from pydantic import StringConstraints

MAX_URL_LENGTH = 8192

ENDPOINT_VARIABLES = ("SEAWEED_ENDPOINT", "SEAWEED_PUBLIC_ENDPOINT")

_DEFAULT_PORTS = {"http": 80, "https": 443}

_URL_CHARACTERS = frozenset(chr(code) for code in range(0x21, 0x7F)) - {"\\"}

Origin = tuple[str, str, int]


class ObjectStoreUrlError(ValueError): ...


def object_store_origins() -> frozenset[Origin]:
    origins: set[Origin] = set()
    for variable in ENDPOINT_VARIABLES:
        endpoint = os.environ.get(variable, "").strip()
        if not endpoint:
            continue
        try:
            origins.add(_origin(endpoint))
        except ObjectStoreUrlError:
            continue
    return frozenset(origins)


def assert_fetchable_object_store_url(url: str, field: str = "url") -> None:
    if len(url) > MAX_URL_LENGTH:
        raise ObjectStoreUrlError(f"{field} is longer than {MAX_URL_LENGTH} characters")
    if not set(url) <= _URL_CHARACTERS:
        raise ObjectStoreUrlError(f"{field} must be printable ASCII without spaces or backslashes")
    if _origin(url, field) not in object_store_origins():
        raise ObjectStoreUrlError(f"{field} must point at the configured object store")


def object_store_request_url(url: str, field: str = "url") -> str:
    assert_fetchable_object_store_url(url, field)
    wanted = _origin(url, field)
    for variable in ENDPOINT_VARIABLES:
        endpoint = os.environ.get(variable, "").strip()
        if not endpoint:
            continue
        try:
            origin = _origin(endpoint)
        except ObjectStoreUrlError:
            continue
        if origin != wanted:
            continue
        configured = urlsplit(endpoint)
        requested = urlsplit(url)
        return urlunsplit((configured.scheme, configured.netloc, requested.path, requested.query, ""))
    raise ObjectStoreUrlError(f"{field} must point at the configured object store")


def _origin(url: str, field: str = "url") -> Origin:
    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    if scheme not in _DEFAULT_PORTS:
        raise ObjectStoreUrlError(f"{field} must be an http(s) URL")
    if "@" in parts.netloc:
        raise ObjectStoreUrlError(f"{field} must not carry credentials")
    if not parts.hostname:
        raise ObjectStoreUrlError(f"{field} must name a host")
    try:
        port = parts.port or _DEFAULT_PORTS[scheme]
    except ValueError as error:
        raise ObjectStoreUrlError(f"{field} has an invalid port") from error
    return scheme, parts.hostname.casefold(), port


def _validated(url: str) -> str:
    assert_fetchable_object_store_url(url, field="the URL")
    return url


ObjectStoreUrl = Annotated[
    str,
    StringConstraints(min_length=1, max_length=MAX_URL_LENGTH),
    AfterValidator(_validated),
]
