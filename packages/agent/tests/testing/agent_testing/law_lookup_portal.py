"""A searchable statute portal of the synthetic country XA, and a law lookup bound to it for a whole test.

The parity rig (``law_lookup_parity``) holds the lookup to what the RIS tool
returned for recorded calls; this module is what the lookup's own behaviour
suites drive it through. Same seams: the network edge is the rig's
:class:`Upstream` (every request logged, an unknown one a 404) and the two
model calls are scripted. What it adds is what a behaviour test needs and a
parity case does not: a source with a live search, a version window and a
territory filter that names no real country; scripted model calls that record
whether they were made; a catalog the test chooses; and one bound tool for
several calls, so a repeat can be measured against the shared cache.

XA's portal is a record (:data:`XA_STATUTES`) on a protocol and a format the
platform already speaks (``rest`` + the OGD JSON engine): two provinces
(Northmark, Southmark), a national and a regional statute collection, case
law, a version date parameter, and documents placed by a number prefix. Its
search answers are built by :func:`search_answer` in that format's shape.
"""

from __future__ import annotations

import contextlib
import json
from collections.abc import AsyncIterator
from collections.abc import Callable
from dataclasses import dataclass
from dataclasses import field
from typing import Any
from unittest.mock import MagicMock
from unittest.mock import patch

import httpx

from agent_testing.law_lookup_parity import Upstream
from agent_testing.law_lookup_parity import _capturing_hits
from agent_testing.law_lookup_parity import _probe_config
from agent_testing.law_lookup_parity import _reset_shared_cache
from agent_testing.law_lookup_parity import _turn_carrying

API = "api.statutes.xa.example"
DOCS = "law.statutes.xa.example"
SEARCH_BASE = f"https://{API}/v1"
#: The whole consolidated laws, the documents a statute hit's provisions are cut from.
CODE_URL = f"https://{DOCS}/consolidated/building-code"
REGIONAL_CODE_URL = f"https://{DOCS}/consolidated/southmark-building-code"
#: The repository record the bound tool falls back to (and describes itself by), as the rig binds it.
FALLBACK_SOURCE = "at-ris"

XA_STATUTES: dict[str, Any] = {
    "id": "xa-statutes",
    "title": "Statute Portal of Xanadu",
    "territory": "XA",
    "protocol": "rest",
    "format": "ris_xml",
    "hosts": [API, DOCS],
    "data_flow": "public_only",
    "terms": {"url": f"https://{DOCS}/terms", "licence": "public_open", "checked": "2026-11-01"},
    "access": {
        "base_url": SEARCH_BASE,
        "operations": {
            "search": {
                "path": "{controller[application]}",
                "params": [
                    {"name": "collection", "value": "{application}"},
                    {"name": "per_page", "value": "{page_size}"},
                    {"name": "page", "value": "{page}"},
                    {"name": "q", "value": "{query}"},
                    {"name": "title", "value": "{title}"},
                    {"name": "{region[region]}", "value": "true", "when": {"application": ["Regional"]}},
                    {"name": "{date_from_param[application]}", "value": "{date_from}"},
                    {"name": "section", "value": "{provision}"},
                ],
            },
            "document": {"base_url": f"https://{DOCS}", "path": "documents/{segment}/{reference}.html"},
        },
        "tables": {
            "controller": {"values": {"National": "national", "Regional": "regional", "Courts": "courts"}},
            "region": {
                "normalize": "fold",
                "values": {"northmark": "Region.InNorthmark", "southmark": "Region.InSouthmark"},
            },
            "date_from_param": {"values": {"National": "Version.On", "Courts": "DecidedFrom"}},
            "document_prefix": {"values": {"XAN": "national", "XAC": "courts"}},
        },
    },
    "engine": {"content_selector": "#content"},
    "lookup": {
        "language": "en",
        "search": "search",
        "document": "document",
        "locus": {
            "units": [
                {"sign": "§", "forms": ["§"], "repeatable": True, "word": False},
                {"sign": "Art", "forms": ["Article", "Art"], "dot": True},
            ],
            "subsection": ["para", "paragraph"],
            "conjunctions": ["and"],
            "range_words": ["to"],
            "see_also": ["see"],
        },
        "collections": [
            {"id": "National", "kind": "statute", "level": "national", "consolidated": True},
            {"id": "Regional", "kind": "statute", "level": "subdivision", "consolidated": True},
            {"id": "Courts", "kind": "case_law"},
        ],
        "territory": {
            "argument": "region",
            "table": "region",
            "names": {"XA-N": "Northmark", "XA-S": "Southmark"},
            "choices": ["Northmark", "Southmark"],
        },
        "case_law_signals": ["judgment", "ruling"],
        "unplaced_collection": "cons",
        "wording": {
            "source": "Statutes",
            "subdivision": "province",
            "consolidated_note": "Consolidated text, not the authentic promulgation.",
            "example_territory": "Northmark",
            "example_work": "Building Code",
            "language": "English",
        },
        "namespace": "xa",
        "consolidated_urls": ["/consolidated/"],
        "reference": {"argument": "reference", "prefix_table": "document_prefix", "prefix_argument": "segment"},
    },
}

