from __future__ import annotations

from typing import Any

from agent import project_context
from agent.common.grounding_block import GroundingHit
from agent.common.grounding_block import SourceProject
from agent.common.norm_registry import FEDERAL_STATE_TOKENS
from agent.common.source_kinds import Shelf
from agent.profile_names import normalize_profile_token

from .permit_records import capped_body
from .permit_records import permit_body
from .permit_records import permit_title
from .permit_records import plain_text

PROJECT_LOOKUP_TOOL = "project_lookup"


def _federal_state_note(project: dict[str, Any]) -> str | None:
    theirs = project.get("federal_state", project.get("bundesland"))
    if not isinstance(theirs, str) or not theirs:
        return None
    theirs = normalize_profile_token("federal_state", theirs)
    label = FEDERAL_STATE_TOKENS.get(theirs) or ("outside Austria" if theirs == "outside_austria" else theirs)
    context = project_context.get_signed_request_context()
    ours = context.federal_state if context is not None else None
    if ours and ours != theirs:
        return f"{label} — not this project's federal state: a different building code applies there"
    return label


def _source_project(project: dict[str, Any], name: str) -> SourceProject:
    return SourceProject(
        id=str(project.get("id")),
        name=name,
        status=str(project.get("status") or "active"),
        federal_state_note=_federal_state_note(project),
    )


_SNIPPET_ELLIPSIS = "…"


def _hit(raw: dict[str, Any]) -> GroundingHit | None:
    project = raw.get("project") if isinstance(raw.get("project"), dict) else {}
    filename, collection, project_id = raw.get("filename"), raw.get("collection"), project.get("id")
    if not (isinstance(filename, str) and filename and isinstance(collection, str) and project_id):
        return None
    name = plain_text(project.get("name")) or "Projekt"
    page = raw.get("page") if isinstance(raw.get("page"), int) and raw.get("page") > 0 else None
    snippet = str(raw.get("snippet") or "").strip()
    truncated = snippet.endswith(_SNIPPET_ELLIPSIS)
    key = f"{filename} ({name})"
    return GroundingHit(
        citation_key=f"{key}, p.{page}" if page is not None else key,
        file_name=filename,
        page=page,
        shelf=Shelf.PROJECT,
        collection=collection,
        doc_class=None,
        display_title=plain_text(raw.get("title")) or filename,
        folder_path=None,
        clause=None,
        score=float(raw.get("score") or 0.0),
        content_type="text",
        provenance=None,
        stored_image_index=None,
        status_note=None,
        body=snippet.removesuffix(_SNIPPET_ELLIPSIS).rstrip() if truncated else snippet,
        body_truncated=truncated,
        project=_source_project(project, name),
    )


_DECISION_KIND = {"decision": "Decision", "constraint": "Constraint"}

MEMORY_SOURCE_NAME = "Projektgedächtnis"


def _decisions(body: dict[str, Any]) -> list[dict[str, Any]]:
    raw = body.get("decisions") if isinstance(body.get("decisions"), list) else []
    usable = (item for item in raw if isinstance(item, dict) and isinstance(item.get("project"), dict))
    return [item for item in usable if item.get("content") and item.get("collection")]


def _decision_provenance(item: dict[str, Any]) -> str:
    origin = item.get("origin") or ("person" if item.get("confirmed") else "agent")
    if origin == "person":
        return "confirmed by a person"
    if origin == "documents":
        return "inferred from the documents" + _evidence_cite(item.get("evidence"))
    return "noted by you"


def _evidence_cite(evidence: Any) -> str:
    first = next((e for e in evidence or [] if isinstance(e, dict) and plain_text(e.get("fileName"))), None)
    if first is None:
        return ""
    page = plain_text(first.get("page"))
    return f": {plain_text(first['fileName'])}" + (f" p. {page}" if page else "")


def _decision_line(item: dict[str, Any]) -> str:
    year = str(item.get("recordedAt") or "")[:4]
    label = _DECISION_KIND.get(str(item.get("kind")), "Decision")
    return f"{label} ({_decision_provenance(item)}{', ' + year if year else ''}): {plain_text(item['content'])}"


def _decision_hits(decisions: list[dict[str, Any]]) -> list[GroundingHit]:
    by_project: dict[str, list[dict[str, Any]]] = {}
    for item in decisions:
        by_project.setdefault(str(item["project"].get("id")), []).append(item)
    hits = []
    for items in by_project.values():
        project = items[0]["project"]
        name = plain_text(project.get("name")) or "Projekt"
        hits.append(
            GroundingHit(
                citation_key=f"{MEMORY_SOURCE_NAME} ({name})",
                file_name=MEMORY_SOURCE_NAME,
                page=None,
                shelf=Shelf.PROJECT,
                collection=str(items[0]["collection"]),
                doc_class=None,
                display_title="Festgehaltene Entscheidungen (aus dem Projektgedächtnis, kein Dokument)",
                folder_path=None,
                clause=None,
                score=1.0,
                content_type="text",
                provenance=None,
                stored_image_index=None,
                status_note=None,
                body="\n".join(_decision_line(item) for item in items),
                body_truncated=False,
                project=_source_project(project, name),
            )
        )
    return hits


def _permit_hits(permits: list[dict[str, Any]]) -> list[GroundingHit]:
    hits = []
    for item in permits:
        project = item["project"]
        name = plain_text(project.get("name")) or "Projekt"
        first = next((r for r in item.get("requirements") or [] if isinstance(r, dict)), {})
        page = first.get("page") if isinstance(first.get("page"), int) and first.get("page") > 0 else None
        key = f"{item['fileName']} ({name})"
        body, truncated = capped_body(permit_body(item))
        hits.append(
            GroundingHit(
                citation_key=f"{key}, p.{page}" if page is not None else key,
                file_name=str(item["fileName"]),
                page=page,
                shelf=Shelf.PROJECT,
                collection=str(item["collection"]),
                doc_class=None,
                display_title=permit_title(item),
                folder_path=None,
                clause=None,
                score=1.0,
                content_type="text",
                provenance=None,
                stored_image_index=None,
                status_note=None,
                body=body,
                body_truncated=truncated,
                project=_source_project(project, name),
            )
        )
    return hits


def _usable_hits(body: dict[str, Any]) -> list[dict[str, Any]]:
    raw_hits = body.get("hits") if isinstance(body.get("hits"), list) else []
    return [raw for raw in raw_hits if isinstance(raw, dict) and _hit(raw) is not None]


BRIEF_SOURCE_NAME = "Projektdaten"


def _brief_hit(project: dict[str, Any], body: str) -> GroundingHit:
    name = plain_text(project.get("name")) or "Projekt"
    return GroundingHit(
        citation_key=f"{BRIEF_SOURCE_NAME} ({name})",
        file_name=BRIEF_SOURCE_NAME,
        page=None,
        shelf=Shelf.PROJECT,
        collection=str(project["collection"]),
        doc_class=None,
        display_title="Eckdaten und Zusammenfassung (aus den Projektdaten, kein Dokument)",
        folder_path=None,
        clause=None,
        score=1.0,
        content_type="text",
        provenance=None,
        stored_image_index=None,
        status_note=None,
        body=body,
        body_truncated=False,
        project=_source_project(project, name),
    )
