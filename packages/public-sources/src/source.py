"""A public source is a record, not code.

One YAML file per source, ``configs/sources/<territory>/<name>/source.yml``,
with its recorded fixtures beside it in ``fixtures/``. The record names a
**protocol** (an access type in :mod:`public_sources.access`, which fetches
bytes) and a **format** (an engine in :mod:`public_sources.engines`, which turns
the bytes into anchored text), and carries everything that is the source's own:
base URLs, query vocabularies, the hosts it may reach, its terms and licence,
what data may flow to it, and how a change is noticed.

Adding a country's statute database or geodata service is therefore a new file
here, reviewed like any other data. Code is written only when no access type
speaks the source's protocol or no engine reads its format, and then once, for
every later source of that kind.

A source is not used until its fixtures pass (:mod:`public_sources.fixtures`):
``load_sources`` refuses a record without fixtures, and
``packages/public-sources/tests/test_source_fixtures.py`` runs every record's
fixtures through its own access type and engine on every commit.
"""

from __future__ import annotations

import base64
import binascii
import functools
import os
import re
from datetime import date
from pathlib import Path
from typing import Any
from typing import Literal
from urllib.parse import urlparse

import yaml
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import PrivateAttr
from pydantic import field_validator
from pydantic import model_validator

#: The license classes the licensed seam keys on (design 3.4, shared with S1/S2).
Licence = Literal["public_open", "public_restricted", "licensed"]
#: What may leave the cluster towards the source. ``public_only``: nothing about a
#: tenant beyond the search terms the operation declares. ``site_keyed``: a site
#: point too, which needs a privacy review and a register row (design 6.4).
DataFlow = Literal["public_only", "site_keyed"]

DEFAULT_SOURCES_DIR = "configs/sources"
ENV_SOURCES_DIR = "PUBLIC_SOURCES_DIR"

_ID_RE = re.compile(r"^[a-z]{2}(-[a-z0-9]+)+$")
_TERRITORY_RE = re.compile(r"^[A-Z]{2}(-[A-Z0-9]{1,3})?$")
_HOST_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")


def url_on_hosts(url: str, hosts: tuple[str, ...] | list[str]) -> bool:
    """Whether ``url`` is https on one of ``hosts``, on the default port, with no user part."""
    parsed = urlparse(url)
    try:
        port = parsed.port
    except ValueError:  # a port that is not a number
        return False
    return parsed.scheme == "https" and (parsed.hostname or "") in hosts and not parsed.username and port in (None, 443)


class SourceError(ValueError):
    """A source record that cannot be used: unknown, invalid, or without fixtures."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Terms(_Strict):
    """Under what terms the source may be read, and when someone last checked them."""

    url: str
    licence: Licence
    #: The attribution the terms require, verbatim; empty when none is required.
    attribution: str = ""
    #: The day a person last read the terms page. A monitor hashes that page too.
    checked: date


class Probe(_Strict):
    """What a monitor fetches to notice a change: one operation of the source's access type."""

    operation: str
    args: dict[str, str] = Field(default_factory=dict)


class Monitor(_Strict):
    """How a change at the source is noticed. Deterministic: no model call (design 4.2)."""

    #: ``sha256`` compares the bytes, ``etag`` the validator the server states,
    #: ``version`` the version label the engine reads (an ELI point in time, a
    #: consolidation date). ``none`` for a source nobody watches yet.
    kind: Literal["none", "sha256", "etag", "version"] = "sha256"
    interval_hours: int = Field(default=24, ge=1, le=24 * 31)
    #: What :mod:`public_sources.monitor` fetches; a source without one is not watched (ADR-0174).
    probe: Probe | None = None


class InlineResponse(_Strict):
    """A recorded response carried in the record itself, as a source configured in the database keeps it.

    A text body is carried as it came (``encoding: utf-8``); a binary one, a
    PDF above all, as base64 (``encoding: base64``), within the same length.
    """

    content_type: str
    text: str = Field(max_length=500_000)
    encoding: Literal["utf-8", "base64"] = "utf-8"

    @model_validator(mode="after")
    def _decodes(self) -> InlineResponse:
        if self.encoding == "base64":
            try:
                base64.b64decode(self.text, validate=True)
            except (binascii.Error, ValueError) as exc:
                raise ValueError(f"a base64 response body does not decode: {exc}") from exc
        return self

    def content(self) -> bytes:
        """The body's bytes, as the source served them."""
        return base64.b64decode(self.text) if self.encoding == "base64" else self.text.encode("utf-8")


