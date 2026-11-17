from __future__ import annotations

import logging
from collections.abc import Iterable
from typing import Any

from agent.observability.langfuse_scores import _UNHEALTHY_SEVERITIES
from agent.observability.langfuse_scores import RuntimeScore
from agent.observability.langfuse_scores import _boolean
from agent.observability.langfuse_scores import emit_scores

logger = logging.getLogger(__name__)


def _count(by_kind: dict[str, Any], kind: str) -> float:
    event = by_kind.get(kind)
    return float(event.count) if event is not None else 0.0


def citation_scores(events: Iterable[Any]) -> list[RuntimeScore]:
    by_kind = {event.kind: event for event in events}
    if "registry_empty" in by_kind:
        return [_boolean("sources-empty", True), _boolean("citation-health", False, "registry_empty")]
    if "turn_verified" not in by_kind:
        return []
    from agent.common.citation_events import SEVERITY_BY_KIND

    unhealthy = sorted(kind for kind in by_kind if SEVERITY_BY_KIND.get(kind) in _UNHEALTHY_SEVERITIES)
    scores = [
        _boolean("citation-health", not unhealthy, ", ".join(unhealthy) or None),
        _boolean("answer-grounded", "answer_ungrounded" not in by_kind),
        _boolean("sources-empty", False),
        RuntimeScore("citations-removed", _count(by_kind, "citations_removed")),
        RuntimeScore("quotes-unverified", _count(by_kind, "quote_unverified")),
    ]
    precision = by_kind.get("retrieval_precision")
    retrieved = int((precision.detail or {}).get("retrieved_count") or 0) if precision is not None else 0
    if retrieved > 0:
        cited = int(precision.detail.get("cited_count") or 0)
        scores.append(RuntimeScore("retrieval-precision", round(cited / retrieved, 4)))
    return scores


_BUILDING_LAW_KIND = "building_law"


def _names_its_edition(source: dict[str, Any]) -> bool:
    revision = source.get("revision")
    return bool(source.get("edition_label")) or bool(isinstance(revision, dict) and revision.get("date"))


def citation_line_scores(sources: Iterable[Any], *, may_bind: bool) -> list[RuntimeScore]:
    law = [source for source in sources if isinstance(source, dict) and source.get("kind") == _BUILDING_LAW_KIND]
    if not law:
        return []
    named = sum(1 for source in law if _names_its_edition(source))
    scores = [RuntimeScore("edition-named", round(named / len(law), 4), comment=f"{named} of {len(law)}")]
    if may_bind:
        resolved = sum(1 for source in law if source.get("role"))
        scores.append(
            RuntimeScore("citation-role-resolved", round(resolved / len(law), 4), comment=f"{resolved} of {len(law)}")
        )
    return scores


def emit_citation_line_scores(wire_sources: Iterable[Any], *, writer: str) -> None:
    from agent.common.knowledge_context import gate_policy
    from agent.common.knowledge_context import turn_knowledge_context

    may_bind = gate_policy(turn_knowledge_context().gate).may_bind
    emit_scores(citation_line_scores(wire_sources, may_bind=may_bind), writer=writer)
