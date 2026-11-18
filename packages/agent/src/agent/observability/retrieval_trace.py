import json
import logging
import uuid
from typing import Any

logger = logging.getLogger(__name__)

PICK_LIMIT = 50


def _compact(value: Any) -> dict[str, Any]:
    return {key: val for key, val in value.items() if val is not None}


def _shelf_of(entry: Any) -> str | None:
    shelf = getattr(entry, "shelf", None)
    if shelf is None:
        return None
    return getattr(shelf, "value", None) or str(shelf)


def collection_of(entry: Any) -> str | None:
    name = getattr(entry, "collection", None)
    return None if name is None else str(name)


def build_retrieval_input(
    *,
    query: str,
    retrieval_query: str | None,
    collections: list[Any],
    candidate_k: int,
    top_k: int,
    reranked: bool,
    dropped_by_floor: int,
    requery_queries: list[str] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "query": query,
        "retrieval_query": retrieval_query,
        "collections": [
            _compact({"collection": collection_of(entry), "shelf": _shelf_of(entry)}) for entry in collections
        ],
        "candidate_k": candidate_k,
        "top_k": top_k,
        "reranked": reranked,
        "dropped_by_floor": dropped_by_floor,
        "requery_queries": list(requery_queries) if requery_queries else None,
    }
    return _compact(payload)


def build_retrieval_output(*, chunks: list[Any]) -> dict[str, Any]:
    picked = []
    for chunk in chunks[:PICK_LIMIT]:
        metadata = getattr(chunk, "metadata", None) or {}
        score = getattr(chunk, "score", None)
        picked.append(
            _compact(
                {
                    "chunk_id": getattr(chunk, "chunk_id", None),
                    "file": getattr(chunk, "file_name", None),
                    "page": getattr(chunk, "page_number", None),
                    "score": round(score, 4) if score is not None else None,
                    "collection": metadata.get("collection"),
                    "shelf": metadata.get("shelf"),
                    "doc_class": metadata.get("doc_class"),
                }
            )
        )
    return {"picked": picked}


def emit_retrieval_span(*, tool_name: str, search_input: dict[str, Any], picks: dict[str, Any]) -> None:
    emit_step_span(f"retrieve.{tool_name}", search_input, picks)


def _end_timestamps(started_at: float | None, ended_at: float | None) -> dict[str, float]:
    stamps: dict[str, float] = {}
    if ended_at is not None:
        stamps["event_timestamp"] = ended_at
    if started_at is not None:
        stamps["span_event_timestamp"] = started_at
    return stamps


def emit_step_span(
    step_name: str,
    body_in: dict[str, Any],
    body_out: dict[str, Any],
    *,
    started_at: float | None = None,
    ended_at: float | None = None,
) -> None:
    try:
        from nat.data_models.intermediate_step import IntermediateStepPayload
        from nat.data_models.intermediate_step import IntermediateStepType
        from nat.data_models.intermediate_step import StreamEventData
        from nat.plugin_api import Context

        body_input = json.dumps(body_in, ensure_ascii=False, separators=(",", ":"))
        body_output = json.dumps(body_out, ensure_ascii=False, separators=(",", ":"))
        step_id = str(uuid.uuid4())
        manager = Context.get().intermediate_step_manager
        started = False
        try:
            manager.push_intermediate_step(
                IntermediateStepPayload(
                    UUID=step_id,
                    event_type=IntermediateStepType.FUNCTION_START,
                    name=step_name,
                    data=StreamEventData(input=body_input),
                    **({"event_timestamp": started_at} if started_at is not None else {}),
                )
            )
            started = True
        except Exception:  # noqa: BLE001
            logger.debug("%s START not emitted", step_name, exc_info=True)
        finally:
            if started:
                try:
                    manager.push_intermediate_step(
                        IntermediateStepPayload(
                            UUID=step_id,
                            event_type=IntermediateStepType.FUNCTION_END,
                            name=step_name,
                            data=StreamEventData(input=body_input, output=body_output),
                            **_end_timestamps(started_at, ended_at),
                        )
                    )
                except Exception:  # noqa: BLE001
                    logger.debug("%s END not emitted", step_name, exc_info=True)
    except Exception:  # noqa: BLE001 - telemetry must never take a turn down
        logger.debug("%s span not emitted", step_name, exc_info=True)
