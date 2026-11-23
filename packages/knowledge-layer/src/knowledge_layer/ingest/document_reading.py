import json
import logging
from collections.abc import Sequence
from typing import Any

logger = logging.getLogger(__name__)


def _future_result(future, what: str, file_name: str, timeout: float = 30):
    if future is None:
        return None
    try:
        return future.result(timeout=timeout)
    except TimeoutError:
        logger.warning("%s timed out for %s", what, file_name)
    except Exception as e:  # noqa: BLE001 — an annotation is worth less than the ingestion
        logger.warning("%s failed for %s: %s", what, file_name, e)
    return None


def _digest_passages(documents: list[Any]) -> list[tuple[Any, str, str]]:
    return [
        (doc.metadata.get("page_label"), str(doc.metadata.get("content_type") or "text"), doc.get_content())
        for doc in documents
    ]


def _page_number(label: Any) -> int | None:
    try:
        number = int(str(label).strip())
    except TypeError, ValueError:
        return None
    return number if number > 0 else None


def _reading_of(
    documents: list[Any], dossier: dict[str, Any] | None, predecessor: tuple[str, Any] | None = None
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    from agent.knowledge.dossier import MAX_FACTS
    from agent.knowledge.dossier import lifted_drawing_facts
    from agent.knowledge.dossier import own_document_type
    from knowledge_layer.references import extract_references

    references = extract_references(
        ((doc.get_content(), _page_number(doc.metadata.get("page_label"))) for doc in documents),
        own_document_type=own_document_type(dossier),
    )
    if not dossier:
        return None, references
    analyses = []
    for doc in documents:
        raw = doc.metadata.get("drawing_data")
        if not raw:
            continue
        try:
            analyses.append(
                (_page_number(doc.metadata.get("page_label")), json.loads(raw) if isinstance(raw, str) else raw)
            )
        except TypeError, ValueError:
            continue
    facts = list(dossier.get("facts") or [])
    seen = {(fact["key"], fact["value"]) for fact in facts}
    for fact in lifted_drawing_facts(analyses):
        if (fact["key"], fact["value"]) not in seen and len(facts) < MAX_FACTS:
            seen.add((fact["key"], fact["value"]))
            facts.append(fact)
    reading = {**dossier, "facts": facts}
    if predecessor is not None:
        from agent.knowledge.dossier import fact_changes

        name, before = predecessor
        changes = fact_changes(before if isinstance(before, dict) else None, reading)
        if changes:
            reading["changes"] = changes
            reading["changed_against"] = name
    return reading, references


def _predecessor_dossier(
    rows: Sequence[Any], stored_names: Sequence[str], confirmed_older: str | None
) -> tuple[str, Any] | None:
    wanted = [*stored_names, *([confirmed_older] if confirmed_older else [])]
    for name in wanted:
        row = next((row for row in rows if getattr(row, "file_name", None) == name), None)
        if row is not None and getattr(row, "dossier", None):
            return name, row.dossier
    return None


def _generate_document_summary(text_content: str, file_name: str, llm=None) -> str | None:
    from agent.knowledge.document_classification import summarize_document_text

    return summarize_document_text(text_content, file_name, llm)
