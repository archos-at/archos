from __future__ import annotations

import logging
import os
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

from agent.project_context import REQUEST_CONTEXT_ENVELOPE_HEADER
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_SIG_HEADER
from agent.project_context import RequestContext

from ..internal_api import internal_base_url
from ..internal_api import internal_headers
from ..internal_retry import send_with_retry
from .access import JOB_ENVELOPE_MAX_AGE_MS
from .access import verified_envelope

logger = logging.getLogger(__name__)

RUN_ENVELOPE_RENEW_AFTER_MS = 60 * 60 * 1000

RENEW_TIMEOUT_SECONDS = 5.0

RUN_ENVELOPE_REFUSALS = frozenset({"unknown-run", "run-not-active", "requester-may-not-act"})


@dataclass(frozen=True)
class RunEnvelope:
    header: str
    signature: str

    def to_payload(self) -> dict[str, str]:
        return {"header": self.header, "signature": self.signature}

    def to_headers(self) -> dict[str, str]:
        return {REQUEST_CONTEXT_ENVELOPE_HEADER: self.header, REQUEST_CONTEXT_ENVELOPE_SIG_HEADER: self.signature}

    @classmethod
    def from_payload(cls, value: Any) -> RunEnvelope | None:
        if not isinstance(value, Mapping):
            return None
        header, signature = value.get("header"), value.get("signature")
        if not isinstance(header, str) or not header or not isinstance(signature, str) or not signature:
            return None
        return cls(header=header, signature=signature)


def capture_request_envelope(
    headers: Mapping[str, str],
    *,
    user_id: str | None,
    organization_id: str | None = None,
) -> dict[str, str] | None:
    context = verified_envelope(headers, user_id=user_id, organization_id=organization_id)
    if context is None or not context.envelope_header or not context.envelope_signature:
        return None
    return RunEnvelope(header=context.envelope_header, signature=context.envelope_signature).to_payload()


def _verify(envelope: RunEnvelope) -> RequestContext | None:
    secret = os.environ.get("INTERNAL_API_TOKEN")
    if not secret:
        return None
    context = RequestContext.from_envelope(envelope.header, envelope.signature, secret)
    if context is None or context.issued_at is None or not context.user_id or not context.organization_id:
        return None
    return context


def _same_person(context: RequestContext, identity: Mapping[str, Any]) -> bool:
    for field in ("user_id", "organization_id"):
        expected = identity.get(field)
        if expected and getattr(context, field) != expected:
            return False
    return True


async def envelope_headers_for_run(
    request_envelope: Any,
    *,
    run_id: str | None,
    job_id: str,
    identity: Mapping[str, Any] | None = None,
    now_ms: int | None = None,
) -> dict[str, str]:
    carried = RunEnvelope.from_payload(request_envelope)
    if carried is None:
        return {}
    context = _verify(carried)
    if context is None:
        logger.warning("Job %s: the carried request envelope does not verify; running without one", job_id)
        return {}
    if not _same_person(context, identity or {}):
        logger.warning("Job %s: the carried request envelope names another person; running without one", job_id)
        return {}
    now = now_ms if now_ms is not None else int(time.time() * 1000)
    if abs(now - (context.issued_at or 0)) < RUN_ENVELOPE_RENEW_AFTER_MS:
        return carried.to_headers()
    fresh = await renew_run_envelope(run_id, job_id=job_id)
    if fresh is REFUSED:
        return {}
    if fresh is None:
        if abs(now - (context.issued_at or 0)) >= JOB_ENVELOPE_MAX_AGE_MS:
            logger.warning("Job %s: request envelope not renewed and past its window; running without one", job_id)
            return {}
        logger.warning("Job %s: request envelope not renewed; running on the carried one", job_id)
        return carried.to_headers()
    return _accept_renewal(fresh, carried=context, job_id=job_id)


def _accept_renewal(fresh: RunEnvelope, *, carried: RequestContext, job_id: str) -> dict[str, str]:
    context = _verify(fresh)
    if context is None:
        logger.warning("Job %s: the renewed request envelope does not verify; running without one", job_id)
        return {}
    if context.user_id != carried.user_id or context.organization_id != carried.organization_id:
        logger.warning("Job %s: the renewed request envelope names another person; running without one", job_id)
        return {}
    if carried.collection_scope is not None and context.collection_scope is None:
        logger.warning("Job %s: the renewed request envelope carries no collection scope; running without one", job_id)
        return {}
    return fresh.to_headers()


class _Refused:
    def __repr__(self) -> str:
        return "REFUSED"


REFUSED = _Refused()


async def renew_run_envelope(run_id: str | None, *, job_id: str) -> RunEnvelope | _Refused | None:
    if not run_id:
        logger.info("Job %s: its request envelope is due for renewal and it has no run to renew it for", job_id)
        return None
    base_url = internal_base_url()
    headers = internal_headers()
    if not base_url or headers is None:
        logger.warning("Run %s: internal BFF route not configured; its request envelope is not renewed", run_id)
        return None
    url = f"{base_url.rstrip('/')}/api/internal/runs/{quote(run_id, safe='')}/envelope"

    async def _send() -> httpx.Response:
        async with httpx.AsyncClient(timeout=RENEW_TIMEOUT_SECONDS) as client:
            return await client.post(url, json={}, headers=headers)

    response = await send_with_retry(_send, label=f"Run {run_id}: request envelope renewal")
    if response is None:
        return None
    if response.status_code == 200:
        fresh = parse_renewal(_json(response))
        if fresh is None:
            logger.warning("Run %s: the BFF answered the envelope renewal with a malformed body", run_id)
        return fresh
    reason = refusal_reason(_json(response))
    if reason is not None and response.status_code in (403, 404, 409):
        logger.warning("Run %s: request envelope renewal refused (HTTP %s, %s)", run_id, response.status_code, reason)
        return REFUSED
    logger.warning("Run %s: request envelope not renewed (HTTP %s)", run_id, response.status_code)
    return None


def _json(response: httpx.Response) -> Any:
    try:
        return response.json()
    except Exception:  # noqa: BLE001 — a body that is not JSON is a malformed answer, not a crash
        return None


def parse_renewal(body: Any) -> RunEnvelope | None:
    if not isinstance(body, Mapping) or set(body) != {"header", "signature", "issuedAt"}:
        return None
    issued_at = body["issuedAt"]
    if not isinstance(issued_at, int) or isinstance(issued_at, bool) or issued_at <= 0:
        return None
    return RunEnvelope.from_payload(body)


def refusal_reason(body: Any) -> str | None:
    if not isinstance(body, Mapping) or set(body) != {"error", "message"}:
        return None
    error = body.get("error")
    return error if error in RUN_ENVELOPE_REFUSALS and isinstance(body.get("message"), str) else None
