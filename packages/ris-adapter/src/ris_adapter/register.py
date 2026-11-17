from __future__ import annotations

import asyncio
import logging
import os
import re
import tempfile
from datetime import UTC
from datetime import datetime
from urllib.parse import parse_qs
from urllib.parse import urlparse

from langchain_core.exceptions import OutputParserException
from pydantic import AliasChoices
from pydantic import BaseModel
from pydantic import Field
from pydantic import ValidationError

from nat.plugin_api import Builder
from nat.plugin_api import FunctionBaseConfig
from nat.plugin_api import FunctionInfo
from nat.plugin_api import LLMRef
from nat.plugin_api import register_function
from ris_adapter import descriptions
from ris_adapter.cache import cache_get_json
from ris_adapter.cache import cache_set_json
from ris_adapter.cache import fetch_document_cached
from ris_adapter.cache import ingested_marker_key
from ris_adapter.cache import ris_cache_ttl_seconds
from ris_adapter.cache import search_cache_key
from ris_adapter.client import DEFAULT_BASE_URL
from ris_adapter.client import PAGE_SIZES
from ris_adapter.client import RisClient
from ris_adapter.client import RisError
from ris_adapter.client import RisHit
from ris_adapter.client import build_document_url
from ris_adapter.client import search_terms
from ris_adapter.search_plan import RisSearchPlan

try:
    from agent.common.norm_registry import NormEntry
    from agent.common.norm_registry import extract_federal_state
    from agent.common.norm_registry import focus_entries
    from agent.common.norm_registry import load_registry
    from agent.common.norm_registry import match_entries
    from agent.common.prompt_caching import one_shot_calls
    from agent.common.turn_status import record_lane_hit as _record_lane_hit

    _CATALOG_AVAILABLE = True
    _LANE_CAPTURE_AVAILABLE = True
except ImportError:  # adapter used standalone, without the agent package
    NormEntry = None  # type: ignore[assignment]
    extract_federal_state = None  # type: ignore[assignment]
    focus_entries = None  # type: ignore[assignment]
    load_registry = None  # type: ignore[assignment]
    match_entries = None  # type: ignore[assignment]
    from contextlib import nullcontext as one_shot_calls

    _CATALOG_AVAILABLE = False
    _record_lane_hit = None  # type: ignore[assignment]
    _LANE_CAPTURE_AVAILABLE = False

logger = logging.getLogger(__name__)

_KONSOLIDIERT_APPLICATIONS = frozenset({"BrKons", "LrKons"})

_KONSOLIDIERT_NOTE = (
    "Legal status: konsolidierte Fassung (consolidated version) — informational, not legally "
    "binding. The authentic text is the promulgation in the Bundesgesetzblatt/Landesgesetzblatt "
    "(applications BgblAuth/LgblAuth)."
)

_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")

_CASE_LAW_SIGNALS = re.compile(
    r"(vwgh|vfgh|judikatur|erkenntnis|entscheidung|geschäftszahl|geschaeftszahl|beschluss|urteil)",
    re.IGNORECASE,
)


def _build_search_params(
    application: str,
    query: str,
    title: str,
    federal_state: str,
    date_from: str,
    date_to: str,
) -> dict[str, str]:
    for value, name in ((date_from, "date_from"), (date_to, "date_to")):
        if value and not _DATE_RE.fullmatch(value.strip()):
            raise RisError(f"{name} must use the YYYY-MM-DD format, got '{value}'")
    args = {
        "application": application,
        "query": query,
        "title": title,
        "federal_state": federal_state,
        "date_from": date_from.strip(),
        "date_to": date_to.strip(),
    }
    return search_terms(args)


class RisSearchInput(BaseModel):
    query: str
    application: str = "BrKons"
    title: str = ""
    federal_state: str = Field(default="", validation_alias=AliasChoices("federal_state", "bundesland"))
    date_from: str = ""
    date_to: str = ""
    page: int = 1


