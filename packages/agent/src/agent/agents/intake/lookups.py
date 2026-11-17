"""The intake's lookups (design §5.3, ADR-0173): thin tools, one per catalog operation, and no questionnaire.

Every fact setup needs has a record and an operation; the intake asks the
workspace's own door for it, as the person who started the run (echo, never
sign: :func:`agent.tools.workspace.register.read_operation`). Nothing here
knows a country: a country's question set is its records.

:data:`INTAKE_LOOKUPS` maps each tool to the operation it runs, and
``packages/agent/tests/agents/intake/test_lookups.py`` holds the map to the
catalog's exposure fixture: an operation the door does not offer the agent, or
one renamed, fails it. The two lookups the agent already holds natively
(``knowledge_search`` for the corpus, ``law_lookup`` for statutes) are named in
:data:`NATIVE_LOOKUPS` and bound as those tools, never a second path.
``location-lookup`` joins when its operation exists.

Not bound to the intake agent yet: binding them changes what it is offered,
which waits for its country-neutral prompt (design §5.3, B1). Until then the
agent's four intake tools are byte for byte what they were.
"""

from __future__ import annotations

import json
from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel
from pydantic import Field

from agent.project_context import get_project_id_from_context
from agent.tools.workspace.register import read_operation

#: Tool name → the catalog operation it runs through the door.
INTAKE_LOOKUPS: dict[str, str] = {
    "site_resolve": "site-resolve",
    "project_base_get": "project-base-get",
    "classification_evaluate": "classification-evaluate",
}

#: Lookups the agent holds as native tools: tool name → the operation the door offers outside agents instead.
NATIVE_LOOKUPS: dict[str, str] = {
    "knowledge_search": "knowledge-search",
    "law_lookup": "law-lookup",
}

#: Longest result handed back to the model; a lookup's answer is a few records.
MAX_RESULT_CHARS = 12_000


class SiteResolveInput(BaseModel):
    q: str = Field(description="The address as typed, e.g. 'Herrengasse 16, 8010 Graz'.", min_length=3, max_length=200)


class ProjectInput(BaseModel):
    pass


class ClassificationInput(BaseModel):
    planned: dict[str, Any] = Field(default_factory=dict, description="Planned values by fact key, to try a variant.")


def _rendered(result: dict[str, Any] | None, operation: str) -> str:
    if result is None:
        return f"{operation} could not run for this run's person; go on without it and say what is missing."
    return json.dumps(result, ensure_ascii=False)[:MAX_RESULT_CHARS]


def _project_id() -> str | None:
    return get_project_id_from_context()


async def _site_resolve(q: str) -> str:
    return _rendered(await read_operation(INTAKE_LOOKUPS["site_resolve"], {"query": {"q": q}}), "site-resolve")


async def _project_base_get() -> str:
    project_id = _project_id()
    if not project_id:
        return "This run names no project; project-base-get needs one."
    return _rendered(
        await read_operation(INTAKE_LOOKUPS["project_base_get"], {"params": {"id": project_id}}), "project-base-get"
    )


async def _classification_evaluate(planned: dict[str, Any] | None = None) -> str:
    project_id = _project_id()
    if not project_id:
        return "This run names no project; classification-evaluate needs one."
    body = {"params": {"id": project_id}, "body": {"planned": planned} if planned else {}}
    return _rendered(await read_operation(INTAKE_LOOKUPS["classification_evaluate"], body), "classification-evaluate")


def make_intake_lookup_tools() -> list[StructuredTool]:
    """The intake's lookups as tools, each running its operation through the door."""
    return [
        StructuredTool.from_function(
            coroutine=_site_resolve,
            name="site_resolve",
            description="Resolve a typed address against the official register: country, Land, municipality.",
            args_schema=SiteResolveInput,
        ),
        StructuredTool.from_function(
            coroutine=_project_base_get,
            name="project_base_get",
            description=(
                "The project's base knowledge: the gate (site_unknown, not_entitled, or coverage), the chain, "
                "every edition with its role, and the procedures."
            ),
            args_schema=ProjectInput,
        ),
        StructuredTool.from_function(
            coroutine=_classification_evaluate,
            name="classification_evaluate",
            description="The building's class under its site's rules, open inputs, and the document for each.",
            args_schema=ClassificationInput,
        ),
    ]
