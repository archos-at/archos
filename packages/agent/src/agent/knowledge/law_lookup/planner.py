"""The search planner: a legal question in, the source's search out. Built from the record.

One structured-output call (``response_format: json_schema``, strict) whose
choices are the record's: the collections its search offers (``lookup.collections``,
each with the line that says when to choose it) and the territories its filter
knows (``lookup.territory.choices``). The plan model is made at runtime from
those, so an invalid collection or territory is refused by the schema whenever
the payload parses. Not every OpenRouter-served model honours strict mode, so
a garbled payload gets one corrective retry before the caller's fail-open.
"""

from __future__ import annotations

import logging
from typing import Literal

from langchain_core.exceptions import OutputParserException
from pydantic import BaseModel
from pydantic import Field
from pydantic import ValidationError
from pydantic import create_model

from agent.knowledge.law_lookup.source import LawSource

logger = logging.getLogger(__name__)

_CORRECTIVE = "Your previous output was invalid JSON. Return ONLY a single valid JSON object matching the schema."


def plan_model(law: LawSource) -> type[BaseModel]:
    """The search plan the planner fills, its choices the record's."""
    lookup = law.lookup
    collections = tuple(c.id for c in lookup.collections if c.plannable)
    territories = ("", *lookup.territory.choices) if lookup.territory else ("",)
    language = law.wording.language or lookup.language
    return create_model(
        "SearchPlan",
        __doc__=f"A structured search of {law.wording.source}.",
        collection=(Literal[collections], Field(description=f"{law.wording.source} collection to search")),
        terms=(str, Field(description=f"Full-text search terms in {language} (precise legal terminology)")),
        title=(str, Field(default="", description="Optional filter on the work's title, empty if unused")),
        territory=(
            Literal[territories],
            Field(default="", description=f"{law.wording.subdivision} filter, empty if not specific to one"),
        ),
        date_from=(str, Field(default="", description="YYYY-MM-DD or empty")),
        date_to=(str, Field(default="", description="YYYY-MM-DD or empty")),
        reasoning=(str, Field(default="", description="One short sentence: why this collection and these terms")),
    )


def planner_prompt(law: LawSource) -> str:
    """The planner's system prompt: the source, its collections' guide lines, the record's term guidance."""
    lookup = law.lookup
    guides = [f"- {c.id}: {c.guide}" for c in lookup.collections if c.plannable and c.guide]
    lines = [
        f"You translate a legal research request into search parameters for {law.wording.source} ({law.source.title}).",
        "",
        "Collection selection rules:",
        *guides,
    ]
    if lookup.search_guidance:
        lines.extend(["", lookup.search_guidance])
    return "\n".join(lines)


def apply_org_llm_policy(llm):
    """Apply the platform's per-request LLM policy to an auxiliary model.

    The org's runtime model override for the DEEP_RESEARCH_ROUTER agent group
    (the planner is the same kind of lightweight routing task) and the org's
    BYOK credential (ADR-0022) are applied per call, credential first so the
    ZDR pin inside ``apply_model_override`` lands only on a model that still
    points at OpenRouter. A failure falls back to the configured model PINNED
    to zero-data-retention endpoints, never the bare one.
    """
    from agent.common import apply_model_override
    from agent.common import apply_org_credential
    from agent.common import apply_zdr_routing
    from agent.common.model_overrides import AgentGroup

    try:
        return apply_model_override(apply_org_credential(llm), AgentGroup.DEEP_RESEARCH_ROUTER)
    except Exception:  # noqa: BLE001
        logger.warning("law_lookup: could not apply org LLM policy to an auxiliary model", exc_info=True)
        return apply_zdr_routing(llm)


async def invoke_structured(llm, schema: type[BaseModel], messages: list[dict], what: str):
    """One strict structured-output call, with one corrective retry on an invalid payload."""
    # Resolve overrides/credentials per call: they are request-scoped (headers).
    structured = apply_org_llm_policy(llm).with_structured_output(schema, method="json_schema", strict=True)
    try:
        return await structured.ainvoke(messages)
    except ValidationError, OutputParserException:
        logger.warning("law_lookup %s: invalid structured output, retrying once", what, exc_info=True)
        return await structured.ainvoke([*messages, {"role": "user", "content": _CORRECTIVE}])


def make_planner(llm, law: LawSource):
    """Wrap a chat model into the source's search planner."""
    schema = plan_model(law)
    system = planner_prompt(law)

    async def _plan(query: str, collection: str, title: str, territory: str, date_from: str, date_to: str):
        request = (
            f"Research request: {query}\n"
            f"Caller suggestion — collection: {collection or '(none)'}, title: {title or '(none)'}, "
            f"territory: {territory or '(none)'}, date_from: {date_from or '(none)'}, "
            f"date_to: {date_to or '(none)'}\n"
            "Respect the caller suggestion unless it is clearly wrong for this request."
        )
        messages = [{"role": "system", "content": system}, {"role": "user", "content": request}]
        return await invoke_structured(llm, schema, messages, "planner")

    return _plan
