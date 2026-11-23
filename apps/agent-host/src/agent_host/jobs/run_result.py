from __future__ import annotations

from typing import Any

ANSWER_CONFIDENCE_FIELDS = (
    "answer_confidence",
    "answer_confidence_reason",
    "answer_confidence_capped_reason",
)

TEMPORARY_CONVERSATION_KEY = "temporary_conversation"

TEMPORARY_CONVERSATION_SKIP = "temporary_conversation"


def is_temporary_conversation(usage_context: dict | None) -> bool:
    return (usage_context or {}).get(TEMPORARY_CONVERSATION_KEY) is True


def mark_degraded(transparency: dict[str, Any], reason: str) -> None:
    existing = transparency.get("degraded_reasons")
    reasons = [token for token in existing if isinstance(token, str)] if isinstance(existing, list) else []
    if reason not in reasons:
        reasons.append(reason)
    transparency["degraded_reasons"] = reasons


def extract_skills_activated(result: Any) -> list[str] | None:
    value = _state_field(result, "skills_activated")
    if not isinstance(value, list):
        return None
    names = [name for name in value if isinstance(name, str) and name]
    return names or None


def extract_verified_sources(result: Any) -> list[dict[str, Any]] | None:
    value = _state_field(result, "verified_sources")
    if not isinstance(value, list):
        return None
    sources = [source for source in value if isinstance(source, dict) and source]
    return sources or None


def build_job_output(
    report: str,
    *,
    cards: list[Any] | None,
    transparency: dict[str, Any],
    sources: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    output: dict[str, Any] = {"report": report}
    if cards:
        output["cards"] = cards
    if sources:
        output["sources"] = sources
    output.update(transparency)
    return output


def extract_answer_transparency(result: Any) -> dict[str, Any]:
    return {**_cutoff_marks(result), **_self_assessment(result), **_run_records(result)}


def _state_field(result: Any, name: str) -> Any:
    value = getattr(result, name, None)
    if value is None and isinstance(result, dict):
        value = result.get(name)
    return value


def _cutoff_marks(result: Any) -> dict[str, Any]:
    transparency: dict[str, Any] = {}
    if _state_field(result, "research_truncated") is True:
        transparency["research_truncated"] = True

    reason = _state_field(result, "truncation_reason")
    if isinstance(reason, str) and reason.strip():
        transparency["truncation_reason"] = reason

    degraded_reasons = _state_field(result, "degraded_reasons")
    if isinstance(degraded_reasons, list):
        tokens = [token for token in degraded_reasons if isinstance(token, str) and token]
        if tokens:
            transparency["degraded_reasons"] = tokens

    citations_removed = _state_field(result, "citations_removed")
    if isinstance(citations_removed, dict) and citations_removed:
        transparency["citations_removed"] = citations_removed
    return transparency


def _self_assessment(result: Any) -> dict[str, Any]:
    return {
        name: value
        for name in ANSWER_CONFIDENCE_FIELDS
        if isinstance(value := _state_field(result, name), str) and value.strip()
    }


def _run_records(result: Any) -> dict[str, Any]:
    transparency: dict[str, Any] = {}
    ledger = _state_field(result, "retrieval_ledger")
    if isinstance(ledger, list) and ledger:
        transparency["retrieval_ledger"] = ledger
    hidden = _state_field(result, "skills_hidden")
    if isinstance(hidden, list):
        names = [name for name in hidden if isinstance(name, str) and name]
        if names:
            transparency["skills_hidden"] = names

    return transparency


def extract_result(result: Any) -> str:
    if isinstance(result, str):
        return result

    if hasattr(result, "messages") and result.messages:
        last_msg = result.messages[-1]
        if hasattr(last_msg, "content"):
            return str(last_msg.content)

    if isinstance(result, dict):
        if "messages" in result and result["messages"]:
            last_msg = result["messages"][-1]
            if hasattr(last_msg, "content"):
                return str(last_msg.content)
        if "report" in result:
            return str(result["report"])
        if "output" in result:
            return str(result["output"])

    return str(result) if result else ""
