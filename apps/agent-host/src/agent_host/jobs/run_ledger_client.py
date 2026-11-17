from __future__ import annotations

import logging
from typing import Any
from urllib.parse import quote

import httpx

from agent.common.run_ledger import RunLedgerAppendRequest
from agent.common.run_ledger import RunLedgerFinishRequest
from agent.common.run_ledger import to_wire

from ..internal_api import internal_base_url
from ..internal_api import internal_headers

logger = logging.getLogger(__name__)

LEDGER_TIMEOUT_SECONDS = 5.0


class RunLedgerClient:
    def __init__(self, timeout: float = LEDGER_TIMEOUT_SECONDS) -> None:
        self._timeout = timeout

    async def append(self, run_id: str, body: RunLedgerAppendRequest) -> bool:
        return await self._post(run_id, body)

    async def finish(self, run_id: str, body: RunLedgerFinishRequest) -> bool:
        if (body.result is None) == (body.error is None):
            logger.warning("Run %s: a finish op carries a result or an error, never both", run_id)
            return False
        return await self._post(run_id, body)

    async def _post(self, run_id: str, body: RunLedgerAppendRequest | RunLedgerFinishRequest) -> bool:
        if not run_id:
            return False
        url = self._url(run_id)
        headers = internal_headers()
        if url is None or headers is None:
            logger.debug("Run %s: internal API not configured; skipping the ledger %s", run_id, body.op)
            return False

        payload: dict[str, Any] = to_wire(body)
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(url, json=payload, headers=headers)
        except Exception:  # noqa: BLE001 — best-effort by contract; see the module docstring
            logger.warning("Run %s: the ledger %s could not be sent", run_id, body.op, exc_info=True)
            return False

        if response.status_code not in (200, 201):
            logger.warning("Run %s: the ledger %s returned HTTP %s", run_id, body.op, response.status_code)
            return False
        return True

    @staticmethod
    def _url(run_id: str) -> str | None:
        base_url = internal_base_url()
        if not base_url:
            return None
        return f"{base_url.rstrip('/')}/api/internal/runs/{quote(run_id, safe='')}/ledger"
