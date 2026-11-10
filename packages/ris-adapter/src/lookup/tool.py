"""The agent-runtime function: config, description, and the stages in order.

Nothing is decided here. Every bound, every fallback and every sentence the
model reads lives in the stage that owns it; this module says what the tool is
called, what it takes, and which stage runs next.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from functools import cache
from typing import Any

from pydantic import BaseModel
from pydantic import Field
from pydantic import create_model
from pydantic.json_schema import SkipJsonSchema
from ris_adapter.client import DEFAULT_BASE_URL
from ris_adapter.client import RisClient
from ris_adapter.lookup.address import parse_address
from ris_adapter.lookup.as_of import AS_OF_REFUSED
from ris_adapter.lookup.as_of import as_of_allowed
from ris_adapter.lookup.as_of import as_of_error
from ris_adapter.lookup.candidates import collect_candidates
from ris_adapter.lookup.extract import select_passages
from ris_adapter.lookup.fetch import fetch_documents
from ris_adapter.lookup.ingest import ingest_documents
from ris_adapter.lookup.miss import miss_message
from ris_adapter.lookup.passages import build_passages
from ris_adapter.lookup.picker import make_picker
from ris_adapter.lookup.render import format_passages
from ris_adapter.lookup.telemetry import capture_passages
from ris_adapter.lookup.telemetry import emit_lookup_span
from ris_adapter.lookup.trace import LookupTrace
from ris_adapter.register import _make_planner

from agent.common.action_outcome import ActionOutcome
from agent.common.action_rows import ActionRow
from nat.plugin_api import Builder
from nat.plugin_api import FunctionBaseConfig
from nat.plugin_api import FunctionInfo
from nat.plugin_api import LLMRef
from nat.plugin_api import register_function

logger = logging.getLogger(__name__)

_ARGS = """Answers a question about Austrian law from RIS \
(Rechtsinformationssystem des Bundes) with the actual paragraphs, quotable and citable: \
Bauordnungen, Bautechnikgesetze, Garagengesetze and other Landesgesetze, the federal acts behind \
them, and court decisions; also whether an OIB requirement binds. The text of the OIB-Richtlinien \
themselves and the office's uploads are in \
knowledge_search, not here.

One call covers the whole path: it reads the address out of the question (§/Artikel, the named law, the \
Bundesland), takes the verified catalog pointer or searches RIS live, downloads at most two documents and \
cuts the paragraphs that answer the question out of them. No document number is passed.

Args:
    question (str): The legal question, in German, as the user means it, not a search string.
    conclusion (str): Optional. One line on what you are looking for; no effect on the call.
    jurisdiction (str): The Bundesland ("Wien", "Tirol", …). When omitted it is taken from the instrument, \
the question, then the project brief, and the answer states which.
    instrument (str): An address: "Bauordnung für Wien", "§ 63 BO Wien", a RIS document number or a \
ris.bka.gv.at URL. Naming a § makes the lookup deterministic: the paragraph is cut out by its number. Up to \
six §§ in one call ("§§ 75 und 81 BO Wien", "§§ 2 bis 4 Baupolizeigesetz Salzburg"); past six it names \
those it did not read.
    application (str): Only for the non-statute corpora: "Vfgh", "Vwgh", "Justiz", "Bvwg", "Lvwg" for case \
law, "BgblAuth"/"LgblAuth" for the authentic gazettes, "Begut"/"RegV" for drafts. Empty for statute law."""

#: The ``as_of`` argument's line, offered only to a turn whose organization has ``time-editions`` (ADR-0171).
AS_OF_ARG = """
    as_of (str): Optional YYYY-MM-DD: the version in force on that day (e.g. the filing day of a \
submission), read only from RIS version documents of that day; a miss rather than today's text."""

_RETURNS = """

Returns:
    str: Numbered passages, each with Source, Dokumentart, Punkt, a Citation key to copy verbatim, and the \
paragraph text. A miss says what was searched, which Bundesland was assumed and where that came from, what \
matched but was not read, and one concrete retry."""

#: What every caller sees: no ``as_of``, byte for byte the contract before ADR-0171.
RIS_LOOKUP_DESCRIPTION = _ARGS + _RETURNS
#: What a turn with ``time-editions`` sees (:func:`offer_as_of`).
RIS_LOOKUP_AS_OF_DESCRIPTION = _ARGS + AS_OF_ARG + _RETURNS


class RisLookupToolConfig(FunctionBaseConfig, name="ris_lookup"):
    """One RIS tool: question in, citable passages out."""

    base_url: str = Field(default=DEFAULT_BASE_URL, description="OGD-RIS API base URL")
    timeout: float = Field(default=60.0, description="HTTP timeout in seconds")
    planner_llm: LLMRef | None = Field(
        default=None,
        description=(
            "LLM used BOTH to plan a live RIS search and to pick the answering §§ out of a "
            "fetched law's headings (strict structured outputs, json_schema). Neither call "
            "happens when the catalog answers and the caller named a §. Must be an LLMRef "
            "(not a plain str) so NAT records the build-order dependency."
        ),
    )
    catalog_path: str = Field(
        default="",
        description=(
            "DEPRECATED (ADR-0025): path to a legacy flat catalog YAML. Empty = the norm registry "
            "(configs/norms/*/registry.yml, NORMS_DIR). Set only for legacy override."
        ),
    )
    ingest_into_knowledge: bool = Field(
        default=True,
        description=(
            "Ingest each fetched document's FULL text into the per-session knowledge "
            "collection, so read_passage can reopen another § of it later in the conversation"
        ),
    )


