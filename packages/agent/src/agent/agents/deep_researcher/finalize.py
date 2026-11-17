from __future__ import annotations

import logging
import re
from collections.abc import Iterable
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
from typing import Any

from agent.agents.piloti.markers import ConfidenceLevel
from agent.agents.piloti.markers import answer_confidence_capped_reason
from agent.agents.piloti.markers import surface_answer_confidence
from agent.citations.entries import lost_citations
from agent.citations.quote_verification import verify_quoted_spans
from agent.citations.references import expand_grouped_citations
from agent.citations.sanitize import sanitize_report
from agent.citations.source_identity import source_label
from agent.citations.source_identity import source_origin_token
from agent.citations.verification import verify_citations
from agent.citations.wire import source_entry_to_wire
from agent.common import citation_events
from agent.common.retrieval_ledger import build_retrieval_ledger
from agent.common.turn_notices import CUTOFF_RUN_BUDGET
from agent.common.turn_notices import CUTOFF_STEP_LIMIT
from agent.common.turn_notices import CUTOFF_UPSTREAM_TIMEOUT
from agent.common.turn_notices import CUTOFF_USER_REQUESTED
from agent.common.turn_notices import CUTOFF_WALL_CLOCK
from agent.common.turn_notices import DEGRADED_BASIS_UNREAD
from agent.common.turn_notices import DEGRADED_NO_VALID_CITATIONS
from agent.common.turn_notices import DEGRADED_UNVERIFIED_QUOTES
from agent.common.turn_notices import emit_answer_degraded
from agent.skills import SkillRuntime

logger = logging.getLogger(__name__)

MIN_SALVAGE_REPORT_CHARS = 200

_INCOMPLETE_EVIDENCE_CONFIDENCE_CEILING: ConfidenceLevel = "medium"

_CONFIDENCE_RANK: dict[str, int] = {"low": 0, "medium": 1, "high": 2}

_HONESTY_BANNER_PREFIX = "> **Hinweis:**"

_CUTOFF_CAUSE_CLAUSES = {
    CUTOFF_WALL_CLOCK: "wegen des erreichten Zeitlimits",
    CUTOFF_STEP_LIMIT: "wegen des erreichten Schritt-Limits",
    CUTOFF_UPSTREAM_TIMEOUT: "weil eine angefragte Quelle nicht rechtzeitig geantwortet hat",
    CUTOFF_RUN_BUDGET: "wegen des erreichten Recherche-Budgets",
    CUTOFF_USER_REQUESTED: "auf Ihren Wunsch",
}
_HONESTY_BANNER_PREFIX_EN = "> **Note:**"
_CUTOFF_CAUSE_CLAUSES_EN = {
    CUTOFF_WALL_CLOCK: "at the time limit",
    CUTOFF_STEP_LIMIT: "at the step limit",
    CUTOFF_UPSTREAM_TIMEOUT: "because a requested source did not answer in time",
    CUTOFF_RUN_BUDGET: "at the research budget",
    CUTOFF_USER_REQUESTED: "at your request",
}

_OUTPUT_PATHS = ("/shared/output.md", "/output.md")




def _file_text(entry: Any) -> str | None:
    if isinstance(entry, dict):
        entry = entry.get("content")
    if isinstance(entry, bytes):
        entry = entry.decode("utf-8")
    if isinstance(entry, str) and entry.strip():
        return entry.strip()
    return None


def extract_final_markdown(result: Any) -> str | None:
    files = result.get("files", {}) if isinstance(result, dict) else getattr(result, "files", {})
    if not isinstance(files, dict):
        return None
    for path in _OUTPUT_PATHS:
        text = _file_text(files.get(path))
        if text:
            return text
    return None


def set_state_field(result: Any, key: str, value: Any) -> None:
    if isinstance(result, dict):
        result[key] = value
        return
    setattr(result, key, value)


def replace_last_message_content(result: Any, content: str) -> None:
    messages = result.get("messages") if isinstance(result, dict) else getattr(result, "messages", None)
    if not messages:
        return
    last_msg = messages[-1]
    if hasattr(last_msg, "model_copy"):
        messages[-1] = last_msg.model_copy(update={"content": content})
        return
    messages[-1] = type(last_msg)(content=content)




def _cap_for_incomplete_evidence(
    level: ConfidenceLevel | None,
    *,
    cutoff_reason: str | None,
    degraded_reasons: list[str],
) -> ConfidenceLevel | None:
    if level is None or (cutoff_reason is None and not degraded_reasons):
        return level
    ceiling = _INCOMPLETE_EVIDENCE_CONFIDENCE_CEILING
    return level if _CONFIDENCE_RANK[level] <= _CONFIDENCE_RANK[ceiling] else ceiling


