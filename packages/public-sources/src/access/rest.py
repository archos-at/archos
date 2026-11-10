"""``rest``: a GET API with query parameters, described by the source record.

The shape OpenAPI 3.1 describes for a read: a base URL, a path per operation,
query parameters. The record lists each operation's path and parameters as
templates over the operation's arguments and the source's tables
(:mod:`public_sources.access.base`). Austria's RIS (``configs/sources/at/ris``)
is one record of this type; NeuRIS, PVOG or planning.data.gov.uk would be
others, each a file and no code.

A parameter may carry a ``group``: a caller that composes a query in two steps
(the RIS adapter builds the search terms first and the paging after) renders
one group at a time. It may carry ``when``: the parameter is sent only when the
named argument has one of the listed values.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

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


class Param(Strict):
    """One query parameter. ``name`` is a template too, for vocabularies that key the parameter name."""

    name: str
    value: str
    group: str = ""
    when: dict[str, tuple[str, ...]] = Field(default_factory=dict)

    def applies(self, args: Mapping[str, Any]) -> bool:
        return all(str(args.get(arg, "")) in allowed for arg, allowed in self.when.items())


class Operation(Strict):
    """One read of the API: a path below the base URL and its parameters."""

    path: str = ""
    params: tuple[Param, ...] = ()
    #: Another base URL for this operation (an API whose documents live on the
    #: publisher's public site); on the source's hosts like every URL.
    base_url: str = ""


class RestConfig(AccessConfig):
    base_url: str
    operations: dict[str, Operation]
    tables: dict[str, Table] = Field(default_factory=dict)
    headers: dict[str, str] = Field(default_factory=dict)

    def urls(self) -> list[str]:
        return [self.base_url] + [op.base_url for op in self.operations.values() if op.base_url]

    @model_validator(mode="after")
    def _tables_exist(self) -> RestConfig:
        for name, operation in self.operations.items():
            templates = [operation.path] + [t for p in operation.params for t in (p.name, p.value)]
            tables = {table for template in templates for table, arg in placeholders(template) if arg is not None}
            if unknown := sorted(tables - set(self.tables)):
                raise ValueError(f"operation {name!r} refers to unknown tables {unknown}")
        return self


class Rest(AccessType):
    name = "rest"
    config_model = RestConfig

    def operation(self, operation: str) -> Operation:
        try:
            return self.config.operations[operation]
        except KeyError:
            raise AccessError(f"{self.source.id}: no operation {operation!r}") from None

    def table(self, name: str) -> Table:
        try:
            return self.config.tables[name]
        except KeyError:
            raise AccessError(f"{self.source.id}: no table {name!r}") from None

    def params(self, operation: str, args: Mapping[str, Any], *, group: str | None = None) -> dict[str, str]:
        """The query of ``operation`` for ``args``, in the record's order; ``group`` narrows it."""
        query: dict[str, str] = {}
        for param in self.operation(operation).params:
            if group is not None and param.group != group:
                continue
            if not param.applies(args):
                continue
            name = render(param.name, args, self.config.tables)
            value = render(param.value, args, self.config.tables)
            if name and value:
                query[name] = value
        return query

    def url(self, operation: str, args: Mapping[str, Any], *, base_url: str | None = None) -> str:
        """The operation's URL. A path that renders empty means an argument had no entry."""
        template = self.operation(operation).path
        path = render(template, args, self.config.tables)
        if template and not path:
            raise AccessError(f"{self.source.id}: operation {operation!r} has no path for {dict(args)!r}")
        base = (base_url or self.operation(operation).base_url or self.config.base_url).rstrip("/")
        return f"{base}/{path}" if path else base

    async def fetch(self, client, operation: str, args: Mapping[str, Any]) -> Fetched:
        return await self._get(
            client,
            self.url(operation, args),
            params=self.params(operation, args),
            headers=self.config.headers or None,
        )
