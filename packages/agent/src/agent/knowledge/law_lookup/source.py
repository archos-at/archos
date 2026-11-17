from __future__ import annotations

import re
from dataclasses import dataclass
from functools import cache
from urllib.parse import urlparse

from public_sources import access_for
from public_sources import engine_for
from public_sources import get_source
from public_sources.lookup import LocusUnit
from public_sources.lookup import Lookup
from public_sources.source import Source

from agent.knowledge.law_lookup.locus import Grammar
from agent.knowledge.law_lookup.locus import compile_grammar


class LawSourceError(ValueError):
    ...


@dataclass(frozen=True)
class LawSource:

    source: Source
    lookup: Lookup
    access: object
    engine: object
    grammar: Grammar
    transport_key: str | Source

    @property
    def wording(self):
        return self.lookup.wording

    @property
    def namespace(self) -> str:
        return self.lookup.namespace or self.source.id

    @property
    def subdivision_short(self) -> str:
        return self.wording.subdivision_short or self.wording.subdivision

    @property
    def section_sign(self) -> str:
        return self.lookup.locus.units[0].sign

    @property
    def section_plural(self) -> str:
        unit = self.lookup.locus.units[0]
        return unit.sign * 2 if unit.repeatable else unit.sign

    def unit(self, sign: str) -> LocusUnit | None:
        return next((unit for unit in self.lookup.locus.units if unit.sign == sign), None)

    def display_sign(self, sign: str) -> str:
        unit = self.unit(sign)
        return f"{sign}." if unit is not None and unit.dot else sign

    def addressable(self, url: str) -> bool:
        if not url.lower().startswith(("http://", "https://")):
            return False
        try:
            return urlparse(url).hostname in self.source.hosts
        except ValueError:
            return False

    def public_host(self, url: str) -> str:
        return self.engine.public_host(url)

    def document_url(self, reference: str) -> str:
        reference = reference.strip()
        spec = self.lookup.reference
        if not re.fullmatch(r"[A-Za-z0-9_.\-]+", reference) or not spec.prefix_table:
            return ""
        prefixes = self.access.table(spec.prefix_table).values
        upper = reference.upper()
        placed = next((value for prefix, value in prefixes.items() if upper.startswith(prefix)), "")
        if not placed:
            return ""
        return self.access.url(self.lookup.document, {spec.prefix_argument: placed, spec.argument: reference})

    def document_path_pattern(self) -> re.Pattern[str] | None:
        template = self.access.operation(self.lookup.document).path
        marker = "{" + self.lookup.reference.argument + "}"
        head, found, _rest = template.partition(marker)
        if not found:
            return None
        literal = re.sub(r"\\\{[^}]*\\\}", "[^/]+", re.escape(head))
        return re.compile(f"/{literal}([^/]+)/", re.IGNORECASE)

    def is_consolidated_url(self, url: str) -> bool:
        return any(marker in url for marker in self.lookup.consolidated_urls)


def law_source(source_id: str) -> LawSource:
    return _cached(source_id)


@cache
def _cached(source_id: str) -> LawSource:
    return law_source_from_record(get_source(source_id), transport_key=source_id)


def law_source_from_record(source: Source, *, transport_key: str | Source | None = None) -> LawSource:
    if source.lookup is None:
        raise LawSourceError(f"source {source.id!r} has no lookup block: no law lookup can read it")
    return LawSource(
        source=source,
        lookup=source.lookup,
        access=access_for(source),
        engine=engine_for(source),
        grammar=compile_grammar(source.lookup.locus),
        transport_key=transport_key if transport_key is not None else source,
    )
