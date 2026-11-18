from __future__ import annotations

import asyncio
import logging
from typing import Any
from typing import Literal

import httpx

from ..internal_api import internal_base_url
from ..internal_api import internal_headers
from ..internal_retry import send_with_retry

logger = logging.getLogger(__name__)

_NOTIFY_TIMEOUT_SECONDS = 10.0

JobOutcomeStatus = Literal["success", "failure", "interrupted"]


def _organization_id(usage_context: dict | None) -> str | None:
    return ((usage_context or {}).get("identity") or {}).get("organization_id")


async def notify_job_outcome(
    *,
    job_id: str,
    usage_context: dict | None,
    status: JobOutcomeStatus,
    error: str | None = None,
    report: str | None = None,
    cards: list[dict] | None = None,
    expect_run: bool = False,
) -> bool:
    base_url = internal_base_url()
    headers = internal_headers()
    organization_id = _organization_id(usage_context)
    if not base_url or headers is None or not organization_id:
        logger.debug("Job %s: outcome not reported (internal BFF route not configured or no tenant)", job_id)
        return False

    payload: dict[str, Any] = {
        "organizationId": organization_id,
        "status": status,
        "error": error,
    }
    if report:
        payload["report"] = report
        if cards:
            payload["cards"] = cards
    url = f"{base_url.rstrip('/')}/api/internal/jobs/{job_id}/outcome"

    async def _send() -> httpx.Response:
        async with httpx.AsyncClient(timeout=_NOTIFY_TIMEOUT_SECONDS) as client:
            return await client.post(url, json=payload, headers=headers)

    response = await send_with_retry(_send, label=f"Job {job_id}: outcome report", retry_not_found=expect_run)
    if response is None:
        return False
    if response.status_code == 404:
        logger.debug("Job %s: no job run to report an outcome on", job_id)
        return False
    if response.status_code not in (200, 201):
        logger.warning("Job %s: outcome report returned HTTP %s", job_id, response.status_code)
        return False
    return True


async def notify_job_outcome_from_access(
    *,
    job_id: str,
    db_url: str,
    status: JobOutcomeStatus,
    error: str | None = None,
) -> bool:
    from .access import get_job_access

    try:
        access = await asyncio.to_thread(get_job_access, job_id, db_url)
    except Exception:  # noqa: BLE001 — best-effort by contract
        logger.warning("Job %s: could not read job access to report its outcome", job_id, exc_info=True)
        return False
    organization_id = (access or {}).get("organization_id")
    if not organization_id:
        logger.debug("Job %s: no tenant on record; outcome not reported", job_id)
        return False
    return await notify_job_outcome(
        job_id=job_id,
        usage_context={"identity": {"organization_id": organization_id}},
        status=status,
        error=error,
    )
