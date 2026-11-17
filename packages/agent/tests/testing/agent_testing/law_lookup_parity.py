from __future__ import annotations

import contextlib
import hashlib
import json
import os
from collections.abc import Callable
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock
from unittest.mock import patch

import httpx

FIXTURES = Path(__file__).resolve().parents[5] / "tests" / "fixtures" / "law_lookup"
UPSTREAM = FIXTURES / "upstream.json"
GOLDEN = FIXTURES / "golden.json"

TOOL_NAME = "law_lookup"
OLD_TOOL_NAME = "ris_lookup"


@dataclass(frozen=True)
class Plan:
    collection: str
    terms: str
    title: str = ""
    territory: str = ""


@dataclass(frozen=True)
class Case:
    id: str
    args: dict[str, str]
    plan: Plan | None = None
    picks: tuple[str, ...] | None = None
    note: str = ""


Q_GARAGE = "Was sagt § 50 Wiener Garagengesetz?"
_RIS_LAW = "https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage="
Q_BAU = "Welche Unterlagen sind dem Bauansuchen anzuschließen?"

CASES: tuple[Case, ...] = (
    Case("b5-question-only", {"question": Q_GARAGE}, note="scorecard B5 as asked"),
    Case("b5-instrument", {"question": Q_GARAGE, "instrument": "§ 50 Garagengesetz Wien"}),
    Case(
        "b5-jurisdiction",
        {"question": Q_GARAGE, "instrument": "§ 50 Wiener Garagengesetz 2008", "jurisdiction": "Wien"},
    ),
    Case("named-subsection", {"question": Q_BAU, "instrument": "§ 63 Abs 1 BO für Wien"}),
    Case(
        "short-title-off-catalog",
        {"question": Q_BAU, "instrument": "§ 63 Abs 1 BO Wien"},
        note="no catalog entry is called this",
    ),
    Case("missing-subsection", {"question": Q_BAU, "instrument": "§ 63 Abs 9 BO für Wien"}),
    Case("list", {"question": Q_BAU, "instrument": "§§ 63 und 75 BO für Wien"}),
    Case("range-with-gap", {"question": Q_BAU, "instrument": "§§ 63 bis 65 Bauordnung für Wien"}),
    Case("long-range", {"question": Q_BAU, "instrument": "§§ 60 bis 70 BO für Wien"}),
    Case("qualified-list", {"question": Q_BAU, "instrument": "§ 63 Abs 1 und 2 BO für Wien, siehe §§ 64 und 75"}),
    Case("bare-subsection-list", {"question": Q_BAU, "instrument": "Abs 2 und 3 BO für Wien"}),
    Case(
        "law-picker",
        {"question": "Wie hoch darf in Bauklasse I gebaut werden?", "instrument": "Bauordnung für Wien"},
        picks=("§ 75",),
    ),
    Case(
        "law-no-picker",
        {"question": "Wie hoch darf in Bauklasse I gebaut werden?", "instrument": "Bauordnung für Wien"},
    ),
    Case("land-in-question", {"question": "Wie viele Stellplätze verlangt die Tiroler Bauordnung?"}, picks=("§ 8",)),
    Case(
        "jurisdiction-only",
        {"question": "Was gilt für Stellplätze bei Neubauten?", "jurisdiction": "Tirol"},
        picks=("§ 8",),
    ),
    Case(
        "salzburg-list", {"question": "Was ist bewilligungsfrei?", "instrument": "§§ 2 bis 3 Baupolizeigesetz Salzburg"}
    ),
    Case("federal-act", {"question": "Was regelt das ASchG zu Arbeitsstätten?", "instrument": "§ 19 ASchG"}),
    Case("document-number", {"question": Q_GARAGE, "instrument": "LWI40010002"}),
    Case(
        "ris-url-hit",
        {"question": "Was sagt § 63 dazu?", "instrument": f"{_RIS_LAW}LrW&Gesetzesnummer=20000006"},
        note="a passage read from an address names no application",
    ),
    Case(
        "ris-url",
        {
            "question": Q_BAU,
            "instrument": "https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrW&Gesetzesnummer=20000006",
        },
    ),
    Case(
        "live-planned",
        {"question": "Welche Regeln gelten für Kleingärten in Wien?", "jurisdiction": "Wien"},
        plan=Plan("LrKons", "Kleingarten", territory="Wien"),
        picks=("§ 1",),
    ),
    Case(
        "live-unplanned",
        {
            "question": "Hundehaltegesetz Wien Leinenpflicht",
            "instrument": "§ 5 Hundehaltegesetz",
            "jurisdiction": "Wien",
        },
    ),
    Case(
        "case-law",
        {"question": "Erkenntnis des VwGH zur Abstandsfläche bei Dachgauben", "application": "Vwgh"},
        plan=Plan("Vwgh", "Abstandsfläche Dachgaube"),
    ),
    Case("as-of", {"question": Q_GARAGE, "instrument": "§ 50 Garagengesetz Wien", "as_of": "2023-06-01"}),
    Case("as-of-bad", {"question": Q_GARAGE, "as_of": "1.6.2023"}),
    Case("no-land", {"question": "Was sagt die Bauordnung zu Dachgauben?"}),
    Case("empty-question", {"question": "  "}),
)


