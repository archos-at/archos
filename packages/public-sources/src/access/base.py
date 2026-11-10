"""What every access type shares: the fetched bytes, the template language, the type registry.

An access type turns an operation of a source (``search``, ``expression``,
``document``) and its arguments into requests, and the responses into
:class:`Fetched` bytes. It knows a PROTOCOL, never a country: every value that
belongs to one source (a base URL, a vocabulary table, a query template) is in
that source's record.

The template language is deliberately small, so a reviewer can read a source
record without reading code:

* ``{arg}`` is the argument's value, empty when absent;
* ``{table[arg]}`` looks the argument up in one of the source's tables, empty
  when the table has no entry;
* anything else is literal.

A parameter whose name or value renders empty is left out. That one rule is
what lets a record say "send ``Fassung.FassungVom`` only for consolidated
federal law" as a table instead of as an ``if``.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass
from dataclasses import field
from typing import Any
from typing import ClassVar
from typing import Literal

from pydantic import BaseModel
from pydantic import ConfigDict

_PLACEHOLDER_RE = re.compile(r"\{(\w+)(?:\[(\w+)\])?\}")


class AccessError(RuntimeError):
    """A request the access type cannot build or a response it cannot accept."""


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Table(Strict):
    """A vocabulary of one source: argument value -> the source's own token."""

    #: ``exact``: the argument is looked up as given. ``fold``: lower-cased,
    #: ä/ö/ü/ß written ae/oe/ue/ss, other marks dropped, spaces and hyphens removed,
    #: so "Nieder-Österreich" and "niederoesterreich" find one entry.
    normalize: Literal["exact", "fold"] = "exact"
    values: dict[str, str]

    def lookup(self, value: str) -> str:
        key = fold(value) if self.normalize == "fold" else value
        return self.values.get(key, "")


def fold(value: str) -> str:
    """The ``fold`` normalization of :class:`Table`."""
    lowered = value.strip().lower()
    for umlaut, spelled in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        lowered = lowered.replace(umlaut, spelled)
    stripped = "".join(ch for ch in unicodedata.normalize("NFKD", lowered) if not unicodedata.combining(ch))
    return stripped.replace(" ", "").replace("-", "")


def placeholders(template: str) -> list[tuple[str, str | None]]:
    """The ``(name, arg)`` pairs a template refers to; ``arg`` is ``None`` for a plain ``{arg}``."""
    return [(match.group(1), match.group(2)) for match in _PLACEHOLDER_RE.finditer(template)]


def render(template: str, args: Mapping[str, Any], tables: Mapping[str, Table]) -> str:
    """Fill a template. A table placeholder whose table is unknown is a configuration error."""

    def _one(match: re.Match[str]) -> str:
        name, arg = match.group(1), match.group(2)
        if arg is None:
            value = args.get(name)
            return "" if value is None else str(value)
        table = tables.get(name)
        if table is None:
            raise AccessError(f"template refers to unknown table {name!r}")
        value = args.get(arg)
        return "" if value in (None, "") else table.lookup(str(value))

    return _PLACEHOLDER_RE.sub(_one, template)


@dataclass(frozen=True)
class Fetched:
    """The bytes one request brought back, with what a monitor and a citation need."""

    url: str
    status: int
    content_type: str
    body: bytes
    etag: str = ""
    #: Everything the protocol states about the version (a point in time, a
    #: consolidation date), read by the access type, never guessed.
    version: str = ""
    extra: dict[str, str] = field(default_factory=dict)

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.body).hexdigest()

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", errors="replace")


class AccessConfig(Strict):
    """Base of every access type's configuration model."""

    def urls(self) -> list[str]:
        """Every absolute URL the configuration names; each must be on the source's hosts."""
        return []


class AccessType:
    """Base of the protocol implementations. Subclasses set ``name`` and ``config_model``."""

    name: ClassVar[str]
    config_model: ClassVar[type[AccessConfig]]

    def __init__(self, source) -> None:  # source: public_sources.source.Source
        self.source = source
        self.config = self.config_model.model_validate(source.access)

    async def fetch(self, client, operation: str, args: Mapping[str, Any]) -> Fetched:
        raise NotImplementedError

    async def _get(self, client, url: str, *, params: Mapping[str, str] | None = None, headers=None) -> Fetched:
        """One GET through ``client`` (a guarded client), checked against the source's hosts."""
        self.source.require_allowed(url)
        response = await client.get(url, params=params, headers=headers)
        if response.status_code >= 400:
            raise AccessError(f"{self.source.id}: HTTP {response.status_code} for {response.url}")
        return Fetched(
            url=str(response.url),
            status=response.status_code,
            content_type=response.headers.get("content-type", ""),
            body=response.content,
            etag=response.headers.get("etag", ""),
        )