def _prepend_honesty_banner(
    report: str,
    *,
    cutoff_reason: str | None,
    degraded_reasons: list[str] | None,
) -> str:
    from agent.common.query_expansion import detect_language

    english = detect_language(report[:4000]) == "en"
    sentences: list[str] = []
    if cutoff_reason is not None:
        cause = (_CUTOFF_CAUSE_CLAUSES_EN if english else _CUTOFF_CAUSE_CLAUSES).get(cutoff_reason)
        cause_clause = f" {cause}" if cause else ""
        sentences.append(
            f"This research was stopped{cause_clause} before it was finished, so the report below is incomplete."
            if english
            else f"Diese Recherche wurde{cause_clause} vorzeitig beendet, der folgende Bericht ist daher unvollständig."
        )
    if any(reason != DEGRADED_BASIS_UNREAD for reason in degraded_reasons or ()):
        sentences.append(
            "The statements could not be fully verified and are only partly reliable."
            if english
            else "Die Angaben konnten nicht vollständig geprüft werden und sind nur eingeschränkt belastbar."
        )
    if not sentences:
        return report
    prefix = _HONESTY_BANNER_PREFIX_EN if english else _HONESTY_BANNER_PREFIX
    return f"{prefix} {' '.join(sentences)}\n\n{report.lstrip()}"


def _salvaged_report_length(text: str) -> int:
    body = text
    if body.startswith(_HONESTY_BANNER_PREFIX):
        _, separator, remainder = body.partition("\n\n")
        if separator:
            body = remainder
    return len(body.strip())


def _summarize_removed_citations(removed_citations: list[dict[str, Any]]) -> dict[str, Any] | None:
    removed_citations = lost_citations(removed_citations)
    if not removed_citations:
        return None
    reasons: list[str] = []
    for entry in removed_citations:
        reason = str(entry.get("reason") or "unverifiable") if isinstance(entry, dict) else "unverifiable"
        if reason and reason not in reasons:
            reasons.append(reason)
        if len(reasons) >= 5:
            break
    return {"count": len(removed_citations), "reasons": reasons}




def _registry_entry(registry: Any, citation: dict[str, Any]) -> Any:
    if citation.get("citation_key"):
        return registry.entry_for_citation_key(citation["citation_key"])
    if citation.get("url"):
        return registry.entry_for_url(citation["url"])
    return None


def _wire_source(entry: Any, number: Any) -> dict[str, Any] | None:
    try:
        return source_entry_to_wire(entry, number=number if isinstance(number, int) else None)
    except Exception:  # noqa: BLE001 - one bad source must not zero out the rest
        logger.warning(
            "Skipping source that failed wire serialization: %s",
            getattr(entry, "url", None) or getattr(entry, "citation_key", None),
            exc_info=True,
        )
        return None


