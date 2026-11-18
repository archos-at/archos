from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from dataclasses import field
from typing import Any
from typing import Literal

from agent import project_context
from agent.common import bff_http
from agent.common.bff_http import SignedEnvelope
from agent.observability.retrieval_trace import emit_step_span

logger = logging.getLogger(__name__)

INTAKE_PATH = "/api/internal/project-intake"

REQUEST_TIMEOUT_SECONDS = 30

MAX_RECORD_VALUES = 20
MAX_SUMMARY_CHARS = 2000
MAX_DOCUMENTS_READ = 500
MAX_FILE_NAME_CHARS = 512
MAX_QUOTE_CHARS = 400

STALE_READING = "stale-reading"

IntakeOp = Literal["needs", "record", "withdraw", "progress", "finish"]


class IntakeRequestError(bff_http.BffError):
    def __init__(self, message: str, *, status: int | None = None, reason: str | None = None) -> None:
        super().__init__(message, status=status)
        self.reason = reason


@dataclass(frozen=True)
class IntakeReply:
    ok: bool
    body: dict[str, Any] = field(default_factory=dict)
    refusal: str = ""
    status: int | None = None
    reason: str | None = None

    @property
    def stale(self) -> bool:
        return self.status == 409 or self.reason == STALE_READING


def needs_request(job_id: str) -> dict[str, Any]:
    return {"op": "needs", "jobId": job_id}


def record_request(job_id: str, values: list[dict[str, Any]]) -> dict[str, Any]:
    return {"op": "record", "jobId": job_id, "values": values[:MAX_RECORD_VALUES]}


def withdraw_request(job_id: str, keys: list[str]) -> dict[str, Any]:
    return {"op": "withdraw", "jobId": job_id, "keys": keys[:MAX_RECORD_VALUES]}


def progress_request(job_id: str, files_opened: list[str]) -> dict[str, Any]:
    names = [name[:MAX_FILE_NAME_CHARS] for name in files_opened if name][:MAX_DOCUMENTS_READ]
    return {"op": "progress", "jobId": job_id, "filesOpened": names}


def finish_request(job_id: str, summary: str, documents_read: list[str], trace_id: str | None) -> dict[str, Any]:
    names = [name[:MAX_FILE_NAME_CHARS] for name in documents_read if name][:MAX_DOCUMENTS_READ]
    return {
        "op": "finish",
        "jobId": job_id,
        "summary": (summary or "").strip()[:MAX_SUMMARY_CHARS],
        "documentsRead": names,
        "traceId": trace_id or None,
    }


def _error_reason(exc: bff_http.BffRefusedError) -> str | None:
    for name in ("reason", "error", "code"):
        value = exc.body.get(name)
        if isinstance(value, str) and value:
            return value[:100]
    return None


def post_intake(payload: dict[str, Any], envelope: SignedEnvelope) -> dict[str, Any]:
    try:
        body = bff_http.post_json(INTAKE_PATH, payload, timeout=REQUEST_TIMEOUT_SECONDS, headers=envelope.headers())
    except bff_http.BffNotConfiguredError as exc:
        raise IntakeRequestError(str(exc)) from exc
    except bff_http.BffRefusedError as exc:
        raise IntakeRequestError(
            f"the intake route refused ({exc.status})", status=exc.status, reason=_error_reason(exc)
        ) from exc
    except bff_http.BffError as exc:
        raise IntakeRequestError("the intake route could not be reached") from exc
    if not isinstance(body, dict):
        raise IntakeRequestError("the intake route answered with something that is not an object")
    return body


def _refusal_text(exc: IntakeRequestError) -> str:
    if exc.status == 409 or exc.reason == STALE_READING:
        return (
            "The intake refused: this reading is no longer the project's current one (stale-reading). "
            "Nothing more can be recorded; call finish_intake with a one-sentence summary and stop."
        )
    if exc.status in (401, 403):
        return "The intake refused this run's identity; nothing can be recorded. Call finish_intake and stop."
    if exc.status == 400:
        return f"The intake rejected the request as malformed ({exc.reason or 'invalid body'}). Check the arguments."
    return f"The intake API is not reachable right now ({exc}). Try once more later in the run, then finish."


async def call_intake(op: IntakeOp, payload: dict[str, Any]) -> IntakeReply:
    observed = {"op": op, "job_id": payload.get("jobId")}
    if op == "record":
        observed["values"] = len(payload.get("values") or [])
    if op == "withdraw":
        observed["keys"] = len(payload.get("keys") or [])
    if op == "progress":
        observed["files_opened"] = len(payload.get("filesOpened") or [])
    header, signature = project_context.get_request_envelope_from_context()
    if not header or not signature:
        emit_step_span(f"project_intake.{op}", observed, {"outcome": "refused", "reason": "no_envelope"})
        return IntakeReply(
            ok=False,
            refusal=(
                "This run carries no signed identity (no request envelope), so the intake API cannot be "
                "reached and nothing can be recorded. Stop: there is nothing to do in this run."
            ),
            reason="no_envelope",
        )
    try:
        body = await asyncio.to_thread(post_intake, payload, SignedEnvelope(header=header, signature=signature))
    except IntakeRequestError as exc:
        logger.warning("Project intake %s refused: %s (%s)", op, exc, exc.reason)
        emit_step_span(
            f"project_intake.{op}", observed, {"outcome": "refused", "status": exc.status, "reason": exc.reason}
        )
        return IntakeReply(ok=False, refusal=_refusal_text(exc), status=exc.status, reason=exc.reason)
    emit_step_span(f"project_intake.{op}", observed, {"outcome": "ok"})
    return IntakeReply(ok=True, body=body, status=200)