@dataclass
class Upstream:
    responses: dict[str, dict[str, str]]
    requested: list[str] = field(default_factory=list)
    record: Callable[[str], dict[str, str] | None] | None = None

    @classmethod
    def load(cls) -> Upstream:
        data = json.loads(UPSTREAM.read_text(encoding="utf-8")) if UPSTREAM.exists() else {}
        return cls(responses=data.get("responses", {}))

    def save(self) -> None:
        UPSTREAM.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "$comment": (
                "Recorded exchanges for the law lookup's parity rig (agent_testing.law_lookup_parity). "
                "Search answers: data.bka.gv.at as served (recorded live). Document pages: RIS's page "
                "shape with law text written for the test, not RIS's text."
            ),
            "responses": dict(sorted(self.responses.items())),
        }
        UPSTREAM.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    def transport(self) -> httpx.MockTransport:
        def handler(request: httpx.Request) -> httpx.Response:
            url = str(request.url)
            self.requested.append(url)
            response = self.responses.get(url)
            if response is None and self.record is not None:
                response = self.record(url)
                if response is not None:
                    self.responses[url] = response
            if response is None:
                return httpx.Response(404, text=f"not recorded: {url}")
            return httpx.Response(
                int(response.get("status", "200")),
                headers={"content-type": response["content_type"]},
                content=response["body"].encode("utf-8"),
            )

        return httpx.MockTransport(handler)


@dataclass(frozen=True)
class Result:
    output: str
    requested: tuple[str, ...]
    records: tuple[tuple, ...] = ()

    def as_json(self) -> dict[str, Any]:
        return {"requested": list(self.requested), "output": self.output}


@contextlib.contextmanager
def _capturing_hits(module: str):
    from agent.common import grounding_block

    seen: list[tuple] = []

    def _render(block):
        seen.extend((hit.citation_key, hit.public_url, hit.revision, hit.work_id, hit.edition_id) for hit in block.hits)
        return grounding_block.render_grounding_block(block)

    with patch(f"{module}.render_grounding_block", _render):
        yield seen


def _reset_shared_cache() -> None:
    from agent.common.cache import reset_local_store

    reset_local_store()


async def run_ris_lookup(case: Case, upstream: Upstream) -> Result:
    from ris_adapter.client import RisClient
    from ris_adapter.lookup import RisLookupToolConfig
    from ris_adapter.lookup import ris_lookup
    from ris_adapter.lookup.picker import RisPassagePick
    from ris_adapter.lookup.picker import RisPassagePlan
    from ris_adapter.register import RisSearchPlan

    from nat.builder.function import LambdaFunction  # noqa: TID251

    planner = picker = None
    if case.plan is not None:
        plan = RisSearchPlan(
            application=case.plan.collection,
            suchworte=case.plan.terms,
            titel=case.plan.title,
            federal_state=case.plan.territory,
        )

        async def planner(*_args):
            return plan

    if case.picks is not None:
        picked = RisPassagePlan(picks=[RisPassagePick(section=s) for s in case.picks])

        async def picker(*_args):
            return picked

    async def _resolve(_config, _builder):
        return planner, picker

    transport = upstream.transport()

    def _client(**kwargs):
        return RisClient(**kwargs, transport=transport, max_retries=1)

    _reset_shared_cache()
    upstream.requested.clear()
    with contextlib.ExitStack() as stack:
        stack.enter_context(patch("ris_adapter.lookup.tool.RisClient", _client))
        stack.enter_context(patch("ris_adapter.lookup.tool._resolve_llms", _resolve))
        records = stack.enter_context(_capturing_hits("ris_adapter.lookup.render"))
        config = RisLookupToolConfig(ingest_into_knowledge=False)
        async with ris_lookup(config, MagicMock()) as info:
            fn = LambdaFunction.from_info(config=_probe_config(), info=info)
            output = await fn.ainvoke(case.args, to_type=str)
    output = output.replace(f"Error: {OLD_TOOL_NAME} ", f"Error: {TOOL_NAME} ")
    return Result(output=output, requested=tuple(upstream.requested), records=tuple(records))


RELEASED_KEY = "at-ris-ogd"


def released_record() -> dict[str, Any]:
    from public_sources.source import get_source

    raw = get_source("at-ris").model_dump(mode="json", exclude_none=True)
    raw.pop("fixtures")
    return {**raw, "id": RELEASED_KEY}


@contextlib.contextmanager
def _turn_carrying(record: dict[str, Any] | None, uses: tuple = ()):
    from agent.common.knowledge_context import KnowledgeContext
    from agent.common.knowledge_context import LawSource as TurnSource
    from agent.common.knowledge_context import get_turn_knowledge_context
    from agent.common.knowledge_context import set_turn_knowledge_context

    previous = get_turn_knowledge_context()
    if record is not None:
        revision = hashlib.sha256(json.dumps(record, sort_keys=True).encode()).hexdigest()[:16]
        country = record["territory"][:2]
        source = TurnSource(key=record["id"], revision_id=revision, country=country, config=record)
        set_turn_knowledge_context(
            KnowledgeContext(
                gate="core",
                site_country=country,
                uses=uses,
                sources=(source,),
                retrieval_countries=frozenset({country}),
            )
        )
    try:
        yield
    finally:
        set_turn_knowledge_context(previous)


