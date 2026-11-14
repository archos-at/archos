"""The source a law lookup reads, and everything the lookup derives from its record once.

The lookup names no country. Which statute database it reads, how that
database's texts cite a provision, which collections its search offers, how a
territory becomes its filter and which words the tool writes back are the
source record's ``lookup`` block (``public_sources.lookup``). This module turns
a record into the one object the stages share: the record, its access type
(the requests), its format engine (the responses), its compiled citation
grammar, and the search plan model the planner fills.

Today a record comes from the repository by id (``configs/sources/``); a turn's
configured source (``public_sources.source.parse_inline_source``) is the same
object built from a mapping, which :func:`law_source_from_record` takes.
"""

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
    """A record a law lookup cannot read: no ``lookup`` block, or one that names what the access lacks."""


@dataclass(frozen=True)
class LawSource:
    """One source as the lookup reads it. Built once per record; immutable."""

    source: Source
    lookup: Lookup
    #: The ``rest`` access type, configured from the record: it builds every request.
    access: object
    #: The format engine, configured from the record: it reads every response.
    engine: object
    grammar: Grammar
    #: What :func:`public_sources.routing.source_transport` is handed: the id of a repository record,
    #: the record itself for a configured one (whose hosts the fetcher cannot look up).
    transport_key: str | Source

    @property
    def wording(self):
        return self.lookup.wording

    @property
    def namespace(self) -> str:
        """The first segment of a passage's collection id and of the cache keys."""
        return self.lookup.namespace or self.source.id

    @property
    def subdivision_short(self) -> str:
        return self.wording.subdivision_short or self.wording.subdivision

    @property
    def section_sign(self) -> str:
        """The sign of the preferred unit (``§``), in sentences that speak of provisions."""
        return self.lookup.locus.units[0].sign

    @property
    def section_plural(self) -> str:
        """The preferred unit's sign for several provisions: doubled where it may be (``§§``)."""
        unit = self.lookup.locus.units[0]
        return unit.sign * 2 if unit.repeatable else unit.sign

    def unit(self, sign: str) -> LocusUnit | None:
        return next((unit for unit in self.lookup.locus.units if unit.sign == sign), None)

    def display_sign(self, sign: str) -> str:
        """A unit's sign as a list writes it: ``§``, ``Art.``."""
        unit = self.unit(sign)
        return f"{sign}." if unit is not None and unit.dot else sign

    def addressable(self, url: str) -> bool:
        """Whether ``url`` is on one of the source's hosts (``http`` too: the fetch then refuses it)."""
        if not url.lower().startswith(("http://", "https://")):
            return False
        try:
            return urlparse(url).hostname in self.source.hosts
        except ValueError:
            return False

    def public_host(self, url: str) -> str:
        return self.engine.public_host(url)

    def document_url(self, reference: str) -> str:
        """The document operation's URL for a bare reference, or ``""`` when the record cannot place it."""
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
        """The document operation's path up to its reference, as a regex reading the reference back."""
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
    """The repository record ``source_id`` as a law lookup reads it (cached per process: records are files)."""
    return _cached(source_id)


@cache
def _cached(source_id: str) -> LawSource:
    return law_source_from_record(get_source(source_id), transport_key=source_id)


def law_source_from_record(source: Source, *, transport_key: str | Source | None = None) -> LawSource:
    """A record, repository or configured, as a law lookup reads it."""
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