#: Headers a key may never be sent under (held again by the BFF's ``REFUSED_CREDENTIAL_HEADERS``).
REFUSED_CREDENTIAL_HEADERS = frozenset(
    {
        "host",
        "cookie",
        "set-cookie",
        "connection",
        "keep-alive",
        "content-length",
        "content-type",
        "transfer-encoding",
        "te",
        "trailer",
        "upgrade",
        "via",
        "forwarded",
        "proxy-authorization",
        "proxy-authenticate",
        "proxy-connection",
        "accept",
        "accept-language",
        "if-none-match",
        "if-modified-since",
        "user-agent",
    }
)


class Credential(_Strict):
    """Where a keyed source wants its key (ADR-0174). The key itself is never in the record.

    The BFF keeps it write-only and hands it over per request; only the fetch
    attaches it, after every other header is stripped, and only on the source's hosts.
    """

    header: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9-]{1,40}$")
    #: Written before the key, e.g. ``Bearer `` (with its space); empty for a bare key.
    prefix: str = Field(default="", max_length=20)

    @field_validator("header")
    @classmethod
    def _carries_a_key(cls, value: str) -> str:
        name = value.lower()
        if name in REFUSED_CREDENTIAL_HEADERS or name.startswith(("x-forwarded-", "proxy-")):
            raise ValueError(
                f"{value} routes, frames or proxies the request, or the guard sets it itself: it carries no key"
            )
        return value


class Fixture(_Strict):
    """One recorded exchange with the source, and what the engine must make of it.

    ``responses`` maps each URL the operation requests to a file under the
    source's ``fixtures/`` directory, so a fixture run makes no live call and
    proves the request the access type builds as much as the parse.
    """

    name: str
    operation: str
    args: dict[str, str] = Field(default_factory=dict)
    #: A file under ``fixtures/`` (a repository record), or the response itself (a database record).
    responses: dict[str, str | InlineResponse]
    #: What the engine's result must show: ``kind`` (``search`` or ``document``),
    #: ``title``, ``min_hits``/``min_passages``, ``anchors`` (present, in order),
    #: ``contains`` (substrings of the text), ``version``.
    expect: dict[str, Any]


