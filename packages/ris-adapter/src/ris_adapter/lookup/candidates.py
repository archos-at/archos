from __future__ import annotations

import logging
from dataclasses import dataclass

from ris_adapter.client import RisError
from ris_adapter.client import RisHit
from ris_adapter.client import build_document_url
from ris_adapter.lookup.address import Address
from ris_adapter.lookup.as_of import in_force_on
from ris_adapter.lookup.as_of import parse_day
from ris_adapter.lookup.trace import LookupTrace
from ris_adapter.register import _CASE_LAW_SIGNALS
from ris_adapter.register import _CATALOG_AVAILABLE
from ris_adapter.register import _build_search_params
from ris_adapter.register import focus_entries
from ris_adapter.register import load_registry
from ris_adapter.register import match_entries

logger = logging.getLogger(__name__)

MAX_CANDIDATES = 3
LIVE_PAGE_SIZE = 20


@dataclass(frozen=True)
class Candidate:
    title: str
    url: str = ""  # fetchable full text; empty for a reference-only entry
    citation_url: str = ""
    document_number: str = ""
    application: str = ""
    federal_state: str = ""
    origin: str = ""  # "address" | "catalog" | "live"
    version_date: str = ""
    unavailable: str = ""  # why there is no full text, stated verbatim to the model

    @property
    def fetchable(self) -> bool:
        return bool(self.url)


async def collect_candidates(
    client, planner, question, address: Address, trace: LookupTrace, catalog_path: str, as_of: str = ""
):
    if as_of:
        return await live_candidates(client, planner, question, address, trace, as_of)
    addressed = candidate_from_address(address)
    if addressed is not None:
        trace.searched = f"the address you passed ({addressed.citation_url})"
        return [addressed]
    use_catalog = not trace.application and not _CASE_LAW_SIGNALS.search(question)
    catalog = catalog_candidates(question, address, catalog_path) if use_catalog else []
    if any(candidate.fetchable for candidate in catalog):
        trace.searched = f"the curated norm catalog for {address.law or question!r}"
        return catalog[:MAX_CANDIDATES]
    live = await live_candidates(client, planner, question, address, trace)
    return (catalog + live)[:MAX_CANDIDATES]


def candidate_from_address(address: Address) -> Candidate | None:
    if address.url:
        return Candidate(title="", url=address.url, citation_url=address.url, origin="address")
    if not address.document_number:
        return None
    try:
        url = build_document_url(address.document_number)
    except RisError:
        return None
    return Candidate(
        title="",
        url=url,
        citation_url=url,
        document_number=address.document_number,
        origin="address",
    )


def catalog_candidates(question: str, address: Address, catalog_path: str) -> list[Candidate]:
    if not _CATALOG_AVAILABLE:
        return []
    catalog = load_registry(catalog_path or None)
    if catalog is None:
        return []
    needle = " ".join(part for part in (address.law, question) if part)
    matches = focus_entries(match_entries(catalog, needle), address.federal_state)
    return [candidate_from_entry(entry) for entry in matches[:MAX_CANDIDATES]]


def candidate_from_entry(entry) -> Candidate:
    unavailable = ""
    if not entry.is_ris:
        unavailable = (
            f"Not in RIS - web source: {entry.source_url}"
            if entry.source_url
            else "Not in RIS - no accessible full text (reference only, say so openly)"
        )
    return Candidate(
        title=entry.title,
        url=(entry.full_law_url or entry.citation_url) if entry.is_ris else "",
        citation_url=entry.citation_url or entry.source_url,
        document_number=entry.document_number,
        application=entry.application,
        federal_state=entry.federal_state,
        origin="catalog",
        unavailable=unavailable,
    )


def candidate_from_hit(hit: RisHit) -> Candidate:
    return Candidate(
        title=hit.title,
        url=hit.full_law_url or hit.fetch_url,
        citation_url=hit.citation_url or hit.fetch_url,
        document_number=hit.document_number,
        application=hit.application,
        federal_state=hit.metadata.get("Bundesland", ""),
        origin="live",
        version_date=hit.metadata.get("In Kraft seit", ""),
    )


async def live_candidates(
    client, planner, question, address: Address, trace: LookupTrace, as_of: str = ""
) -> list[Candidate]:
    plan = await search_plan(planner, question, address, trace)
    try:
        params = _build_search_params(
            plan["application"], plan["query"], plan["title"], plan["federal_state"], as_of, ""
        )
        result = await client.search(application=plan["application"], params=params, page=1, page_size=LIVE_PAGE_SIZE)
    except RisError as exc:
        logger.info("ris_lookup: live RIS search failed (%s)", exc)
        return []
    except Exception:  # a tool must always hand the agent a string, so a miss it is
        logger.exception("ris_lookup: live RIS search failed")
        return []
    if as_of:
        return versions_on(result.hits, as_of, trace)
    return [candidate_from_hit(hit) for hit in result.hits[:MAX_CANDIDATES]]


def versions_on(hits, as_of: str, trace: LookupTrace) -> list[Candidate]:
    day = parse_day(as_of)
    kept = [hit for hit in hits if day is not None and in_force_on(hit.metadata, day)]
    trace.versions_dropped = len(hits) - len(kept)
    return [
        Candidate(
            title=hit.title,
            url=hit.fetch_url,
            citation_url=hit.citation_url or hit.fetch_url,
            document_number=hit.document_number,
            application=hit.application,
            federal_state=hit.metadata.get("Bundesland", ""),
            origin="live",
            version_date=hit.metadata.get("In Kraft seit", ""),
        )
        for hit in kept[:MAX_CANDIDATES]
    ]


async def search_plan(planner, question: str, address: Address, trace: LookupTrace) -> dict:
    effective = {
        "application": trace.application or ("LrKons" if address.federal_state else "BrKons"),
        "query": question,
        "title": address.law,
        "federal_state": address.federal_state,
    }
    if planner is not None:
        effective = await _planned(planner, effective, address)
    trace.searched = repr(effective["query"])
    trace.application = effective["application"]
    return effective


async def _planned(planner, effective: dict, address: Address) -> dict:
    try:
        plan = await planner(
            effective["query"], effective["application"], effective["title"], effective["federal_state"], "", ""
        )
    except Exception:  # noqa: BLE001 — same fail-open as ris_search's planner
        logger.warning("ris_lookup: planner failed, using the caller's words", exc_info=True)
        return effective
    if plan is None or not plan.suchworte.strip():
        return effective
    return {
        "application": plan.application,
        "query": plan.suchworte,
        "title": plan.titel,
        "federal_state": address.federal_state or plan.federal_state,
    }