async def run_law_lookup_from_turn(case: Case, upstream: Upstream) -> Result:
    return await run_law_lookup(case, upstream, turn_record=released_record())


async def run_law_lookup(
    case: Case, upstream: Upstream, turn_record: dict[str, Any] | None = None, uses: tuple = ()
) -> Result:
    from agent.knowledge.law_lookup import LawLookupToolConfig
    from agent.knowledge.law_lookup import law_lookup
    from agent.knowledge.law_lookup.client import SourceClient
    from agent.knowledge.law_lookup.picker import PassagePick
    from agent.knowledge.law_lookup.picker import PassagePlan
    from agent.knowledge.law_lookup.planner import plan_model
    from agent.knowledge.law_lookup.source import law_source
    from nat.builder.function import LambdaFunction  # noqa: TID251

    config = LawLookupToolConfig(source="at-ris", tool_name=TOOL_NAME, ingest_into_knowledge=False)
    planner = picker = None
    if case.plan is not None:
        plan = plan_model(law_source(config.source))(
            collection=case.plan.collection,
            terms=case.plan.terms,
            title=case.plan.title,
            territory=case.plan.territory,
        )

        async def planner(*_args):
            return plan

    if case.picks is not None:
        picked = PassagePlan(picks=[PassagePick(section=s) for s in case.picks])

        async def picker(*_args):
            return picked

    async def _resolve(*_args):
        return lambda _law: (planner, picker)

    transport = upstream.transport()

    def _client(law, **kwargs):
        return SourceClient(law, **kwargs, transport=transport, max_retries=1)

    _reset_shared_cache()
    upstream.requested.clear()
    with contextlib.ExitStack() as stack:
        stack.enter_context(patch("agent.knowledge.law_lookup.tool.SourceClient", _client))
        stack.enter_context(patch("agent.knowledge.law_lookup.tool._resolve_llms", _resolve))
        stack.enter_context(_turn_carrying(turn_record, uses))
        records = stack.enter_context(_capturing_hits("agent.knowledge.law_lookup.render"))
        async with law_lookup(config, MagicMock()) as info:
            fn = LambdaFunction.from_info(config=_probe_config(), info=info)
            output = await fn.ainvoke(case.args, to_type=str)
    return Result(output=output, requested=tuple(upstream.requested), records=tuple(records))


def _probe_config():
    from nat.plugin_api import FunctionBaseConfig

    class _Probe(FunctionBaseConfig, name="law_lookup_parity_probe"):
        pass

    return _Probe()


_PAGES: dict[str, tuple[str, str]] = {}


def _page(title: str, body: str) -> str:
    paragraphs = "\n".join(f"<p>{line}</p>" for line in body.strip().splitlines())
    return (
        '<!DOCTYPE html>\n<html lang="de"><head>'
        f"<title>RIS - {title} - Landesrecht konsolidiert, Fassung vom 11.11.2026</title></head><body>\n"
        '<div id="nav"><a href="#content" accesskey="0">Zum Inhalt (Accesskey 0)</a> Bundesrecht Landesrecht</div>\n'
        f'<div id="content">\n<h1>{title}</h1>\n{paragraphs}\n'
        '<span class="sr-only">Paragraph eins, Absatz eins</span>\n</div>\n'
        '<div id="footer">Impressum Datenschutz</div>\n</body></html>\n'
    )


def _synthetic_page(url: str) -> dict[str, str]:
    from agent_testing.law_lookup_texts import PAGES

    title, body = PAGES.get(url) or ("Rechtsvorschrift", PAGES["__default__"][1])
    return {"content_type": "text/html; charset=utf-8", "body": _page(title, body)}


def _record_live(url: str) -> dict[str, str] | None:
    host = httpx.URL(url).host
    if host == "data.bka.gv.at":
        response = httpx.get(url, timeout=30.0)
        return {
            "status": str(response.status_code),
            "content_type": response.headers.get("content-type", "application/json"),
            "body": response.text,
        }
    if host in ("www.ris.bka.gv.at", "ris.bka.gv.at"):
        return _synthetic_page(url)
    return None


async def record() -> dict[str, dict[str, Any]]:
    upstream = Upstream.load()
    upstream.record = _record_live
    golden: dict[str, dict[str, Any]] = {}
    for case in CASES:
        golden[case.id] = (await run_ris_lookup(case, upstream)).as_json()
    upstream.save()
    GOLDEN.write_text(json.dumps(golden, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return golden


if __name__ == "__main__":  # .venv/bin/python -m agent_testing.law_lookup_parity
    import asyncio

    os.environ.setdefault("NAT_LOG_LEVEL", "WARNING")
    result = asyncio.run(record())
    print(f"recorded {len(result)} cases into {GOLDEN}")
