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


class AccessError(RuntimeError): ...


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Table(Strict):
    normalize: Literal["exact", "fold"] = "exact"
    values: dict[str, str]

    def lookup(self, value: str) -> str:
        key = fold(value) if self.normalize == "fold" else value
        return self.values.get(key, "")


def fold(value: str) -> str:
    lowered = value.strip().lower()
    for umlaut, spelled in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        lowered = lowered.replace(umlaut, spelled)
    stripped = "".join(ch for ch in unicodedata.normalize("NFKD", lowered) if not unicodedata.combining(ch))
    return stripped.replace(" ", "").replace("-", "")


def placeholders(template: str) -> list[tuple[str, str | None]]:
    return [(match.group(1), match.group(2)) for match in _PLACEHOLDER_RE.finditer(template)]


def render(template: str, args: Mapping[str, Any], tables: Mapping[str, Table]) -> str:

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
    url: str
    status: int
    content_type: str
    body: bytes
    etag: str = ""
    version: str = ""
    extra: dict[str, str] = field(default_factory=dict)

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.body).hexdigest()

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", errors="replace")


class AccessConfig(Strict):
    def urls(self) -> list[str]:
        return []


class AccessType:
    name: ClassVar[str]
    config_model: ClassVar[type[AccessConfig]]
    served_operations: ClassVar[tuple[str, ...]] = ()

    @classmethod
    def operations_of(cls, config: AccessConfig) -> tuple[str, ...]:
        declared = getattr(config, "operations", None)
        return tuple(declared) if declared is not None else cls.served_operations

    def __init__(self, source) -> None:  # source: public_sources.source.Source
        self.source = source
        self.config = self.config_model.model_validate(source.access)

    async def fetch(self, client, operation: str, args: Mapping[str, Any]) -> Fetched:
        raise NotImplementedError

    async def _get(self, client, url: str, *, params: Mapping[str, str] | None = None, headers=None) -> Fetched:
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
