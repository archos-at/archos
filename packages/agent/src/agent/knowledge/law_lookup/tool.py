"""The agent-runtime function: config, description, and the stages in order.

Nothing is decided here. Every bound, every fallback and every sentence the
model reads lives in the stage that owns it, and every word of the source in
its record; this module says what the tool takes and which stage runs next.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from pydantic import Field

from agent.common.action_outcome import ActionOutcome
from agent.common.action_rows import ActionRow
from agent.knowledge.law_lookup.address import parse_address
from agent.knowledge.law_lookup.as_of import as_of_error
from agent.knowledge.law_lookup.as_of import reads_today
from agent.knowledge.law_lookup.as_of import today
from agent.knowledge.law_lookup.as_of import today_note
from agent.knowledge.law_lookup.cache import ttl_seconds
from agent.knowledge.law_lookup.candidates import Search
from agent.knowledge.law_lookup.candidates import collect_candidates
from agent.knowledge.law_lookup.client import SourceClient
from agent.knowledge.law_lookup.description import describe
from agent.knowledge.law_lookup.extract import select_passages
from agent.knowledge.law_lookup.fetch import fetch_documents
from agent.knowledge.law_lookup.ingest import ingest_documents
from agent.knowledge.law_lookup.miss import miss_message
from agent.knowledge.law_lookup.passages import build_passages
from agent.knowledge.law_lookup.picker import make_picker
from agent.knowledge.law_lookup.planner import make_planner
from agent.knowledge.law_lookup.render import format_passages
from agent.knowledge.law_lookup.render import unread_versions
from agent.knowledge.law_lookup.source import LawSource
from agent.knowledge.law_lookup.source import law_source
from agent.knowledge.law_lookup.telemetry import capture_passages
from agent.knowledge.law_lookup.telemetry import emit_lookup_span
from agent.knowledge.law_lookup.trace import LookupTrace
from agent.knowledge.law_lookup.turn_source import WITHHELD_PREFIX
from agent.knowledge.law_lookup.turn_source import dropped_note
from agent.knowledge.law_lookup.turn_source import note_fallback
from agent.knowledge.law_lookup.turn_source import note_unreadable
from agent.knowledge.law_lookup.turn_source import released_law_source
from agent.knowledge.law_lookup.turn_source import turn_source
from agent.knowledge.law_lookup.turn_source import withheld_note
from nat.plugin_api import Builder
from nat.plugin_api import FunctionBaseConfig
from nat.plugin_api import FunctionInfo
from nat.plugin_api import LLMRef
from nat.plugin_api import register_function

logger = logging.getLogger(__name__)

#: Sources (revisions) one bound tool keeps clients for; the oldest is let go past it.
_MAX_BOUND = 16


class LawLookupToolConfig(FunctionBaseConfig, name="law_lookup"):
    """One law source, read through its record: question in, citable passages out."""

    source: str = Field(
        description=(
            "The repository record (configs/sources/, by id) read when no released record reaches the turn; "
            "it must carry a `lookup` block. Named by the binding, never by code."
        ),
    )
    tool_name: str = Field(
        default="law_lookup",
        description=(
            "The name this tool is bound under, as its errors, its sources step and its retrieval span state it. "
            "Set it to the binding's name: the citation parser and the eval columns key on it."
        ),
    )
    base_url: str = Field(default="", description="The search API's base URL; empty: the record's")
    timeout: float = Field(default=60.0, description="HTTP timeout in seconds")
    planner_llm: LLMRef | None = Field(
        default=None,
        description=(
            "LLM used BOTH to plan a live search and to pick the answering provisions out of a fetched law's "
            "headings (strict structured outputs, json_schema). Neither call happens when the catalog answers "
            "and the caller named a provision. Must be an LLMRef so NAT records the build-order dependency."
        ),
    )
    catalog_path: str = Field(
        default="",
        description="DEPRECATED (ADR-0025): a legacy flat catalog YAML. Empty = the norm registry (configs/norms).",
    )
    ingest_into_knowledge: bool = Field(
        default=True,
        description=(
            "Ingest each fetched document's FULL text into the per-session knowledge collection, so "
            "read_passage can reopen another provision of it later in the conversation"
        ),
    )
    cache_ttl_days: int = Field(default=7, description="How long fetched documents stay in the shared cache")


@register_function(config_type=LawLookupToolConfig)
async def law_lookup(tool_config: LawLookupToolConfig, builder: Builder):
    fallback = law_source(tool_config.source)
    lookup = _Lookup(tool_config, await _resolve_llms(tool_config, builder))

    async def _law_lookup(
        question: str,
        conclusion: str = "",
        jurisdiction: str = "",
        instrument: str = "",
        application: str = "",
        as_of: str = "",
    ) -> str:
        # `conclusion` is deliberately unread: it is the derivation's checkpoint slot, read
        # off the CALL; a tool that acted on it would turn a transparency field into a control channel.
        return await lookup.call(question, jurisdiction, instrument, application, as_of)

    try:
        yield FunctionInfo.from_fn(_law_lookup, description=describe(fallback))
    finally:
        await lookup.aclose()


@dataclass
class _Bound:
    """One source as one call reads it: the source, its client, its search, its picker."""

    law: LawSource
    client: object
    search: Search
    picker: object
    #: ``turn`` (the released record the turn carries) or ``repository`` (the fallback file), and the revision.
    origin: str = ""
    revision: str = ""


class _Lookup:
    """One bound tool: its config, and each source it has read, built once per revision."""

    def __init__(self, config: LawLookupToolConfig, llms) -> None:
        self.config, self.llms = config, llms
        self.ttl = ttl_seconds(config.cache_ttl_days)
        self.bound: dict[str, _Bound] = {}
        #: Let go of past the cap, closed with the tool.
        self.retired: list[_Bound] = []

    def _bind(self, key: str, law: LawSource, origin: str, revision: str) -> _Bound:
        if key not in self.bound:
            if len(self.bound) >= _MAX_BOUND:  # revisions come and go; a process keeps a few
                self.retired.append(self.bound.pop(next(iter(self.bound))))
            client = SourceClient(law, base_url=self.config.base_url, timeout=self.config.timeout)
            planner, picker = self.llms(law) if self.llms else (None, None)
            search = Search(law=law, client=client, planner=planner, catalog_path=self.config.catalog_path)
            self.bound[key] = _Bound(
                law=law, client=client, search=search, picker=picker, origin=origin, revision=revision
            )
        return self.bound[key]

    def for_turn(self) -> tuple[_Bound, str]:
        """The source this turn reads, and a note when the turn's own source could not be carried or read."""
        chosen = turn_source()
        if chosen is not None:
            try:
                law = released_law_source(chosen)
            except ValueError:  # SourceError, LawSourceError: a record this build cannot read
                note_unreadable(chosen.key, chosen.revision_id)
            else:
                return self._bind(f"turn:{chosen.revision_id}", law, "turn", chosen.revision_id), ""
        law = law_source(self.config.source)
        note_fallback(law)
        bound = self._bind(f"repository:{self.config.source}", law, "repository", "")
        return bound, withheld_note(law) or dropped_note(law)

    async def aclose(self) -> None:
        for bound in [*self.bound.values(), *self.retired]:
            await bound.client.aclose()

    async def call(self, question: str, jurisdiction: str, instrument: str, application: str, as_of: str) -> str:
        bound, note = self.for_turn()
        if note.startswith(WITHHELD_PREFIX):
            return note
        question = (question or "").strip()
        if not question:
            language = bound.law.wording.language or bound.law.lookup.language
            name = self.config.tool_name
            return f"Error: {name} needs a question — the legal question in {language}, not a search string."
        as_of = (as_of or "").strip()
        if error := as_of_error(as_of):
            return error
        outcome = ActionOutcome()
        row = ActionRow("law", query=question, target=(instrument or "").strip())
        try:
            result = await self._answer(bound, question, jurisdiction, instrument, application, outcome, as_of, note)
        except BaseException:
            row.finish("error")
            raise
        outcome.settle(row)
        return result

    async def _answer(
        self,
        bound: _Bound,
        question,
        jurisdiction,
        instrument,
        application,
        outcome: ActionOutcome,
        as_of: str,
        note: str,
    ) -> str:
        law, tool = bound.law, self.config.tool_name
        address = parse_address(question, instrument, jurisdiction, law)
        # Today or later is today's text, by the usual path; only a past day reads version documents (ADR-0171).
        now = today()
        current = bool(as_of) and reads_today(as_of, now)
        trace = LookupTrace(
            collection=application, as_of="" if current else as_of, as_of_today=as_of if current else ""
        )
        trace.source, trace.source_revision, trace.source_origin = law.source.id, bound.revision, bound.origin
        trace.candidates = await collect_candidates(bound.search, question, address, trace, trace.as_of)
        documents = await fetch_documents(bound.client, trace.candidates, trace, self.ttl)
        selections = await select_passages(bound.picker, question, address, documents, trace, law)
        passages = build_passages(selections, address, law)
        ingested = await ingest_documents(documents, self.config.ingest_into_knowledge, law, self.ttl)
        emit_lookup_span(question, address, trace, passages, tool)
        outcome.hits = len(passages)
        # The call's notes go INSIDE the rendered block: its records are filed under the text it renders, and a
        # line put before it afterwards loses them (``grounding_block.get_grounding_block``). A miss files none.
        notes = [line for line in (note, today_note(as_of, now) if current else "") if line]
        if not passages:
            return "\n".join([*notes, miss_message(question, address, trace, law)])
        capture_passages(passages)
        notes += unread_versions(trace, law)
        return format_passages(passages, ingested, address, law, tool, notes)


async def _resolve_llms(tool_config: LawLookupToolConfig, builder: Builder):
    """What builds a source's search planner and provision picker from the configured model, or None.

    One configured model serves both: they are the same kind of bounded
    structured-output call. A model that cannot be resolved is not fatal: the
    live search then uses the caller's own words and the picker only answers a
    named provision.
    """
    if not tool_config.planner_llm:
        return None
    try:
        from agent.common import get_langchain_llm

        llm = await get_langchain_llm(builder, tool_config.planner_llm)
    except Exception:  # noqa: BLE001
        logger.warning(
            "law_lookup: could not resolve planner_llm '%s'; the live search falls back to the caller's words "
            "and the picker to the named provision only",
            tool_config.planner_llm,
            exc_info=True,
        )
        return None
    return lambda law: (make_planner(llm, law), make_picker(llm, law))
