from __future__ import annotations

import logging
from typing import Annotated
from typing import Any
from typing import Literal

from pydantic import BeforeValidator

from agent.common.action_outcome import ActionOutcome
from agent.common.action_rows import ActionRow
from nat.plugin_api import Builder
from nat.plugin_api import FunctionBaseConfig
from nat.plugin_api import FunctionInfo
from nat.plugin_api import register_function

from .bff_calls import _call
from .bff_calls import _Refused
from .client import BRIEF_PATH
from .client import PROJECTS_PATH
from .client import SEARCH_PATH
from .hit_judge import HitVerdicts
from .hit_judge import judge_hits
from .lookup_rendering import _render_brief
from .lookup_rendering import _render_find
from .lookup_rendering import _render_search
from .observation import _observe
from .observation import lookup_observation
from .observation import record_outcome
from .project_facts import ProjectFact
from .project_facts import project_facts_filter
from .source_hits import _usable_hits

logger = logging.getLogger(__name__)


DocumentType = Literal[
    "Bebauungsplan",
    "Flächenwidmungsplan",
    "Grundriss",
    "Schnitt",
    "Ansicht",
    "Detail",
    "Gutachten",
    "Bescheid",
    "Norm/Richtlinie",
    "Vertrag",
    "correspondence",
    "Foto",
    "Sonstiges",
]
Discipline = Literal[
    "Standsicherheit",
    "Brandschutz",
    "Hygiene/Gesundheit/Umweltschutz",
    "Nutzungssicherheit/Barrierefreiheit",
    "Schallschutz",
    "Energieeinsparung/Wärmeschutz",
]


def _normalized(value: object) -> object:
    return value.strip().lower() if isinstance(value, str) else value


Action = Annotated[Literal["search", "find", "brief"], BeforeValidator(_normalized)]
Scope = Annotated[Literal["similar", "closed", "all", "named"], BeforeValidator(_normalized)]


_DESCRIPTION = (
    "Looks things up in the office's OTHER projects, above all the closed reference projects. This chat's own "
    "project is never included. `action`: `search` searches documents (`query` required; `scope` `similar` = the "
    "projects most similar to this one first (default), `closed` = only closed ones, likewise most similar first, "
    "`all` = all, newest first, `named` = only `project_ids`; optionally `document_types`, `disciplines`, "
    "`period_from`/`period_to` as YYYY-MM-DD for the project period). One call searches at most 40 projects; "
    "if the result names a next page, continue with `offset`. `project_facts` (for `search` and `find`, e.g. "
    '["tirol","gk4","wohnen"]) admits only projects with these key facts: one value per kind suffices, all kinds '
    "must match; projects without recorded key facts drop out. `open_folders_only` leaves out folders with "
    "their own access list (default: off). The search also returns Bescheide of earlier procedures "
    "(conditions, information requests with authority, municipality and date). `find` lists projects with "
    "status, period and address (`query` searches name and address). `brief` reads a project's confirmed key "
    "facts and its summary (`project_id` from `<reference_projects>`, `find` or a hit).\n"
    "Returns passages with citation keys, project and year. A hit is a precedent, not a norm. Only the passage "
    "is available: documents of other projects cannot be opened further. The whole office may read closed "
    "projects; content from RUNNING projects makes the chat shareable only with people who may open those "
    "projects, and shuts project memory, tasks, deep research and filing."
)


class ProjectLookupConfig(FunctionBaseConfig, name="project_lookup"): ...


def search_payload(
    *,
    query: str,
    scope: str,
    project_ids: list[str],
    document_types: list[str],
    disciplines: list[str],
    period_from: str,
    period_to: str,
    offset: int,
    open_folders_only: bool = False,
    order: list[str] | None = None,
    project_facts: dict[str, list[str | int]] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"query": query.strip(), "scope": scope, "offset": max(0, int(offset))}
    if project_facts:
        payload["projectFacts"] = project_facts
    if scope == "named":
        payload["projectIds"] = project_ids
    if document_types:
        payload["documentTypes"] = document_types
    if disciplines:
        payload["disciplines"] = disciplines
    if period_from.strip():
        payload["from"] = period_from.strip()
    if period_to.strip():
        payload["to"] = period_to.strip()
    if open_folders_only:
        payload["openFoldersOnly"] = True
    if order and scope in ("similar", "closed"):
        payload["order"] = list(order)
    return payload


