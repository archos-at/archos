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

MAX_CANDIDATES = 3
LIVE_PAGE_SIZE = 20
VERSIONS_PAGE_SIZE = 100


@dataclass(frozen=True)
class Candidate:

    title: str
    url: str = ""  # fetchable full text; empty for a reference-only entry
    citation_url: str = ""
    document_number: str = ""
    collection: str = ""
    territory: str = ""
    origin: str = ""  # "address" | "catalog" | "live"
    version_date: str = ""
    provision: str = ""  # the provision a version document holds, as the hit states it (``Engine.provision_field``)
    unavailable: str = ""  # why there is no full text, stated verbatim to the model

    @property
    def fetchable(self) -> bool:
        return bool(self.url)


@dataclass(frozen=True)
class Search:

    law: LawSource
    client: object
    planner: object
    catalog_path: str = ""


async def collect_candidates(search: Search, question: str, address: Address, trace: LookupTrace, as_of: str = ""):
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
    signals = law.lookup.case_law_signals
    if not signals:
        return False
    pattern = "(" + "|".join(re.escape(signal) for signal in signals) + ")"
    return re.search(pattern, question, re.IGNORECASE) is not None


def candidate_from_address(address: Address, law: LawSource) -> Candidate | None:
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
        provision=hit.metadata.get(engine.provision_field, "") if engine.provision_field else "",
    )


async def live_candidates(
    search: Search, question: str, address: Address, trace: LookupTrace, as_of: str = ""
) -> list[Candidate]:
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
    try:
        operation = law.access.operation(law.lookup.search)
    except Exception:  # noqa: BLE001 — an access type with no operations narrows nothing
        return False
    templates = [template for param in operation.params for template in (param.name, param.value)]
    return any(name == "provision" for template in templates for name, _arg in placeholders(template))


async def _hits(search: Search, args: dict[str, str]) -> list:
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
    day = parse_day(as_of)
    kept = [hit for hit in hits if day is not None and in_force_on(hit.metadata, day, law.engine)]
    trace.versions_dropped = len(hits) - len(kept)
    if address is not None:
        kept = [hit for hit in kept if _holds_addressed(hit, address, law)]
    return [candidate_from_hit(hit, law, whole_law=False) for hit in kept[:MAX_CANDIDATES]]


def _holds_addressed(hit, address: Address, law: LawSource) -> bool:
    field = law.engine.provision_field
    stated = hit.metadata.get(field, "") if field else ""
    if not stated or not address.sections:
        return True
    kind, number = section_in(stated, law.grammar)
    return number in address.sections and kind in ("", address.kind)


async def search_plan(search: Search, question: str, address: Address, trace: LookupTrace) -> dict:
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
        "territory": address.territory or getattr(plan, "territory", ""),
    }
