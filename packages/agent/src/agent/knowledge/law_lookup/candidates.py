"""[2] Which documents this call will consider. CAP: three.

Two sources, in this order, because one is verified and free and the other is
neither: the norm catalog (``configs/norms/*/registry.yml``, ADR-0025) holds
checked pointers for the core building law, and a live search of the source,
planned by the search planner, covers everything else. A caller who passed an
address (a source URL or a document number) skips both: an address is not a
guess to be improved.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

from public_sources.access.base import fold
from public_sources.access.base import placeholders

from agent.knowledge.law_lookup.address import Address
from agent.knowledge.law_lookup.address import section_in
from agent.knowledge.law_lookup.as_of import in_force_on
from agent.knowledge.law_lookup.as_of import parse_day
from agent.knowledge.law_lookup.client import SourceRequestError
from agent.knowledge.law_lookup.source import LawSource
from agent.knowledge.law_lookup.trace import LookupTrace

logger = logging.getLogger(__name__)

#: Documents considered per call. Three is one law, the adjacent one a
#: building-law question straddles, and one spare: past that the tool is
#: guessing, and a miss naming what it did not read beats a third download.
MAX_CANDIDATES = 3
#: Live-search page size.
LIVE_PAGE_SIZE = 20
#: Page size of a past day's search by the act's title. Such a search answers every version of every provision
#: of the act (a province's building ordinance: 35 to 58 hits, dev QC 2026-11-12), and the one in force on the
#: day has to be on the page; the source's largest page.
VERSIONS_PAGE_SIZE = 100


@dataclass(frozen=True)
class Candidate:
    """A document this call MIGHT read, with everything a citation needs."""

    title: str
    url: str = ""  # fetchable full text; empty for a reference-only entry
    citation_url: str = ""
    document_number: str = ""
    collection: str = ""
    territory: str = ""
    origin: str = ""  # "address" | "catalog" | "live"
    version_date: str = ""
    unavailable: str = ""  # why there is no full text, stated verbatim to the model

    @property
    def fetchable(self) -> bool:
        return bool(self.url)


@dataclass(frozen=True)
class Search:
    """What one call's live search needs: the source, its client, the planner, the catalog's path."""

    law: LawSource
    client: object
    planner: object
    catalog_path: str = ""


async def collect_candidates(search: Search, question: str, address: Address, trace: LookupTrace, as_of: str = ""):
    """At most three documents: the address, else the catalog, else the live search.

    On a past day (``as_of``) only live version documents in force on it: an
    address or a catalog pointer names today's consolidation (``as_of.py``).
    A day of today or later never reaches here as ``as_of`` (``as_of.reads_today``).
    """
    if as_of:
        return await dated_candidates(search, question, address, trace, as_of)
    addressed = candidate_from_address(address, search.law)
    if addressed is not None:
        trace.searched = f"the address you passed ({addressed.citation_url})"
        return [addressed]
    listed = listed_candidates(question, address, search.law)
    if listed is not None:
        trace.searched = f"the documents {search.law.wording.source} lists, for {address.law or question!r}"
        return listed[:MAX_CANDIDATES]
    use_catalog = not trace.collection and not _signals_case_law(question, search.law)
    catalog = catalog_candidates(question, address, search) if use_catalog else []
    if any(candidate.fetchable for candidate in catalog):
        trace.searched = f"the curated norm catalog for {address.law or question!r}"
        return catalog[:MAX_CANDIDATES]
    live = await live_candidates(search, question, address, trace)
    return (catalog + live)[:MAX_CANDIDATES]


def _signals_case_law(question: str, law: LawSource) -> bool:
    """Whether the question asks for case law (the record's words), which no statute catalog answers."""
    signals = law.lookup.case_law_signals
    if not signals:
        return False
    pattern = "(" + "|".join(re.escape(signal) for signal in signals) + ")"
    return re.search(pattern, question, re.IGNORECASE) is not None


def candidate_from_address(address: Address, law: LawSource) -> Candidate | None:
    """The document the caller addressed directly: a source URL or a document number."""
    if address.url:
        return Candidate(title="", url=address.url, citation_url=address.url, origin="address")
    if not address.document_number:
        return None
    try:
        url = law.document_url(address.document_number)
    except Exception:  # noqa: BLE001 — a number the record cannot place is no address
        return None
    if not url:
        return None
    return Candidate(title="", url=url, citation_url=url, document_number=address.document_number, origin="address")


def listed_candidates(question: str, address: Address, law: LawSource) -> list[Candidate] | None:
    """The documents a source without a search lists in its record, matched by title; None for a searchable source.

    A portal that publishes each statute as a page (``web_document``) names its documents in the record;
    the one the reference or the question names is read, and a source that lists one document reads it.
    """
    documents = getattr(law.access.config, "documents", None)
    if law.lookup.search or not documents:
        return None
    wanted = fold(f"{address.law} {question}")
    named = [document for document in documents if document.title and fold(document.title) in wanted]
    chosen = named or (list(documents) if len(documents) == 1 else [])
    return [
        Candidate(title=document.title, url=document.url, citation_url=document.url, origin="record")
        for document in chosen
    ]


def catalog_candidates(question: str, address: Address, search: Search) -> list[Candidate]:
    """Verified pointers from the norm catalog, jurisdiction-filtered.

    Match on the topic, then drop every other territory's law: a project in one
    territory must never be handed another's building code.
    """
    from agent.common.norm_registry import focus_entries
    from agent.common.norm_registry import load_registry
    from agent.common.norm_registry import match_entries

    catalog = load_registry(search.catalog_path or None)
    if catalog is None:
        return []
    needle = " ".join(part for part in (address.law, question) if part)
    matches = focus_entries(match_entries(catalog, needle), address.territory)
    return [candidate_from_entry(entry, search.law) for entry in matches[:MAX_CANDIDATES]]


def candidate_from_entry(entry, law: LawSource) -> Candidate:
    """One catalog entry as a candidate, unavailability stated verbatim.

    A norm that exists with no reachable full text is a fact the answer must
    state, not a silent gap.
    """
    in_source = bool(entry.application and entry.document_number)
    name = law.wording.source
    unavailable = ""
    if not in_source:
        unavailable = (
            f"Not in {name} - web source: {entry.source_url}"
            if entry.source_url
            else f"Not in {name} - no accessible full text (reference only, say so openly)"
        )
    return Candidate(
        title=entry.title,
        url=(entry.full_law_url or entry.citation_url) if in_source else "",
        citation_url=entry.citation_url or entry.source_url,
        document_number=entry.document_number,
        collection=entry.application,
        territory=entry.federal_state,
        origin="catalog",
        unavailable=unavailable,
    )


def candidate_from_hit(hit, law: LawSource, *, whole_law: bool = True) -> Candidate:
    """One live hit as a candidate.

    The whole law beats the single-provision document: the extractor works on
    provisions and the consolidated law is the document that HAS them. Case
    law has no whole-law URL and falls back to its own text. A version of a
    past day is read as itself (``whole_law=False``), never the law of today.

    A version's in-force date is stated only when the document read IS that
    version. Today's consolidated law is not the hit's version, so it carries
    no date of the hit's: a search hit of a 2016 version, read as today's law,
    was cited as „Fassung 2016-10-25" for a question about 2026 (dev QC
    2026-11-12).
    """
    engine = law.engine
    reads_today = whole_law and bool(hit.full_law_url)
    url = hit.full_law_url if reads_today else hit.fetch_url
    own_date = hit.metadata.get(engine.in_force_from, "") if engine.in_force_from else ""
    return Candidate(
        title=hit.title,
        url=url,
        citation_url=hit.citation_url or hit.fetch_url,
        document_number=hit.document_number,
        collection=hit.application,
        territory=hit.metadata.get(engine.territory_field, "") if engine.territory_field else "",
        origin="live",
        version_date="" if reads_today else own_date,
    )


async def live_candidates(
    search: Search, question: str, address: Address, trace: LookupTrace, as_of: str = ""
) -> list[Candidate]:
    """A live search of the source, planned when a planner is configured; on ``as_of``, versions of that day."""
    if not search.law.lookup.search:
        return []
    plan = await search_plan(search, question, address, trace)
    hits = await _hits(search, _search_args(search.law, plan, as_of))
    if as_of:
        return versions_on(hits, as_of, trace, search.law)
    return [candidate_from_hit(hit, search.law) for hit in hits[:MAX_CANDIDATES]]


async def dated_candidates(
    search: Search, question: str, address: Address, trace: LookupTrace, as_of: str
) -> list[Candidate]:
    """On a past day: the named provision's versions of that day, found by the act's title; else the planned search.

    A caller who names the act and the provision has said which law it is, so the act's title is the search,
    with no full-text terms and no planner rewrite: the words of a question („which guidelines are binding")
    rarely stand in the provision that answers it, and a source with no version date for a collection answers
    a full-text search with today's hits or none (dev QC 2026-11-12: three provinces' building ordinances
    missed). Where the record's search takes the provision (``{provision}``), the search is narrowed to it
    first: a large act holds more versions than a page. An act named with no provision is the planned search's,
    which looks for the provision that answers.
    """
    if not (address.law and address.sections and search.law.lookup.search):
        return await live_candidates(search, question, address, trace, as_of)
    plan = {
        "collection": trace.collection or search.law.lookup.statute(subdivision=bool(address.territory)).id,
        "terms": "",
        "title": address.law,
        "territory": address.territory,
    }
    narrowed = len(address.sections) == 1 and _takes_provision(search.law)
    for provision in (address.number, "") if narrowed else ("",):
        args = _search_args(search.law, plan, as_of, page_size=VERSIONS_PAGE_SIZE)
        args.update(provision=provision, provision_kind=address.kind if provision else "")
        kept = versions_on(await _hits(search, args), as_of, trace, search.law, address)
        if kept:
            trace.searched = f"the versions of {address.law!r}"
            trace.collection = plan["collection"]
            return kept
    return await live_candidates(search, question, address, trace, as_of)


def _takes_provision(law: LawSource) -> bool:
    """Whether the record's search operation narrows to one provision (a ``{provision}`` argument)."""
    try:
        operation = law.access.operation(law.lookup.search)
    except Exception:  # noqa: BLE001 — an access type with no operations narrows nothing
        return False
    templates = [template for param in operation.params for template in (param.name, param.value)]
    return any(name == "provision" for template in templates for name, _arg in placeholders(template))


async def _hits(search: Search, args: dict[str, str]) -> list:
    """The search's hits; a failed search is no hits, because a tool must always hand the agent a string."""
    try:
        result = await search.client.search(args)
    except SourceRequestError as exc:
        logger.info("law_lookup: live search failed (%s)", exc)
        return []
    except Exception:
        logger.exception("law_lookup: live search failed")
        return []
    return list(result.hits)


def _search_args(law: LawSource, plan: dict, as_of: str, *, page_size: int = LIVE_PAGE_SIZE) -> dict[str, str]:
    """The plan as the record's search operation's arguments (its templates name them)."""
    args = {
        "application": plan["collection"],
        "query": plan["terms"],
        "title": plan["title"],
        "date_from": as_of,
        "date_to": "",
        "page": "1",
        "page_size": str(page_size),
    }
    if law.lookup.territory is not None:
        args[law.lookup.territory.argument] = plan["territory"]
    return args


def versions_on(hits, as_of: str, trace: LookupTrace, law: LawSource, address: Address | None = None):
    """The version documents in force on ``as_of``, each read as itself, never the whole law of today.

    With an address, only the addressed provisions' documents, where a hit states its provision: a version
    document holds one provision, and the act's other provisions of that day answer nothing about it.
    """
    day = parse_day(as_of)
    kept = [hit for hit in hits if day is not None and in_force_on(hit.metadata, day, law.engine)]
    trace.versions_dropped = len(hits) - len(kept)
    if address is not None:
        kept = [hit for hit in kept if _holds_addressed(hit, address, law)]
    return [candidate_from_hit(hit, law, whole_law=False) for hit in kept[:MAX_CANDIDATES]]


def _holds_addressed(hit, address: Address, law: LawSource) -> bool:
    """Whether a version document holds an addressed provision; true when either side names none."""
    field = law.engine.provision_field
    stated = hit.metadata.get(field, "") if field else ""
    if not stated or not address.sections:
        return True
    kind, number = section_in(stated, law.grammar)
    return number in address.sections and kind in ("", address.kind)


async def search_plan(search: Search, question: str, address: Address, trace: LookupTrace) -> dict:
    """The effective search, planned when a planner is configured."""
    effective = {
        "collection": trace.collection or search.law.lookup.statute(subdivision=bool(address.territory)).id,
        "terms": question,
        "title": address.law,
        "territory": address.territory,
    }
    if search.planner is not None:
        effective = await _planned(search.planner, effective, address)
    trace.searched = repr(effective["terms"])
    trace.collection = effective["collection"]
    return effective


async def _planned(planner, effective: dict, address: Address) -> dict:
    """Run the planner; the caller's arguments survive a planner failure."""
    try:
        plan = await planner(
            effective["terms"], effective["collection"], effective["title"], effective["territory"], "", ""
        )
    except Exception:  # noqa: BLE001 — fail-open: the caller's words are a search too
        logger.warning("law_lookup: planner failed, using the caller's words", exc_info=True)
        return effective
    if plan is None or not plan.terms.strip():
        return effective
    return {
        "collection": plan.collection,
        "terms": plan.terms,
        "title": plan.title,
        # The caller's / project's territory outranks the planner's guess: it is a
        # request FACT, and a planner that drops it hands one territory another's law.
        "territory": address.territory or getattr(plan, "territory", ""),
    }