async def _judge(query: str, body: dict[str, Any]) -> HitVerdicts | None:
    try:
        return await judge_hits(query, _usable_hits(body))
    except Exception:  # noqa: BLE001 — a judgement is worth less than the lookup
        logger.debug("Cross-project hit judge failed", exc_info=True)
        return None


def _reference_order() -> list[str]:
    from agent.knowledge.restricted_use import current_cross_project_turn

    turn = current_cross_project_turn()
    return list(turn.reference_order) if turn is not None else []


async def _lookup(
    action: str,
    query: str,
    scope: str,
    project_ids: list[str],
    document_types: list[str],
    disciplines: list[str],
    period_from: str,
    period_to: str,
    offset: int,
    project_id: str,
    open_folders_only: bool,
    project_facts: list[str],
    outcome: ActionOutcome,
) -> str:
    facts = project_facts_filter(project_facts) if action in ("search", "find") else {}
    if action == "search":
        if not query.strip():
            raise _Refused("Error: `search` needs a `query`.")
        if scope == "named" and not project_ids:
            raise _Refused("Error: `scope: named` needs `project_ids` (from `find`).")
        payload = search_payload(
            query=query,
            scope=scope,
            project_ids=project_ids,
            document_types=document_types,
            disciplines=disciplines,
            period_from=period_from,
            period_to=period_to,
            offset=offset,
            open_folders_only=open_folders_only,
            order=_reference_order(),
            project_facts=facts,
        )
        body = await _call(SEARCH_PATH, payload)
        record_outcome(action, body, outcome)
        verdicts = await _judge(payload["query"], body)
        _observe(action, payload, lookup_observation(action, body, verdicts))
        return _render_search(body, verdicts, facts)
    if action == "find":
        payload: dict[str, Any] = {}
        if query.strip():
            payload["query"] = query.strip()
        if period_from.strip():
            payload["from"] = period_from.strip()
        if period_to.strip():
            payload["to"] = period_to.strip()
        if facts:
            payload["projectFacts"] = facts
        body = await _call(PROJECTS_PATH, payload)
        record_outcome(action, body, outcome)
        _observe(action, payload, lookup_observation(action, body))
        return _render_find(body, facts)
    if not project_id.strip():
        raise _Refused("Error: `brief` needs a `project_id` (from `find` or a hit).")
    payload = {"projectId": project_id.strip()}
    body = await _call(BRIEF_PATH, payload)
    record_outcome(action, body, outcome)
    _observe(action, payload, lookup_observation(action, body))
    return _render_brief(body)


async def run_project_lookup(
    action: Action,
    query: str = "",
    scope: Scope = "similar",
    project_ids: list[str] | None = None,
    document_types: list[DocumentType] | None = None,
    disciplines: list[Discipline] | None = None,
    period_from: str = "",
    period_to: str = "",
    offset: int = 0,
    project_id: str = "",
    open_folders_only: bool = False,
    project_facts: list[ProjectFact] | None = None,
) -> str:
    outcome = ActionOutcome()
    row = ActionRow("lookup", query=(query or "").strip())
    try:
        result = await _lookup(
            action,
            query or "",
            scope,
            list(project_ids or []),
            list(document_types or []),
            list(disciplines or []),
            period_from or "",
            period_to or "",
            offset or 0,
            project_id or "",
            bool(open_folders_only),
            list(project_facts or []),
            outcome,
        )
    except _Refused as refused:
        _observe(str(action), {}, {"refused": refused.code})
        row.finish("error")
        return refused.message
    except BaseException:
        row.finish("error")
        raise
    outcome.settle(row, target=outcome.target)
    return result


@register_function(config_type=ProjectLookupConfig)
async def project_lookup(tool_config: ProjectLookupConfig, builder: Builder):
    yield FunctionInfo.from_fn(run_project_lookup, description=_DESCRIPTION)