@register_function(config_type=RisLookupToolConfig)
async def ris_lookup(tool_config: RisLookupToolConfig, builder: Builder):
    # cache_max_entries=0: the shared read-through cache already holds the
    # document, and a second copy per worker is a megabyte per law per replica.
    client = RisClient(base_url=tool_config.base_url, timeout=tool_config.timeout, cache_max_entries=0)
    planner, picker = await _resolve_llms(tool_config, builder)

    async def _ris_lookup(
        question: str,
        conclusion: str = "",
        jurisdiction: str = "",
        instrument: str = "",
        application: str = "",
        # Hidden from the schema; a `time-editions` turn binds `offer_as_of`'s copy, which shows it.
        as_of: SkipJsonSchema[str] = "",
    ) -> str:
        # `conclusion` is deliberately unread, exactly like the knowledge
        # tools': it is the Herleitung's checkpoint slot, read off the CALL by
        # tool_calls.CONCLUSION_ARG, and a tool that acted on it would turn a
        # transparency field into a control channel.
        question = (question or "").strip()
        if not question:
            return "Error: ris_lookup needs a question — the legal question in German, not a search string."
        as_of = (as_of or "").strip()
        if error := as_of_error(as_of):
            return error
        if as_of and not await as_of_allowed():
            return AS_OF_REFUSED
        outcome = ActionOutcome()
        row = ActionRow("law", query=question, target=(instrument or "").strip())
        try:
            result = await _answer(question, jurisdiction, instrument, application, outcome, as_of)
        except BaseException:
            row.finish("error")
            raise
        outcome.settle(row)
        return result

    async def _answer(
        question: str, jurisdiction: str, instrument: str, application: str, outcome: ActionOutcome, as_of: str
    ) -> str:
        address = parse_address(question, instrument, jurisdiction)
        trace = LookupTrace(application=application, as_of=as_of)
        trace.candidates = await collect_candidates(
            client, planner, question, address, trace, tool_config.catalog_path, as_of
        )
        documents = await fetch_documents(client, trace.candidates, trace)
        selections = await select_passages(picker, question, address, documents, trace)
        passages = build_passages(selections, address)
        ingested = await ingest_documents(documents, tool_config.ingest_into_knowledge)
        emit_lookup_span(question, address, trace, passages)
        outcome.hits = len(passages)
        if not passages:
            return miss_message(question, address, trace)
        capture_passages(passages)
        return format_passages(passages, ingested, address)

    try:
        yield FunctionInfo.from_fn(_ris_lookup, description=RIS_LOOKUP_DESCRIPTION)
    finally:
        await client.aclose()


async def _resolve_llms(tool_config: RisLookupToolConfig, builder: Builder):
    """The search planner and the § extractor, or ``(None, None)``.

    One configured model serves both: they are the same kind of bounded
    structured-output call, and a second LLMRef would be a second thing to
    configure for no decision anybody makes differently. A model that cannot be
    resolved is not fatal — the live search then uses the caller's own words
    and the picker only answers a named §.
    """
    if not tool_config.planner_llm:
        return None, None
    try:
        from agent.common import get_langchain_llm

        llm = await get_langchain_llm(builder, tool_config.planner_llm)
    except Exception:
        logger.warning(
            "ris_lookup: could not resolve planner_llm '%s'; live search falls back to the "
            "caller's words and the § picker to the named § only",
            tool_config.planner_llm,
            exc_info=True,
        )
        return None, None
    return _make_planner(llm), make_picker(llm)


def _offers_as_of(tool: Any) -> bool:
    schema = getattr(tool, "args_schema", None)
    return "ris_lookup" in (getattr(tool, "name", "") or "") and "as_of" in getattr(schema, "model_fields", {})


@cache
def _schema_with_as_of(schema: type[BaseModel]) -> type[BaseModel]:
    """``schema`` with ``as_of`` shown: the same fields, the skip annotation dropped from that one."""
    fields: dict[str, Any] = {
        # A fresh field for `as_of`: its FieldInfo carries the skip marker in its metadata.
        name: (str, Field(default=info.default)) if name == "as_of" else (info.annotation, info)
        for name, info in schema.model_fields.items()
    }
    return create_model(schema.__name__, __config__=schema.model_config, **fields)


def offer_as_of(tools: Sequence[Any]) -> list[Any]:
    """``tools`` with the RIS lookup rebound to offer ``as_of``: for a turn whose organization has ``time-editions``.

    The registered tool hides the argument (its schema skips it, its description
    leaves it out), so a turn without the flag sends the payload it sent before
    ADR-0171. Everything else is returned untouched.
    """
    return [
        tool.model_copy(
            update={
                "description": RIS_LOOKUP_AS_OF_DESCRIPTION,
                "args_schema": _schema_with_as_of(tool.args_schema),
            }
        )
        if _offers_as_of(tool)
        else tool
        for tool in tools
    ]