_PLANNER_SYSTEM_PROMPT = """You translate a legal research request into search parameters \
for the Austrian RIS (Rechtsinformationssystem des Bundes).

Application selection rules:
- BrKons: consolidated FEDERAL law (Bundesgesetze, Verordnungen des Bundes).
- LrKons: consolidated STATE law — Bauordnungen, Bautechnikgesetze, Garagengesetze and all other \
Landesgesetze live here; ALWAYS set `federal_state` for building-law questions.
- BgblAuth / LgblAuth: authentic gazettes — only when the user needs the legally binding promulgation.
- Begut / RegV: draft bills and government bills (legislation in progress).
- Vfgh / Vwgh / Justiz / Bvwg / Lvwg / Dsk: case law (constitutional, administrative, civil/criminal, \
federal administrative court, state administrative courts, data protection).
- Erlaesse: federal ministry decrees.

Search term rules:
- `suchworte` must be German legal terminology; strip filler words. Prefer the statutory term \
(e.g. "Stellplatzverpflichtung" not "Parkplätze vorgeschrieben").
- Use `titel` only when the user names a specific law ("Bauordnung für Wien", "Garagengesetz").
- Dates only when the request clearly constrains time (decision periods, version in force at a date).
- Keep `reasoning` to one short sentence."""


def _apply_org_llm_policy(llm):
    try:
        from agent.common import apply_model_override
        from agent.common import apply_org_credential
        from agent.common import apply_zdr_routing
        from agent.common.model_overrides import AgentGroup
    except ImportError:
        return llm
    try:
        return apply_model_override(apply_org_credential(llm), AgentGroup.DEEP_RESEARCH_ROUTER)
    except Exception:
        logger.warning("ris_search: could not apply org LLM policy to the planner", exc_info=True)
        return apply_zdr_routing(llm)


def _make_planner(llm):

    async def _plan(query: str, application: str, title: str, federal_state: str, date_from: str, date_to: str):
        structured = _apply_org_llm_policy(llm).with_structured_output(RisSearchPlan, method="json_schema", strict=True)
        request = (
            f"Research request: {query}\n"
            f"Caller suggestion — application: {application or '(none)'}, title: {title or '(none)'}, "
            f"federal_state: {federal_state or '(none)'}, date_from: {date_from or '(none)'}, "
            f"date_to: {date_to or '(none)'}\n"
            "Respect the caller suggestion unless it is clearly wrong for this request."
        )
        messages = [
            {"role": "system", "content": _PLANNER_SYSTEM_PROMPT},
            {"role": "user", "content": request},
        ]
        try:
            return await structured.ainvoke(messages)
        except ValidationError, OutputParserException:
            logger.warning("ris_search planner: invalid structured output, retrying once", exc_info=True)
            corrective = [
                *messages,
                {
                    "role": "user",
                    "content": (
                        "Your previous output was invalid JSON. Return ONLY a single valid "
                        "JSON object matching the schema."
                    ),
                },
            ]
            return await structured.ainvoke(corrective)

    return _plan


def _cache_hits(raw: object) -> list[tuple[str | None, str | None, str | None]]:
    if not isinstance(raw, list):
        return []
    hits: list[tuple[str | None, str | None, str | None]] = []
    for entry in raw:
        if isinstance(entry, (list, tuple)) and len(entry) == 3:
            hits.append((entry[0], entry[1], entry[2]))
    return hits


def _capture_lane_hits(hits: list[tuple[str | None, str | None, str | None]]) -> None:
    if not _LANE_CAPTURE_AVAILABLE or _record_lane_hit is None:
        return
    for name, title, detail in hits:
        _record_lane_hit(name or "", title=title, detail=detail)


def _format_hit(index: int, hit: RisHit) -> str:
    lines = [f"--- Result {index} ---"]
    if hit.title:
        lines.append(f"Title: {hit.title}")
    if hit.application:
        lines.append(f"Application: {hit.application}")
    if hit.document_number:
        lines.append(f"Document number: {hit.document_number}")
    for label, value in hit.metadata.items():
        if hit.title and value == hit.title:
            continue
        lines.append(f"{label}: {value}")
    source_url = hit.citation_url or hit.fetch_url
    if source_url:
        lines.append(f"Source: {source_url}")
    if hit.fetch_url:
        lines.append(f"Full text at document number: {hit.document_number or hit.fetch_url}")
    if hit.full_law_url:
        lines.append(f"Entire consolidated law (all paragraphs): {hit.full_law_url}")
    return "\n".join(lines)


