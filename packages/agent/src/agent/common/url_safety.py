"""Whether an address may stand in an answer as a source, decided from its text alone (no lookup, no fetch).

A source's address is shown to a person, copied into documents for an authority and handed to other
agents, so it is https on a public DNS name and carries no credential:

- **https only.** A plain ``http`` page can be rewritten on the way; it is no source.
- **A public DNS name.** The host is a domain under a delegated top-level domain
  (``validators.domain(consider_tld=True)``, the IANA list the library ships): that refuses ``localhost``,
  a single-label name (``frontend``), and every name that only resolves inside a network (``*.svc``,
  ``*.cluster.local``, ``*.internal``, ``*.local``, ``*.test``). An IP literal is refused whatever its
  range; :func:`host_problem` says when it was private, loopback or link-local
  (``public_sources.egress.is_public_address``, the standard library's ``ipaddress``).
- **No user part, the default port.** ``https://user:pw@host`` and ``:8443`` are not how a public page is cited.
- **No signed query.** A pre-signed address (object storage, a CDN token) carries a credential and
  expires; :func:`strip_signed_query` takes the query off, so the page is still named and the key is not.

Buy, don't build: the host-name grammar and the top-level-domain list are ``validators`` (MIT, maintained,
pure Python, offline), the address ranges the standard library. Request-time SSRF guards (``advocate``,
``ssrf-protect``) resolve and connect, which a check of answer text never does; a fetch of a public source
keeps its own guard (``public_sources.egress``).
"""

from __future__ import annotations

import ipaddress
from urllib.parse import parse_qsl
from urllib.parse import urlsplit
from urllib.parse import urlunsplit

import validators

#: Query parameters that carry a signature or a bearer credential, lower case: object-storage pre-signed
#: URLs (S3 ``X-Amz-*``, GCS ``X-Goog-*``, Azure SAS ``sig``), signed CDN links and plain access tokens.
SIGNED_QUERY_PARAMETERS = frozenset(
    {
        *("signature", "sig", "token", "access_token", "id_token", "auth", "authorization"),
        *("key-pair-id", "awsaccesskeyid", "googleaccessid", "apikey", "api_key", "api-key"),
    }
)
#: Prefixes of a provider's whole signing vocabulary.
SIGNED_QUERY_PREFIXES = ("x-amz-", "x-goog-")


def _is_ip_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host.split("%", 1)[0])
    except ValueError:
        return False
    return True


def _ip_problem(host: str) -> str:
    """Why an IP literal is no source: its range when it is not public, else that it is no name."""
    try:
        from public_sources.egress import is_public_address
    except ImportError:  # a distribution without the public-sources package: the stdlib answer
        public = ipaddress.ip_address(host.split("%", 1)[0]).is_global
    else:
        public = is_public_address(host)
    return "an IP address is not a public page's name" if public else "a private, loopback or link-local address"


def host_problem(url: str) -> str | None:
    """Why ``url`` may not be shown as a source, or None when it may. Pure: reads the text, resolves nothing."""
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
    """Whether ``url`` may be shown as a source (:func:`host_problem` finds nothing)."""
    return host_problem(url) is None


def has_signed_query(url: str) -> bool:
    """Whether the query of ``url`` carries a signature or a credential."""
    try:
        names = [name.lower() for name, _value in parse_qsl(urlsplit(url).query, keep_blank_values=True)]
    except ValueError:
        return False
    return any(name in SIGNED_QUERY_PARAMETERS or name.startswith(SIGNED_QUERY_PREFIXES) for name in names)


def strip_signed_query(url: str) -> str:
    """``url`` without its query and fragment when the query is signed; unchanged otherwise.

    The whole query goes, not the one parameter: a signature covers its neighbours (expiry, key id, policy),
    and what is left of a signed query names nothing a reader can open.
    """
    if not has_signed_query(url):
        return url
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
