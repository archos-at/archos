from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from agent.citations.citation_keys import entry_shelf
from agent.citations.citation_keys import parse_citation_key
from agent.citations.entries import SourceEntry
from agent.common.knowledge_context import EditionUse
from agent.common.knowledge_context import turn_knowledge_context
from agent.common.source_kinds import Shelf


@dataclass(frozen=True)
class BindingClassification:
    binding_status: str = "unknown"


def _use_by_id(uses: tuple[EditionUse, ...], entry: SourceEntry) -> EditionUse | None:
    if entry.edition_id:
        return next((use for use in uses if use.edition_id == entry.edition_id), None)
    if not entry.work_id:
        return None
    of_work = [use for use in uses if use.work_id == entry.work_id]
    live = next((use for use in of_work if use.edition_id is None), None)
    return live or (of_work[0] if len(of_work) == 1 else None)


def _use_by_corpus_file(uses: tuple[EditionUse, ...], entry: SourceEntry) -> EditionUse | None:
    if not entry.citation_key or entry_shelf(entry) is not Shelf.BASE:
        return None
    file_name, _page = parse_citation_key(entry.citation_key)
    base_name = file_name.rsplit("/", 1)[-1].lower()
    if not base_name:
        return None
    return next((use for use in uses if base_name in (name.lower() for name in use.corpus_files)), None)


def use_for_entry(entry: SourceEntry) -> EditionUse | None:
    uses = turn_knowledge_context().uses
    if not uses:
        return None
    if entry.edition_id or entry.work_id:
        return _use_by_id(uses, entry)
    return _use_by_corpus_file(uses, entry)


def binding_status_for(use: EditionUse) -> str:
    if use.scope_unsettled:
        return "unknown"
    if use.role == "binding":
        return "binding" if use.via == "territory" else "declared_binding"
    if use.role == "authority_practice":
        return "declared_binding"
    if use.role in ("guidance", "interpretation"):
        return "interpretive"
    return "unknown"


def classification_for(use: EditionUse | None, *, place: bool) -> BindingClassification:
    if place or use is None:
        return BindingClassification()
    return BindingClassification(binding_status=binding_status_for(use))


def role_fields(use: EditionUse | None) -> dict[str, Any]:
    if use is None:
        return {}
    route = use.route
    return {
        "role": use.role,
        "role_qualifier": use.qualifier,
        "work_id": use.work_id,
        "edition_id": use.edition_id,
        "designation": use.designation,
        "edition_label": use.edition_label,
        "issuer": use.issuer,
        "route": (
            {
                key: value
                for key, value in (
                    ("work_id", route.work_id),
                    ("designation", route.designation),
                    ("edition_label", route.edition_label),
                    ("provision", route.provision),
                )
                if value is not None
            }
            if route is not None
            else None
        ),
        "role_since": use.role_since,
        "as_of": use.date,
        "last_checked_at": use.last_checked_at,
        "freshness": use.freshness,
        "role_labels": list(use.labels) or None,
        "language": use.language,
        "text_status": use.text_status,
    }