class RisSearchToolConfig(FunctionBaseConfig, name="ris_search"):
    base_url: str = Field(default=DEFAULT_BASE_URL, description="OGD-RIS API base URL")
    timeout: float = Field(default=30.0, description="HTTP timeout in seconds")
    page_size: int = Field(default=20, description="Documents per page (10, 20, 50, or 100)")
    max_results: int = Field(default=10, ge=1, description="Maximum number of results to format for the agent")
    planner_llm: LLMRef | None = Field(
        default=None,
        description=(
            "Optional LLM reference (llms: section) used to refine the query into structured "
            "RIS search parameters via strict structured outputs (response_format: json_schema). "
            "Falls back to the caller's raw arguments when unset or on planner failure. "
            "Must be an LLMRef (not a plain str) so NAT records the build-order "
            "dependency and instantiates the LLM before this tool is built."
        ),
    )
    catalog_shortcut: bool = Field(
        default=True,
        description=(
            "Return curated-catalog pointers directly when the query matches the catalog "
            "(no live search, no planner). Live search stays the fallback."
        ),
    )
    catalog_path: str = Field(
        default="",
        description=(
            "DEPRECATED (ADR-0025): path to a legacy flat catalog YAML. Empty = the norm registry "
            "(configs/norms/*/registry.yml, NORMS_DIR). Set only for legacy override."
        ),
    )