BUILDING_CODE = """Building Code of Xanadu

Permit application
§ 63. (1) A permit application carries:
a) proof of ownership,
b) the drawings in three copies.
(2) The drawings are signed by a licensed architect.
(3) The authority may ask for further documents.

Hearing
§ 64. (1) A hearing is held on every permit application.
(2) The neighbours are invited.

Building height
§ 75. (1) The building height follows from the building class.
(2) In building class I no building is higher than 9 m.
"""

REGIONAL_CODE = """Southmark Building Code

Parking
§ 60. (1) Every new building provides parking spaces.
(2) Their number follows from the zoning.
"""


def page(title: str, text: str) -> dict[str, str]:
    """A document page in the portal's shape: the law's lines inside ``#content``, one per line.

    Line breaks, not one ``<p>`` per line: the engine puts a blank line between paragraphs, and a heading
    a blank line above its ``§ 63.`` is not read as its heading (by the RIS tool neither: the parity
    golden's indexes carry none). The suites ported here assert headings on the text shape the RIS tool's
    fake client handed it, so the page converts to exactly that text.
    """
    paragraphs = "<br>".join(text.strip().splitlines())
    body = (
        f"<!DOCTYPE html><html><head><title>{title}</title></head><body>"
        f'<div id="nav">Skip to content</div><div id="content">\n{paragraphs}\n</div></body></html>'
    )
    return {"content_type": "text/html; charset=utf-8", "body": body}


def hit(
    number: str,
    title: str,
    *,
    collection: str = "National",
    url: str = "",
    whole_law: str = "",
    region: str = "",
    since: str = "",
    until: str = "",
    provision: str = "",
) -> dict[str, Any]:
    """One search hit in the format's shape; its field names are the format's (``engines.ris_xml``)."""
    url = url or f"https://{DOCS}/documents/national/{number}.html"
    fields = {
        "Kurztitel": title,
        "ArtikelParagraphAnlage": provision,
        "Bundesland": region,
        "Inkrafttretensdatum": since,
        "Ausserkrafttretensdatum": until,
        "GesamteRechtsvorschriftUrl": whole_law,
    }
    return {
        "Data": {
            "Metadaten": {
                "Technisch": {"ID": number, "Applikation": collection},
                "Allgemein": {"DokumentUrl": url},
                "Fields": {key: value for key, value in fields.items() if value},
            },
            "Dokumentliste": {"ContentReference": {"Urls": {"ContentUrl": [{"DataType": "Html", "Url": url}]}}},
        }
    }


def search_answer(*hits: dict[str, Any], error: str = "") -> dict[str, str]:
    """A search answer holding ``hits``, or the format's own refusal (``error``)."""
    if error:
        payload: dict[str, Any] = {"OgdSearchResult": {"Error": {"Applikation": "National", "Message": error}}}
    else:
        payload = {
            "OgdSearchResult": {
                "OgdDocumentResults": {"Hits": {"#text": str(len(hits))}, "OgdDocumentReference": list(hits)}
            }
        }
    return {"content_type": "application/json", "body": json.dumps(payload)}


@dataclass
class Portal(Upstream):
    """The rig's recorded upstream, plus one search answer for every search the lookup sends.

    The search's query string is the lookup's to build (and :attr:`searches` lets a test read it); a
    document is answered only at its exact URL, so a fetch the lookup was not meant to make is a 404.
    """

    responses: dict[str, dict[str, str]] = field(default_factory=dict)
    search: dict[str, str] = field(default_factory=search_answer)
    #: When set, the answer to each search by its query parameters (else :attr:`search`, whatever was asked).
    answer: Callable[[dict[str, str]], dict[str, str]] | None = None
    searches: list[dict[str, str]] = field(default_factory=list)

    @classmethod
    def with_codes(cls) -> Portal:
        """The national and the Southmark building code, at their whole-law URLs."""
        return cls(
            responses={
                CODE_URL: page("Building Code", BUILDING_CODE),
                REGIONAL_CODE_URL: page("Southmark Building Code", REGIONAL_CODE),
            }
        )

    def set_text(self, url: str, title: str, text: str) -> None:
        self.responses[url] = page(title, text)

    @property
    def documents_requested(self) -> list[str]:
        return [url for url in self.requested if not url.startswith(SEARCH_BASE)]

    def transport(self) -> httpx.MockTransport:
        documents = super().transport()

        def handler(request: httpx.Request) -> httpx.Response:
            if str(request.url).startswith(SEARCH_BASE):
                self.requested.append(str(request.url))
                params = dict(request.url.params)
                self.searches.append(params)
                answer = self.answer(params) if self.answer else self.search
                return httpx.Response(
                    int(answer.get("status", "200")),
                    headers={"content-type": answer["content_type"]},
                    content=answer["body"].encode("utf-8"),
                )
            return documents.handle_request(request)

        return httpx.MockTransport(handler)


