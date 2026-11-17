"""``http_eli``: legislation addressed by European Legislation Identifier URIs.

ELI (Council conclusions 2012/C 325/02, 2017/C 441/05) names a work, its
expression at a point in time, its language and its format with one URI
pattern per publisher. The record holds that pattern as a template; the access
type fills it, checks every argument against the pattern the record declares
for it (an argument may sit inside a URI or a query, so it is never free text),
and resolves the expression to the bytes of a manifestation.

Publishers resolve differently, and the record says which:

* ``direct``: the ELI URI itself answers with the manifestation
  (legislation.gov.uk's ``/data.akn``). One GET.
* ``sparql``: the URI is a resource in the publisher's linked-data graph and
  the file is found by a query (Fedlex: the consolidation in force on a date,
  then its ``jolux:isExemplifiedBy`` file). One POST to the endpoint, then a GET.

The version the protocol states (the consolidation date the query chose, or
the ``{as_of}`` the caller named) is carried on :class:`Fetched` for the change
monitor and the citation, never guessed from the text.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from typing import Any
from typing import Literal

from public_sources.access.base import AccessConfig
from public_sources.access.base import AccessError
from public_sources.access.base import AccessType
from public_sources.access.base import Fetched
from public_sources.access.base import Strict
from public_sources.access.base import Table
from public_sources.access.base import placeholders
from public_sources.access.base import render
from pydantic import Field
from pydantic import model_validator

#: Patterns an argument may be declared with, by name, so a record need not write regexes.
NAMED_PATTERNS: dict[str, str] = {
    "date": r"\d{4}-\d{2}-\d{2}",
    "compact_date": r"\d{8}",
    "language": r"[a-z]{2}",
    "eli_path": r"[A-Za-z0-9_]+(/[A-Za-z0-9_]+)*",
}


class Sparql(Strict):
    endpoint: str
    #: The query, a template over the arguments and tables. Every argument it
    #: names must have a pattern, which is what keeps it a query and not an injection.
    query: str
    #: The result variable holding the manifestation URL.
    binding: str = "file"
    #: The result variable holding the version label, when the query selects one.
    version_binding: str = ""


class ElIConfig(AccessConfig):
    #: The ELI expression URI template, e.g. ``https://fedlex.data.admin.ch/eli/cc/{work}``.
    eli: str
    resolve: Literal["direct", "sparql"] = "direct"
    sparql: Sparql | None = None
    #: Argument -> a pattern from :data:`NAMED_PATTERNS` or a regex. Arguments not listed are refused.
    args: dict[str, str]
    defaults: dict[str, str] = Field(default_factory=dict)
    tables: dict[str, Table] = Field(default_factory=dict)
    #: The argument naming the point in time, copied to ``Fetched.version`` for a direct resolve.
    version_arg: str = ""

    def urls(self) -> list[str]:
        urls = [self.eli.split("{", 1)[0]]
        if self.sparql is not None:
            urls.append(self.sparql.endpoint)
        return urls

    @model_validator(mode="after")
    def _templates_are_bounded(self) -> ElIConfig:
        if self.resolve == "sparql" and self.sparql is None:
            raise ValueError("resolve: sparql needs a 'sparql' block")
        templates = [self.eli] + ([self.sparql.query] if self.sparql else [])
        refs = [ref for template in templates for ref in placeholders(template)]
        undeclared = sorted({name if arg is None else arg for name, arg in refs} - set(self.args))
        if undeclared:
            raise ValueError(f"template arguments {undeclared} have no declared pattern in 'args'")
        unknown = sorted({name for name, arg in refs if arg is not None} - set(self.tables))
        if unknown:
            raise ValueError(f"template refers to unknown tables {unknown}")
        return self


def _pattern(spec: str) -> re.Pattern[str]:
    return re.compile(NAMED_PATTERNS.get(spec, spec))


class HttpEli(AccessType):
    served_operations = ("expression",)
    name = "http_eli"
    config_model = ElIConfig

    def arguments(self, args: Mapping[str, Any]) -> dict[str, str]:
        """``args`` over the defaults, each checked against its declared pattern."""
        merged = {**self.config.defaults, **{k: str(v) for k, v in args.items() if v not in (None, "")}}
        unknown = sorted(set(merged) - set(self.config.args))
        if unknown:
            raise AccessError(f"{self.source.id}: undeclared arguments {unknown}")
        for name, value in merged.items():
            if not _pattern(self.config.args[name]).fullmatch(value):
                raise AccessError(f"{self.source.id}: argument {name}={value!r} does not match its pattern")
        # A date argument is also offered as ``{<name>_compact}`` (YYYYMMDD), the
        # form ELI paths use (``/20260701``) where queries use the ISO date.
        derived = {f"{k}_compact": v.replace("-", "") for k, v in merged.items() if self.config.args[k] == "date"}
        return {**derived, **merged}

    def expression_uri(self, args: Mapping[str, Any]) -> str:
        return render(self.config.eli, self.arguments(args), self.config.tables)

    def sparql_query(self, args: Mapping[str, Any]) -> str:
        if self.config.sparql is None:
            raise AccessError(f"{self.source.id}: no sparql resolver configured")
        return render(self.config.sparql.query, self.arguments(args), self.config.tables)

    async def fetch(self, client, operation: str, args: Mapping[str, Any]) -> Fetched:
        if operation != "expression":
            raise AccessError(f"{self.source.id}: http_eli serves the 'expression' operation, not {operation!r}")
        if self.config.resolve == "direct":
            fetched = await self._get(client, self.expression_uri(args))
            version = self.arguments(args).get(self.config.version_arg, "") if self.config.version_arg else ""
            return _with_version(fetched, version)
        file_url, version = await self._resolve_sparql(client, args)
        return _with_version(await self._get(client, file_url), version)

    async def _resolve_sparql(self, client, args: Mapping[str, Any]) -> tuple[str, str]:
        sparql = self.config.sparql
        assert sparql is not None
        self.source.require_allowed(sparql.endpoint)
        response = await client.post(
            sparql.endpoint,
            data={"query": self.sparql_query(args)},
            headers={"Accept": "application/sparql-results+json"},
        )
        if response.status_code >= 400:
            raise AccessError(f"{self.source.id}: SPARQL endpoint answered HTTP {response.status_code}")
        return _first_binding(response.content, sparql.binding, sparql.version_binding, self.source.id)


def _first_binding(body: bytes, binding: str, version_binding: str, source_id: str) -> tuple[str, str]:
    try:
        rows = json.loads(body)["results"]["bindings"]
    except (ValueError, KeyError, TypeError) as exc:
        raise AccessError(f"{source_id}: SPARQL answer is not a result set") from exc
    for row in rows:
        url = (row.get(binding) or {}).get("value", "")
        if url:
            version = (row.get(version_binding) or {}).get("value", "") if version_binding else ""
            return url, version
    raise AccessError(f"{source_id}: no manifestation found for this expression")


def _with_version(fetched: Fetched, version: str) -> Fetched:
    if not version:
        return fetched
    return Fetched(
        url=fetched.url,
        status=fetched.status,
        content_type=fetched.content_type,
        body=fetched.body,
        etag=fetched.etag,
        version=version,
        extra=fetched.extra,
    )