@register_function(config_type=RisSearchToolConfig)
async def ris_search(tool_config: RisSearchToolConfig, builder: Builder):
    if tool_config.page_size not in PAGE_SIZES:
        logger.warning("ris_search: page_size %s not in %s, using 20", tool_config.page_size, sorted(PAGE_SIZES))
        tool_config.page_size = 20

    client = RisClient(base_url=tool_config.base_url, timeout=tool_config.timeout)

    planner = None
    if tool_config.planner_llm:
        try:
            from agent.common import get_langchain_llm

            planner_llm_obj = await get_langchain_llm(builder, tool_config.planner_llm)
            planner = _make_planner(planner_llm_obj)
            logger.info("ris_search: query planner enabled (llm=%s)", tool_config.planner_llm)
        except Exception:
            logger.warning(
                "ris_search: could not resolve planner_llm '%s', continuing without a query planner",
                tool_config.planner_llm,
                exc_info=True,
            )

    async def _ris_search(
        query: str,
        application: str = "BrKons",
        title: str = "",
        federal_state: str = "",
        date_from: str = "",
        date_to: str = "",
        page: int = 1,
    ) -> str:
        from agent.common.retrieval_settings import get_retrieval_setting

        max_results = get_retrieval_setting("ris.max_results", tool_config.max_results)
        page_size = get_retrieval_setting("ris.page_size", tool_config.page_size)

        if (
            tool_config.catalog_shortcut
            and _CATALOG_AVAILABLE
            and not title
            and not date_from
            and not date_to
            and not _CASE_LAW_SIGNALS.search(query)
        ):
            catalog = load_registry(tool_config.catalog_path or None)
            if catalog is not None:
                matches = match_entries(catalog, query)
                if application != "BrKons":
                    matches = [m for m in matches if m.application == application]
                detected_federal_state = extract_federal_state(federal_state) or extract_federal_state(query)
                matches = focus_entries(matches, detected_federal_state)
                if matches:
                    shown = matches[:max_results]
                    _capture_lane_hits(
                        [
                            (
                                entry.citation_url or entry.source_url or entry.title,
                                entry.title or None,
                                entry.document_number or None,
                            )
                            for entry in shown
                        ]
                    )
                    lines = [
                        f"Curated RIS catalog match(es) for '{query}' - verified pointers, no live search performed:",
                        "",
                    ]
                    lines.extend(_format_catalog_entry(i, entry) + "\n" for i, entry in enumerate(shown, 1))
                    lines.append(
                        "These are verified pointers — an address each, not the text at it. This answer "
                        "comes from the curated catalog; refine the query (e.g. name a court, set an "
                        "explicit application, or a date) to force a live RIS search."
                    )
                    return "\n".join(lines)
        search_key = search_cache_key(
            "|".join([application, query, title, federal_state, date_from, date_to, str(page)])
        )
        cached_search = await cache_get_json(search_key)
        if isinstance(cached_search, dict) and isinstance(cached_search.get("text"), str) and cached_search["text"]:
            _capture_lane_hits(_cache_hits(cached_search.get("hits")))
            return cached_search["text"]
        if isinstance(cached_search, str) and cached_search:
            return cached_search

        effective = {
            "application": application,
            "query": query,
            "title": title,
            "federal_state": federal_state,
            "date_from": date_from,
            "date_to": date_to,
        }
        if planner is not None:
            try:
                plan = await _plan_with(planner, query, application, title, federal_state, date_from, date_to)
                if plan is not None and plan.suchworte.strip():
                    effective = {
                        "application": plan.application,
                        "query": plan.suchworte,
                        "title": plan.titel,
                        "federal_state": plan.federal_state,
                        "date_from": plan.date_from,
                        "date_to": plan.date_to,
                    }
                    logger.info(
                        "ris_search planner: application=%s suchworte='%s' federal_state='%s' (%s)",
                        plan.application,
                        plan.suchworte,
                        plan.federal_state,
                        plan.reasoning,
                    )
            except Exception:
                logger.warning("ris_search: planner failed, using caller arguments", exc_info=True)

        try:
            params = _build_search_params(
                effective["application"],
                effective["query"],
                effective["title"],
                effective["federal_state"],
                effective["date_from"],
                effective["date_to"],
            )
            result = await client.search(
                application=effective["application"],
                params=params,
                page=page,
                page_size=page_size,
            )
        except RisError as exc:
            return f"Error: RIS search failed - {exc}"
        except Exception as exc:  # a tool must always hand the agent a string
            logger.exception("ris_search failed")
            return f"Error: RIS search failed - {exc}"

        if not result.hits:
            return (
                f"No RIS documents found for query '{effective['query']}' in application "
                f"'{effective['application']}'. Try different German search terms, another "
                "application (e.g. LrKons for state building law with a federal_state), or drop filters."
            )

        shown = result.hits[:max_results]
        hit_triples = [
            (
                hit.citation_url or hit.fetch_url or hit.title,
                hit.title or None,
                hit.document_number or None,
            )
            for hit in shown
        ]
        _capture_lane_hits(hit_triples)
        total_pages = max(1, -(-result.total // result.page_size)) if result.total else 1
        lines = [
            f"Found {result.total or len(shown)} RIS document(s) "
            f"(page {result.page} of {total_pages}, showing {len(shown)}):",
            "",
        ]
        lines.extend(_format_hit(i, hit) + "\n" for i, hit in enumerate(shown, 1))
        if effective["application"] in _KONSOLIDIERT_APPLICATIONS:
            lines.append(_KONSOLIDIERT_NOTE)
        lines.append(
            "These are references. A document's own text lives at its Source URL, and the complete "
            "text of a law (all paragraphs) at its 'Entire consolidated law' URL."
        )
        output = "\n".join(lines)
        await cache_set_json(search_key, {"text": output, "hits": hit_triples}, ris_cache_ttl_seconds())
        return output

    try:
        yield FunctionInfo.from_fn(
            _ris_search,
            description=descriptions.SEARCH_DESCRIPTION,
            input_schema=RisSearchInput,
        )
    finally:
        await client.aclose()


async def _plan_with(planner, query, application, title, federal_state, date_from, date_to) -> RisSearchPlan | None:
    with one_shot_calls():
        return await planner(query, application, title, federal_state, date_from, date_to)


def _format_catalog_entry(index: int, entry: NormEntry) -> str:
    lines = [f"--- Catalog match {index} ---"]
    lines.append(f"Title: {entry.title}")
    if entry.federal_state:
        lines.append(f"Bundesland: {entry.federal_state}")
    if entry.is_ris:
        lines.append(f"Application: {entry.application}")
        lines.append(f"Document number: {entry.document_number}")
        if entry.citation_url:
            lines.append(f"Source: {entry.citation_url}")
        if entry.full_law_url:
            lines.append(f"Entire consolidated law (all paragraphs): {entry.full_law_url}")
    elif entry.source_url:
        lines.append(f"Not in RIS - web source: {entry.source_url}")
    else:
        lines.append("Not in RIS - no accessible full text (reference only, say so openly)")
    if entry.relevance:
        lines.append(f"Relevance: {entry.relevance}")
    if entry.binding_note:
        lines.append(f"Rechtlicher Hinweis: {entry.binding_note}")
    return "\n".join(lines)


class RisCatalogLookupToolConfig(FunctionBaseConfig, name="ris_catalog_lookup"):
    catalog_path: str = Field(
        default="",
        description=(
            "DEPRECATED (ADR-0025): path to a legacy flat catalog YAML. Empty = the norm registry "
            "(configs/norms/*/registry.yml, NORMS_DIR). Set only for legacy override."
        ),
    )
    max_matches: int = Field(default=5, ge=1, description="Maximum catalog entries returned per lookup")


@register_function(config_type=RisCatalogLookupToolConfig)
async def ris_catalog_lookup(tool_config: RisCatalogLookupToolConfig, builder: Builder):
    catalog_path = tool_config.catalog_path or None

    async def _ris_catalog_lookup(topic: str) -> str:
        if not _CATALOG_AVAILABLE:
            return "Error: RIS catalog lookup unavailable - catalog module not importable. Use ris_search."
        catalog = load_registry(catalog_path)
        if catalog is None:
            return (
                "Error: RIS catalog unavailable (file missing or invalid) - use ris_search (live RIS search) instead."
            )
        matches = focus_entries(match_entries(catalog, topic), extract_federal_state(topic))
        from agent.common.retrieval_settings import get_retrieval_setting

        matches = matches[: get_retrieval_setting("ris_catalog.max_matches", tool_config.max_matches)]
        _capture_lane_hits(
            [
                (
                    entry.citation_url or entry.source_url or entry.title,
                    entry.title or None,
                    entry.document_number or None,
                )
                for entry in matches
            ]
        )
        if not matches:
            return (
                f"No curated RIS catalog entry matches '{topic}'. The catalog covers only the core "
                "building-relevant norms (Bauordnungen, Bautechnik, adjacent federal law) - use "
                "ris_search (live RIS search) for anything else."
            )
        lines = [f"Curated RIS catalog: {len(matches)} verified match(es) for '{topic}':", ""]
        for i, entry in enumerate(matches, 1):
            lines.append(_format_catalog_entry(i, entry) + "\n")
        lines.append(
            "These are verified pointers - an address each, not the text at it. They were checked "
            "by a person, so no live RIS search is needed to find these norms."
        )
        return "\n".join(lines)

    yield FunctionInfo.from_fn(
        _ris_catalog_lookup,
        description=descriptions.CATALOG_LOOKUP_DESCRIPTION,
    )


class RisFetchDocumentToolConfig(FunctionBaseConfig, name="ris_fetch_document"):
    timeout: float = Field(default=60.0, description="HTTP timeout in seconds")
    max_chars: int = Field(
        default=40_000,
        ge=1_000,
        description="Maximum characters of document text returned to the agent (full text is still ingested)",
    )
    ingest_into_knowledge: bool = Field(
        default=True,
        description=(
            "Ingest fetched documents into the per-session knowledge collection so "
            "knowledge_search can retrieve and cite them afterwards"
        ),
    )
    cache_ttl_seconds: float = Field(default=3600.0, description="How long fetched documents are cached in memory")


_RIS_TITLE_PREFIX_RE = re.compile(r"^\s*RIS\s*[-–—:]+\s*", re.IGNORECASE)
_RIS_TITLE_REVISION_RE = re.compile(r"[,;]?\s*Fassung\s+vom\s+[\d.]+\s*$", re.IGNORECASE)

_RIS_NAME_TITLE_CHARS = 60


_RIS_URL_ID_PARAMS = ("dokumentnummer", "gesetzesnummer")
_RIS_DOCUMENT_PATH_RE = re.compile(r"/Dokumente/[^/]+/([^/]+)/", re.IGNORECASE)


def _document_anchor(reference: str) -> str:
    ref = (reference or "").strip()
    if ref.lower().startswith(("http://", "https://")):
        try:
            parsed = urlparse(ref)
        except ValueError:
            return ""
        query = {key.lower(): values for key, values in parse_qs(parsed.query).items()}
        ref = ""
        for param in _RIS_URL_ID_PARAMS:
            value = next((v.strip() for v in query.get(param, []) if v.strip()), "")
            if value:
                ref = value
                break
        else:
            path_match = _RIS_DOCUMENT_PATH_RE.search(parsed.path)
            ref = path_match.group(1) if path_match else ""
    return re.sub(r"[^\w.\-]+", "", ref)


def _safe_document_name(reference: str, title: str) -> str:
    base = _RIS_TITLE_REVISION_RE.sub("", _RIS_TITLE_PREFIX_RE.sub("", title or ""))
    base = re.sub(r"[^\w.\- ]+", "_", base).strip("_ ").replace(" ", "_")
    base = re.sub(r"[._\-]+$", "", base[:_RIS_NAME_TITLE_CHARS])

    parts = [part for part in (base, _document_anchor(reference)) if part]
    return f"RIS_{'_'.join(parts) or 'Dokument'}.txt"


def _resolve_session_collection() -> str | None:
    from agent.knowledge.base import SESSION_COLLECTION_PREFIX
    from nat.plugin_api import Context

    try:
        ctx = Context.get()
        session_id = ctx.conversation_id if ctx else None
    except Exception:
        return None
    if not session_id:
        return None
    if session_id.startswith(SESSION_COLLECTION_PREFIX):
        return session_id
    return f"{SESSION_COLLECTION_PREFIX}{session_id}"


def _ingest_document_sync(text: str, file_name: str, source_url: str) -> str | None:
    from agent.knowledge.factory import get_active_ingestor

    ingestor = get_active_ingestor()
    if ingestor is None:
        logger.debug("ris_fetch_document: no active ingestor, skipping ingestion")
        return None

    collection = _resolve_session_collection()
    if not collection:
        logger.debug("ris_fetch_document: no session collection, skipping ingestion")
        return None

    staging_dir = tempfile.mkdtemp(prefix="ris_adapter_")
    file_path = os.path.join(staging_dir, file_name)
    with open(file_path, "w", encoding="utf-8") as handle:
        handle.write(f"Source: {source_url}\n\n{text}")

    ingestor.submit_job([file_path], collection)
    logger.info("ris_fetch_document: submitted '%s' for ingestion into '%s'", file_name, collection)
    return file_name


def _legal_status_note(url: str) -> str | None:
    if "GeltendeFassung" in url or "/Bundesnormen/" in url or "/Landesnormen/" in url:
        return _KONSOLIDIERT_NOTE
    return None


@register_function(config_type=RisFetchDocumentToolConfig)
async def ris_fetch_document(tool_config: RisFetchDocumentToolConfig, builder: Builder):
    client = RisClient(timeout=tool_config.timeout, cache_ttl_seconds=tool_config.cache_ttl_seconds)

    async def _ris_fetch_document(reference: str, application: str = "") -> str:
        reference = (reference or "").strip()
        if not reference:
            return "Error: RIS document fetch failed - provide a document number or RIS URL from ris_search."

        try:
            if reference.lower().startswith(("http://", "https://")):
                url = reference
            else:
                url = build_document_url(reference, application)
            document = await fetch_document_cached(client, url)
        except RisError as exc:
            return f"Error: RIS document fetch failed - {exc}"
        except Exception as exc:  # a tool must always hand the agent a string
            logger.exception("ris_fetch_document failed")
            return f"Error: RIS document fetch failed - {exc}"

        ingested_name: str | None = None
        if tool_config.ingest_into_knowledge:
            file_name = _safe_document_name(reference, document.title)
            collection = _resolve_session_collection()
            marker = ingested_marker_key(collection, document.url) if collection else None
            already_ingested = bool(marker) and bool(await cache_get_json(marker))
            if already_ingested:
                ingested_name = file_name
            else:
                try:
                    ingested_name = await asyncio.to_thread(
                        _ingest_document_sync, document.text, file_name, document.url
                    )
                except Exception:
                    logger.warning("ris_fetch_document: knowledge ingestion failed (non-fatal)", exc_info=True)
                if ingested_name and marker:
                    await cache_set_json(marker, True, ris_cache_ttl_seconds())

        header = [f"Source: {document.url}"]
        if document.title:
            header.append(f"Title: {document.title}")
        header.append(f"Retrieved: {datetime.now(UTC).date().isoformat()}")
        status_note = _legal_status_note(document.url)
        if status_note:
            header.append(status_note)
        header.append("Retrieved from RIS (Rechtsinformationssystem des Bundes). Full document text follows.")

        text = document.text
        footer: list[str] = []
        if len(text) > tool_config.max_chars:
            total = len(text)
            text = text[: tool_config.max_chars]
            footer.append(f"[Document truncated: showing {tool_config.max_chars:,} of {total:,} characters.]")
        if ingested_name:
            footer.append(
                f'[The complete document was added to the knowledge base as "{ingested_name}" — '
                "use knowledge_search to query specific sections.]"
            )

        parts = ["\n".join(header), "", text]
        if footer:
            parts.extend(["", "\n".join(footer)])
        _capture_lane_hits([(document.url, document.title or None, None)])
        return "\n".join(parts)

    try:
        yield FunctionInfo.from_fn(
            _ris_fetch_document,
            description=descriptions.FETCH_DOCUMENT_DESCRIPTION,
        )
    finally:
        await client.aclose()
