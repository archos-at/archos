from __future__ import annotations

from typing import Any

from agent.common.action_outcome import ActionOutcome
from agent.observability.langfuse_trace_attributes import add_trace_tag
from agent.observability.retrieval_trace import PICK_LIMIT
from agent.observability.retrieval_trace import emit_retrieval_span

from .hit_judge import HitVerdicts
from .permit_records import permits_of
from .permit_records import plain_text
from .source_hits import PROJECT_LOOKUP_TOOL
from .source_hits import _decisions
from .source_hits import _usable_hits


def _project_ref(project: object) -> dict[str, str] | None:
    return (
        {"id": str(project.get("id")), "status": str(project.get("status") or "active")}
        if isinstance(project, dict) and project.get("id")
        else None
    )


def _observed_projects(records: list[Any]) -> list[dict[str, str]]:
    seen: dict[str, dict[str, str]] = {}
    for record in records:
        ref = _project_ref(record.get("project") if isinstance(record, dict) else None)
        if ref is not None:
            seen.setdefault(ref["id"], ref)
    return list(seen.values())


def lookup_observation(action: str, body: dict[str, Any], verdicts: HitVerdicts | None = None) -> dict[str, Any]:
    if action == "search":
        hits = _usable_hits(body)
        decisions, permits = _decisions(body), permits_of(body)
        judged = verdicts is not None
        return {
            "projects_in_scope": body.get("projectsInScope"),
            "projects_searched": body.get("projectsSearched"),
            "next_offset": body.get("nextOffset"),
            "passages": len(hits),
            "decisions": len(decisions),
            "permits": len(permits),
            "projects": _observed_projects([*decisions, *permits, *hits]),
            "picked": [
                {
                    "project": (_project_ref(hit.get("project")) or {}).get("id"),
                    "file": hit.get("filename"),
                    "page": hit.get("page"),
                    "score": round(float(hit.get("score") or 0.0), 4),
                    **({"solved": verdicts.solved[index]} if judged and verdicts.solved[index] is not None else {}),
                }
                for index, hit in enumerate(hits[:PICK_LIMIT])
            ],
            **(
                {"solved_any": verdicts.any_solved, "injection_flagged": len(verdicts.flagged)}
                if judged
                else {"judged": False}
            ),
        }
    if action == "find":
        projects = [project for project in body.get("projects") or [] if isinstance(project, dict)]
        return {
            "total": body.get("total", len(projects)),
            "projects": [ref for ref in map(_project_ref, projects) if ref],
        }
    return {"projects": [ref for ref in [_project_ref(body.get("project"))] if ref]}


def _observe(action: str, payload: dict[str, Any], outcome: dict[str, Any]) -> None:
    add_trace_tag("feature:cross-project")
    emit_retrieval_span(tool_name=PROJECT_LOOKUP_TOOL, search_input={"action": action, **payload}, picks=outcome)


def _only_project_name(records: list[Any]) -> str | None:
    names = {
        plain_text(record["project"].get("name"))
        for record in records
        if isinstance(record, dict) and isinstance(record.get("project"), dict)
    }
    return names.pop() if len(names) == 1 and next(iter(names), "") else None


def record_outcome(action: str, body: dict[str, Any], outcome: ActionOutcome) -> None:
    if action == "search":
        hits = _usable_hits(body)
        outcome.hits = len(hits)
        outcome.documents = len({(hit.get("collection"), hit.get("filename")) for hit in hits})
        outcome.target = _only_project_name(hits)
        return
    if action == "find":
        projects = [project for project in body.get("projects") or [] if isinstance(project, dict)]
        outcome.hits = len(projects)
        outcome.target = plain_text(projects[0].get("name")) if len(projects) == 1 else None
        return
    project = body.get("project") if isinstance(body.get("project"), dict) else {}
    outcome.hits = 1 if project else 0
    outcome.target = plain_text(project.get("name")) or None