class Source(_Strict):
    """A configured public source. See the module docstring."""

    id: str
    title: str
    #: ISO 3166-1 alpha-2, or an ISO 3166-2 subdivision (``DE-BY``).
    territory: str
    protocol: str
    format: str
    #: Every host the source may reach, exact DNS names. A redirect off this
    #: list is refused at every hop, and the fetcher refuses it again.
    hosts: tuple[str, ...]
    data_flow: DataFlow = "public_only"
    terms: Terms
    monitor: Monitor = Monitor()
    #: The protocol's configuration, validated by that access type's model.
    access: dict[str, Any]
    #: The format engine's configuration, validated by that engine's model.
    engine: dict[str, Any] = Field(default_factory=dict)
    fixtures: tuple[Fixture, ...]
    #: Where a keyed source takes its key; ``None`` for an open one.
    credential: Credential | None = None

    _directory: Path | None = PrivateAttr(default=None)

    @field_validator("id")
    @classmethod
    def _id_shape(cls, value: str) -> str:
        if not _ID_RE.fullmatch(value):
            raise ValueError(f"source id {value!r} must be '<iso2>-<name>' in lower case, e.g. 'at-ris'")
        return value

    @field_validator("territory")
    @classmethod
    def _territory_shape(cls, value: str) -> str:
        if not _TERRITORY_RE.fullmatch(value):
            raise ValueError(f"territory {value!r} is not an ISO 3166 code such as 'AT' or 'DE-BY'")
        return value

    @field_validator("hosts")
    @classmethod
    def _hosts_shape(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if not value:
            raise ValueError("a source names at least one host")
        bad = [host for host in value if not _HOST_RE.fullmatch(host)]
        if bad:
            raise ValueError(f"hosts must be exact lower-case DNS names (no scheme, port or wildcard): {bad}")
        return value

    @field_validator("fixtures")
    @classmethod
    def _has_fixtures(cls, value: tuple[Fixture, ...]) -> tuple[Fixture, ...]:
        if not value:
            raise ValueError("a source is used only once a recorded fixture proves it: add at least one")
        return value

    @model_validator(mode="after")
    def _known_types_and_hosts(self) -> Source:
        from public_sources.access import access_type
        from public_sources.engines import engine_type

        access_cls = access_type(self.protocol)
        engine_cls = engine_type(self.format)
        config = access_cls.config_model.model_validate(self.access)
        engine_cls.config_model.model_validate(self.engine)
        for url in config.urls():
            self.require_allowed(url)
        return self

    # -- reading ----------------------------------------------------------

    @property
    def directory(self) -> Path:
        if self._directory is None:
            raise SourceError(f"source {self.id!r} was not loaded from a file")
        return self._directory

    def allows(self, url: str) -> bool:
        """Whether ``url`` is https on one of this source's hosts, on the default port."""
        return url_on_hosts(url, self.hosts)

    def require_allowed(self, url: str) -> None:
        if not self.allows(url):
            raise SourceError(
                f"{url!r} is not an https URL on a host of source {self.id!r} (hosts: {', '.join(self.hosts)})"
            )

    def access_config(self):
        """The validated access configuration (the protocol's own model)."""
        from public_sources.access import access_type

        return access_type(self.protocol).config_model.model_validate(self.access)

    def engine_config(self):
        """The validated engine configuration (the format's own model)."""
        from public_sources.engines import engine_type

        return engine_type(self.format).config_model.model_validate(self.engine)


def parse_source(raw: dict[str, Any], directory: Path | None = None) -> Source:
    """A source from its YAML mapping. Raises :class:`SourceError` with the reason."""
    try:
        source = Source.model_validate(raw)
    except Exception as exc:  # pydantic's ValidationError, or an unknown type
        name = raw.get("id", "?") if isinstance(raw, dict) else "?"
        raise SourceError(f"source {name!r} is invalid: {exc}") from exc
    source._directory = directory
    return source


def parse_inline_source(raw: dict[str, Any]) -> Source:
    """A source configured in the database (ADR-0174), as the BFF hands it over.

    Its recorded responses are inline (it has no directory), and its id may not
    be a repository record's: a database row must never stand in for a reviewed
    file of the same name.
    """
    source = parse_source(raw)
    if source.terms.licence == "licensed":
        raise SourceError(
            f"source {source.id!r} is licensed: its text may not be kept in a configured record (ADR-0164)"
        )
    files = [name for fixture in source.fixtures for name in fixture.responses.values() if isinstance(name, str)]
    if files:
        raise SourceError(
            f"source {source.id!r} is configured in the database, so its fixtures carry responses inline: {files}"
        )
    try:
        repository = _cached_sources(str(sources_dir().resolve()))
    except SourceError:
        repository = {}
    if source.id in repository:
        raise SourceError(f"source id {source.id!r} is a repository record; a configured source takes another id")
    return source


def sources_dir(path: str | os.PathLike[str] | None = None) -> Path:
    """Where the source records live: ``path``, else ``$PUBLIC_SOURCES_DIR``, else ``configs/sources``.

    The default is relative to the working directory, which is the repository
    root in the image (``/app``) and in every task. A run from elsewhere (a
    package's own test directory) resolves it against the repository root, the
    same rule ``norm_registry.norms_dir`` follows.
    """
    if path:
        return Path(path)
    env_value = os.environ.get(ENV_SOURCES_DIR)
    if env_value:
        return Path(env_value)
    default = Path(DEFAULT_SOURCES_DIR)
    if default.is_dir():
        return default
    return Path(__file__).resolve().parents[3] / DEFAULT_SOURCES_DIR


def load_sources(path: str | os.PathLike[str] | None = None) -> dict[str, Source]:
    """Every source record under the sources directory, keyed by id.

    Fails closed: one invalid record raises, naming the file, because a source
    that silently drops out is a country whose law silently stops answering.
    """
    root = sources_dir(path)
    sources: dict[str, Source] = {}
    for file in sorted(root.glob("*/*/source.yml")):
        raw = yaml.safe_load(file.read_text(encoding="utf-8"))
        try:
            source = parse_source(raw, directory=file.parent)
        except SourceError as exc:
            raise SourceError(f"{file}: {exc}") from exc
        if source.id in sources:
            raise SourceError(f"{file}: source id {source.id!r} is used twice")
        sources[source.id] = source
    return sources


@functools.cache
def _cached_sources(root: str) -> dict[str, Source]:
    return load_sources(root)


def get_source(source_id: str, path: str | os.PathLike[str] | None = None) -> Source:
    """One source by id, read once per process and directory."""
    sources = _cached_sources(str(sources_dir(path).resolve()))
    try:
        return sources[source_id]
    except KeyError:
        known = ", ".join(sorted(sources)) or "none"
        raise SourceError(f"no source {source_id!r} under {sources_dir(path)} (known: {known})") from None
