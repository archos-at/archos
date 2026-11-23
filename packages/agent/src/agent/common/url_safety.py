from __future__ import annotations

import ipaddress
from urllib.parse import parse_qsl
from urllib.parse import urlsplit
from urllib.parse import urlunsplit

import validators

SIGNED_QUERY_PARAMETERS = frozenset(
    {
        *("signature", "sig", "token", "access_token", "id_token", "auth", "authorization"),
        *("key-pair-id", "awsaccesskeyid", "googleaccessid", "apikey", "api_key", "api-key"),
    }
)
SIGNED_QUERY_PREFIXES = ("x-amz-", "x-goog-")


def _is_ip_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host.split("%", 1)[0])
    except ValueError:
        return False
    return True


def _ip_problem(host: str) -> str:
    try:
        from public_sources.egress import is_public_address
    except ImportError:  # a distribution without the public-sources package: the stdlib answer
        public = ipaddress.ip_address(host.split("%", 1)[0]).is_global
    else:
        public = is_public_address(host)
    return "an IP address is not a public page's name" if public else "a private, loopback or link-local address"


def host_problem(url: str) -> str | None:
    try:
        parts = urlsplit(url.strip())
        host = (parts.hostname or "").rstrip(".").lower()
        port = parts.port
    except ValueError:
        return "not a readable address"
    if parts.scheme.lower() != "https":
        return "not an https address"
    if parts.username or parts.password:
        return "an address with a user part"
    if port not in (None, 443):
        return "an address on a non-standard port"
    if not host:
        return "an address without a host"
    if _is_ip_literal(host):
        return _ip_problem(host)
    if not validators.domain(host, consider_tld=True):
        return "a host that is not a public DNS name (local, single-label or internal)"
    return None


def is_citable_url(url: str) -> bool:
    return host_problem(url) is None


def has_signed_query(url: str) -> bool:
    try:
        names = [name.lower() for name, _value in parse_qsl(urlsplit(url).query, keep_blank_values=True)]
    except ValueError:
        return False
    return any(name in SIGNED_QUERY_PARAMETERS or name.startswith(SIGNED_QUERY_PREFIXES) for name in names)


def strip_signed_query(url: str) -> str:
    if not has_signed_query(url):
        return url
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