def _cited_sources_to_wire(registry: Any, valid_citations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    wire_sources: list[dict[str, Any]] = []
    seen_ids: set[int] = set()
    for citation in valid_citations:
        entry = _registry_entry(registry, citation)
        if entry is None or id(entry) in seen_ids:
            continue
        seen_ids.add(id(entry))
        wire = _wire_source(entry, citation.get("number"))
        if wire is not None:
            wire_sources.append(wire)
    return wire_sources


def _dead_numbers(removed_numbers: Any) -> set[int]:
    if isinstance(removed_numbers, dict):
        return {n for n in removed_numbers if isinstance(n, int)}
    if isinstance(removed_numbers, (set, frozenset, list, tuple)):
        return {n for n in removed_numbers if isinstance(n, int)}
    return set()


def _is_dead(number: Any, dead: set[int], renumber_map: dict[int, int]) -> bool:
    if not isinstance(number, int):
        return False
    return number in dead or (bool(renumber_map) and number not in renumber_map)


def _renumbered(source: dict[str, Any], renumber_map: dict[int, int]) -> dict[str, Any]:
    number = source.get("number")
    if not renumber_map or not isinstance(number, int):
        return source
    return {**source, "number": renumber_map.get(number, number)}


def _apply_renumbering(
    wire_sources: list[dict[str, Any]],
    renumber_map: dict[int, int] | None,
    removed_numbers: Any = None,
) -> list[dict[str, Any]]:
    if not isinstance(renumber_map, dict):
        renumber_map = {}
    dead = _dead_numbers(removed_numbers)
    kept = [source for source in wire_sources if not _is_dead(source.get("number"), dead, renumber_map)]
    dropped = len(wire_sources) - len(kept)
    if dropped:
        logger.info(
            "Dropping %d wire source(s) whose citations sanitize_report removed: dead=%s",
            dropped,
            sorted(dead),
        )
    return [_renumbered(source, renumber_map) for source in kept]




@dataclass(frozen=True)
class Verification:

    report: str
    checked: bool = False
    valid_citations: list[dict[str, Any]] = field(default_factory=list)
    removed_citations: list[dict[str, Any]] = field(default_factory=list)
    unverified_quote_count: int = 0
    wire_sources: list[dict[str, Any]] = field(default_factory=list)
    degraded_reasons: list[str] = field(default_factory=list)

    @property
    def citation_grounded(self) -> bool:
        return bool(self.valid_citations)

    @property
    def quotes_verified(self) -> bool:
        return self.unverified_quote_count == 0


def _removed_citation_lines(removed_citations: Iterable[dict[str, Any]]) -> list[str]:
    lines = []
    for citation in removed_citations:
        url_match = re.search(r"https?://\S+", citation.get("line", ""))
        url_str = url_match.group(0).rstrip(".,;)") if url_match else "(no url)"
        lines.append(f"[{citation['number']}] {citation['reason']}: {url_str}")
    return lines


def verify_report(report: str, registry: Any, reference_sources: list[Any]) -> Verification:
    report = expand_grouped_citations(report)
    verification = verify_citations(report, registry, reference_sources=reference_sources)
    if verification.removed_citations:
        logger.info(
            "Citation verification removed %d invalid citation(s):\n  %s",
            len(verification.removed_citations),
            "\n  ".join(_removed_citation_lines(verification.removed_citations)),
        )
    report = verification.verified_report
    degraded_reasons: list[str] = []
    unverified_quotes = verify_quoted_spans(report, registry, with_nearest=False)
    if unverified_quotes:
        logger.info(
            "Citation verification: %d quoted span(s) not verbatim in any retrieved passage; report degraded",
            len(unverified_quotes),
        )
        degraded_reasons.append(DEGRADED_UNVERIFIED_QUOTES)
    if not verification.valid_citations:
        logger.warning(
            "Citation verification found no valid citations in writer-agent output; "
            "returning the generated report without failing the job. "
            "This may indicate unsupported citation formatting or over-aggressive verification."
        )
        degraded_reasons.append(DEGRADED_NO_VALID_CITATIONS)
    valid_citations = list(verification.valid_citations)
    return Verification(
        report=report,
        checked=True,
        valid_citations=valid_citations,
        removed_citations=list(verification.removed_citations),
        unverified_quote_count=len(unverified_quotes),
        wire_sources=_cited_sources_to_wire(registry, valid_citations),
        degraded_reasons=degraded_reasons,
    )


def record_citation_ledger(verification: Verification, registry: Any, self_confidence: ConfidenceLevel | None) -> None:
    registry_sources = registry.all_sources()
    citation_events.record_turn(
        agent="deep",
        source_count=len(registry_sources),
        cited_count=len(verification.valid_citations),
        removed_citations=list(verification.removed_citations),
        unverified_quote_count=verification.unverified_quote_count,
        grounded=verification.citation_grounded,
        fallback_used=False,
        confidence_capped_reason=answer_confidence_capped_reason(
            self_confidence,
            verification.citation_grounded,
            verification.quotes_verified,
        ),
        source_origins=[source_origin_token(entry).strip("[]").lower() or None for entry in registry_sources],
        source_lanes=[source.get("lane") for source in verification.wire_sources],
        source_tools=[entry.tool_name or None for entry in registry_sources],
        retrieved_source_labels=[label for label in map(source_label, registry_sources) if label],
        cited_source_labels=[
            label for label in ((c.get("citation_key") or c.get("url")) for c in verification.valid_citations) if label
        ],
    )




@dataclass(frozen=True)
class FinalizedReport:

    report: str
    degraded_reasons: list[str]
    wire_sources: list[dict[str, Any]]
    cutoff_reason: str | None
    citations_removed: dict[str, Any] | None
    confidence: ConfidenceLevel | None
    confidence_reason: str | None
    confidence_capped_reason: str | None
    basis_unread: list[str] = field(default_factory=list)


def _append_unread_basis(report: str, unread: Sequence[str]) -> str:
    if not unread:
        return report
    from agent.common.query_expansion import detect_language

    english = detect_language(report[:4000]) == "en"
    heading = "## Documents not read" if english else "## Nicht gelesene Unterlagen"
    lead = (
        "These documents were named as the basis of this research and could not be read; "
        "their contents are not reflected above:"
        if english
        else "Diese Unterlagen waren als Grundlage benannt und konnten nicht gelesen werden; "
        "ihr Inhalt ist oben nicht berücksichtigt:"
    )
    lines = "\n".join(f"- {name}" for name in unread)
    return f"{report.rstrip()}\n\n{heading}\n\n{lead}\n\n{lines}\n"


def finalize_report(
    verification: Verification,
    *,
    self_confidence: ConfidenceLevel | None,
    self_confidence_reason: str | None,
    degraded_reasons: list[str],
    cutoff_reason: str | None,
    basis_unread: Sequence[str] = (),
) -> FinalizedReport:
    degraded = [*degraded_reasons, *verification.degraded_reasons]
    if basis_unread:
        degraded.append(DEGRADED_BASIS_UNREAD)
    sanitization = sanitize_report(verification.report)
    wire_sources = _apply_renumbering(
        verification.wire_sources,
        sanitization.renumber_map,
        getattr(sanitization, "removed_citation_numbers", None),
    )
    report = _prepend_honesty_banner(
        _append_unread_basis(sanitization.sanitized_report, basis_unread),
        cutoff_reason=cutoff_reason,
        degraded_reasons=degraded,
    )
    grounded, quotes_ok = verification.citation_grounded, verification.quotes_verified
    confidence = _cap_for_incomplete_evidence(
        surface_answer_confidence(self_confidence, grounded, quotes_ok),
        cutoff_reason=cutoff_reason,
        degraded_reasons=degraded,
    )
    capped_reason = answer_confidence_capped_reason(self_confidence, grounded, quotes_ok)
    return FinalizedReport(
        report=report,
        degraded_reasons=degraded,
        wire_sources=wire_sources,
        cutoff_reason=cutoff_reason,
        citations_removed=_summarize_removed_citations(verification.removed_citations),
        confidence=confidence,
        confidence_reason=self_confidence_reason if confidence is not None else None,
        confidence_capped_reason=capped_reason if confidence is not None else None,
        basis_unread=list(basis_unread),
    )


def record_skill_transparency(result: Any, skill_runtime: SkillRuntime | None) -> None:
    if skill_runtime is None:
        return
    activated = list(skill_runtime.activated)
    if activated:
        set_state_field(result, "skills_activated", activated)
    hidden = list(skill_runtime.hidden_activated)
    if hidden:
        set_state_field(result, "skills_hidden", hidden)


def annotate_state(result: Any, finalized: FinalizedReport, skill_runtime: SkillRuntime | None) -> None:
    if finalized.citations_removed is not None:
        set_state_field(result, "citations_removed", finalized.citations_removed)
    if finalized.wire_sources:
        set_state_field(result, "verified_sources", finalized.wire_sources)
    record_skill_transparency(result, skill_runtime)
    if finalized.cutoff_reason is not None:
        set_state_field(result, "research_truncated", True)
        set_state_field(result, "truncation_reason", finalized.cutoff_reason)
    if finalized.degraded_reasons:
        set_state_field(result, "degraded_reasons", list(finalized.degraded_reasons))
        emit_answer_degraded(agent="deep", reasons=finalized.degraded_reasons)
    if finalized.basis_unread:
        set_state_field(result, "basis_unread", list(finalized.basis_unread))
    if finalized.confidence is None:
        return
    set_state_field(result, "answer_confidence", finalized.confidence)
    if finalized.confidence_reason:
        set_state_field(result, "answer_confidence_reason", finalized.confidence_reason)
    if finalized.confidence_capped_reason is not None:
        set_state_field(result, "answer_confidence_capped_reason", finalized.confidence_capped_reason)


def record_retrieval_ledger(
    result: Any,
    announcements: Sequence[dict[str, Any]],
    lane_hits: Sequence[dict[str, Any]],
) -> None:
    ledger = build_retrieval_ledger(announcements, lane_hits)
    if ledger is not None:
        set_state_field(result, "retrieval_ledger", ledger)


def emit_final_report(callbacks: Iterable[Any], report: str) -> None:
    sink = next((cb for cb in callbacks if hasattr(cb, "emit_final_report")), None)
    if sink is None:
        return
    try:
        sink.emit_final_report(report)
    except Exception:  # noqa: BLE001 - an echo must never unmake the answer
        logger.warning("Could not re-emit the final report to a callback", exc_info=True)


def log_completion(finalized: FinalizedReport) -> None:
    logger.info("=" * 80)
    logger.info("Deep Research Subagent: Workflow complete")
    logger.info("Final answer length: %d characters", len(finalized.report))
    if finalized.cutoff_reason or finalized.degraded_reasons:
        logger.info(
            "Answer shipped MARKED (cutoff=%s degraded=%s)",
            finalized.cutoff_reason or "-",
            ",".join(finalized.degraded_reasons) or "-",
        )
    logger.info("=" * 80)
