"""What an edition is to this turn's site, from the knowledge context (ADR-0168, ADR-0175).

The BFF resolves the project's site against the knowledge records and sends every edition's role in the
turn's ``knowledgeContext.uses`` (``common/knowledge_context.py``), with the open-coverage, freshness and
connecting-factor corrections applied: an uncurated node's guidance is information, a stale uncurated law
no longer binds, a work that attaches to the office's seat is information. This module answers, for a
retrieved passage, which of those editions it is a text of and what that edition is here. It is the only
source of a source's binding status: where the context names no role for a passage, its status is
``unknown`` and the chip shows none. It reads the same uses the gate does, so a citation never says
``binding`` where the gate says information. The guesses that came before it (a host regex, a filename
prefix, a doc class, a registry rank) are gone with ``citations/binding.py``, and the second answer, the
turn context's ``buildingLaw``, is gone too.

A role is computed from a route, never stored (design §3.5). The coarse
status the citation chip shows stays the one the UI knows:

- law in its territory binds (``binding``);
- an edition a law makes binding is ``declared_binding``, as the WBTV makes
  OIB-RL 2:2023 binding in Wien, and so is an authority's practice, as the
  registry's ``authority_info`` rank always was;
- an edition that only guides or interprets is ``interpretive``: OIB-RL
  2:2023 in Steiermark, where the 2019 edition binds (defect 7);
- information is ``unknown``: the UI shows no chip rather than a false one;
- so is any edition whose own scope (``applicability``) is open for this project: a person's check, or a
  building fact not yet known. The chain text says it neither binds nor does not bind; so does the chip.

Fail closed: no context bound, or a gate that carries no uses, maps every passage to nothing.
A base-corpus passage maps to an edition by its corpus file, and a passage
read through a legal database (RIS) by an identity the edition's records carry
(``sourceRefs``, ``{scheme, value}``: a Gesetzesnummer as the RIS URL's query
parameter, an ELI by whole path segments of the URL; an unknown scheme never
matches). An
office's copy that happens to share a file name is the office's, and its label
is the office layer's.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs
from urllib.parse import urlsplit

from agent.citations.citation_keys import entry_shelf
from agent.citations.citation_keys import parse_citation_key
from agent.citations.entries import SourceEntry
from agent.citations.source_identity import is_legal_database_source
from agent.common.knowledge_context import EditionUse
from agent.common.knowledge_context import SourceRef
from agent.common.knowledge_context import turn_knowledge_context
from agent.common.norm_registry import canonical_oib_file_name
from agent.common.source_kinds import Shelf


@dataclass(frozen=True)
class BindingClassification:
    """A source's coarse binding status, as the citation chip shows it.

    ``binding`` / ``declared_binding`` / ``interpretive`` / ``unknown``. The default
    is ``unknown``: a passage no edition role reaches gets no badge, because a
    fabricated binding badge would be a false legal claim.
    """

    binding_status: str = "unknown"


#: The identity schemes a work's records carry and this module matches (``SOURCE_REF_SCHEMES`` in the
#: TypeScript wire); any other scheme never matches.
SOURCE_REF_SCHEMES: tuple[str, ...] = ("ris_gesetzesnummer", "eli")


def _eli_segments(url: str) -> tuple[str, ...]:
    """A URL as the segments an ELI is matched on: the host without ``www.`` (RIS links come both ways:
    ``www.ris.bka.gv.at`` and the open-data ``ris.bka.gv.at``), then each path segment, lower case. Pure."""
    parts = urlsplit(url.strip().lower())
    return (parts.netloc.removeprefix("www."), *(segment for segment in parts.path.split("/") if segment))


def _within_eli(url: str, eli: str) -> bool:
    """Whether ``url`` is the work ``eli`` names or a part of it, by whole path segments: ``…/1930/11`` holds
    ``…/1930/11/P63`` but not ``…/1930/110``, another law. A trailing ``/`` changes nothing. Pure."""
    prefix = _eli_segments(eli)
    return len(prefix) > 1 and _eli_segments(url)[: len(prefix)] == prefix


def _law_number(url: str | None) -> str | None:
    """The ``Gesetzesnummer`` query parameter of a RIS URL (``GeltendeFassung.wxe?…&Gesetzesnummer=20000006``)."""
    query = parse_qs(urlsplit(url or "").query)
    values = next((value for key, value in query.items() if key.lower() == "gesetzesnummer"), [])
    return values[0] if values else None


def _ref_matches(ref: SourceRef, entry: SourceEntry) -> bool:
    """Whether one identity names the passage ``entry`` read, by its scheme; an unknown scheme never matches. Pure.

    ``eli`` holds the passage's URL by whole path segments (host with or without ``www.``), and
    ``ris_gesetzesnummer`` is the Gesetzesnummer its RIS URL asks for (``SOURCE_REF_SCHEMES``).
    """
    if ref.scheme == "eli":
        return bool(entry.url) and _within_eli(entry.url, ref.value)
    if ref.scheme == "ris_gesetzesnummer":
        return _law_number(entry.url) == ref.value
    return False


def _use_for_legal_database(uses: tuple[EditionUse, ...], entry: SourceEntry) -> EditionUse | None:
    """The edition a passage read through a legal database (RIS) is, by an identity its records carry."""
    return next((use for use in uses if any(_ref_matches(ref, entry) for ref in use.source_refs)), None)


def use_for_entry(entry: SourceEntry) -> EditionUse | None:
    """The edition a passage is a text of, with its role here; None when the records do not say.

    A base-corpus passage maps by its corpus file; a passage read through a legal database by the
    identities the edition's manifestation records carry (``sourceRefs``). Anything else maps to nothing,
    and its status is ``unknown`` (fail closed).
    """
    uses = turn_knowledge_context().uses
    if not uses:
        return None
    if is_legal_database_source(entry):
        return _use_for_legal_database(uses, entry)
    if not entry.citation_key or entry_shelf(entry) is not Shelf.BASE:
        return None
    file_name, _page = parse_citation_key(entry.citation_key)
    base_name = canonical_oib_file_name(file_name.rsplit("/", 1)[-1])
    if not base_name:
        return None
    return next(
        (use for use in uses if base_name in (canonical_oib_file_name(name) for name in use.corpus_files)), None
    )


def binding_status_for(use: EditionUse) -> str:
    """The coarse status the citation chip shows for a role (module docstring). Pure.

    An edition whose own scope is open for this project (a person's check, a building fact not yet known)
    is ``unknown`` whatever its role: the chain text says it neither binds nor does not bind until then.
    """
    if use.scope_unsettled:
        return "unknown"
    if use.role == "binding":
        return "binding" if use.via == "territory" else "declared_binding"
    if use.role == "authority_practice":
        return "declared_binding"
    if use.role in ("guidance", "interpretation"):
        return "interpretive"
    return "unknown"


def classification_for(use: EditionUse | None, *, place: bool) -> BindingClassification:
    """The classification a source carries: its edition's role here, else ``unknown``; a place never binds. Pure."""
    if place or use is None:
        return BindingClassification()
    return BindingClassification(binding_status=binding_status_for(use))


def role_fields(use: EditionUse | None) -> dict[str, Any]:
    """The wire fields a source carries for its role; empty without one, so the payload is unchanged."""
    if use is None:
        return {}
    return {"role": use.role, "role_qualifier": use.qualifier, "edition_id": use.edition_id}