class Recorder:
    """A scripted model call that records every call it gets, so a test can assert it got none."""

    def __init__(self, answer: Any) -> None:
        self.answer = answer
        self.calls: list[tuple] = []

    async def __call__(self, *args):
        self.calls.append(args)
        return self.answer


def xa_law():
    """XA's portal as the lookup reads it."""
    from public_sources.source import parse_released_source

    from agent.knowledge.law_lookup.source import law_source_from_record

    return law_source_from_record(parse_released_source(dict(XA_STATUTES)))


def planner(*, collection: str = "National", terms: str = "building", title: str = "", territory: str = ""):
    """The search planner, scripted: the plan it answers with."""
    from agent.knowledge.law_lookup.planner import plan_model

    return Recorder(plan_model(xa_law())(collection=collection, terms=terms, title=title, territory=territory))


def picker(*sections: str) -> Recorder:
    """The provision picker, scripted: the provisions it names."""
    from agent.knowledge.law_lookup.picker import PassagePick
    from agent.knowledge.law_lookup.picker import PassagePlan

    return Recorder(PassagePlan(picks=[PassagePick(section=section) for section in sections]))


def catalog_entry(**overrides):
    """One curated catalog entry, defaulted to the national building code (``agent.common.norm_registry``)."""
    from agent.common.norm_registry import NormEntry

    data = {
        "id": "xa-building-code",
        "title": "Building Code",
        "short": "BC",
        "application": "National",
        "document_number": "XAN00001",
        "citation_url": f"https://{DOCS}/eli/building-code",
        "full_law_url": CODE_URL,
        "federal_state": "",
        "topics": ["building code", "permit application"],
        "relevance": "The national building code",
        "verified_at": "2026-11-01",
    }
    data.update(overrides)
    return NormEntry(**data)


@dataclass
class Session:
    """One bound lookup: call it as often as the test needs; the shared cache lives as long as the session."""

    portal: Portal
    law: Any
    _fn: Any = None
    #: The bound tool as the agent runtime holds it (its description and its function).
    info: Any = None
    records: list[tuple] = field(default_factory=list)

    async def call(self, **args: str) -> str:
        return await self._fn.ainvoke(args, to_type=str)


@contextlib.asynccontextmanager
async def session(
    portal: Portal,
    *,
    planner_call: Any = None,
    picker_call: Any = None,
    catalog: list | None = None,
    record: dict[str, Any] | None = None,
) -> AsyncIterator[Session]:
    """The lookup bound under the turn that carries ``record`` (XA's portal by default), at the two edges.

    ``catalog`` is the norm catalog's entries; ``None`` is no catalog at all, so the repository's own
    never decides a test.
    """
    from public_sources.source import parse_released_source

    from agent.common.norm_registry import NormRegistry
    from agent.knowledge.law_lookup import LawLookupToolConfig
    from agent.knowledge.law_lookup import law_lookup
    from agent.knowledge.law_lookup.client import SourceClient
    from agent.knowledge.law_lookup.source import law_source_from_record
    from nat.builder.function import LambdaFunction  # noqa: TID251

    record = record or XA_STATUTES
    registry = NormRegistry(entries=list(catalog)) if catalog is not None else None
    transport = portal.transport()

    async def _resolve(*_args):
        return lambda _law: (planner_call, picker_call)

    def _client(law, **kwargs):
        return SourceClient(law, **kwargs, transport=transport, max_retries=1)

    config = LawLookupToolConfig(source=FALLBACK_SOURCE, tool_name="law_lookup", ingest_into_knowledge=False)
    _reset_shared_cache()
    with contextlib.ExitStack() as stack:
        stack.enter_context(patch("agent.knowledge.law_lookup.tool.SourceClient", _client))
        stack.enter_context(patch("agent.knowledge.law_lookup.tool._resolve_llms", _resolve))
        stack.enter_context(patch("agent.common.norm_registry.load_registry", lambda path=None: registry))
        stack.enter_context(_turn_carrying(record))
        records = stack.enter_context(_capturing_hits("agent.knowledge.law_lookup.render"))
        async with law_lookup(config, MagicMock()) as info:
            bound = Session(portal=portal, law=law_source_from_record(parse_released_source(dict(record))))
            bound._fn = LambdaFunction.from_info(config=_probe_config(), info=info)
            bound.records = records
            bound.info = info
            yield bound


def body_of(output: str, index: int = 1) -> str:
    """The passage body of one ``--- Result N ---`` block, as the citation reader sees it."""
    from agent.citations.grounding_text import _extract_kl_chunk_bodies

    return _extract_kl_chunk_bodies(output)[index - 1]
