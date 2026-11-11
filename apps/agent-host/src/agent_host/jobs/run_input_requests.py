"""A run asks a person, and reads the answer back (ADR-0181).

A run that cannot go on without a person stores an input request in the BFF:
``POST /api/internal/runs/{runId}/input-requests``. The request is a row there,
shown to the people who may act on the run, and the run's ledger turns
``waiting``. The run holds no connection open to learn the answer: it reads the
row, ``GET /api/internal/runs/{runId}/input-requests/{requestId}``, on its own
heartbeat, until the status has left ``open``.

The shape is the standards' and the BFF's zod is its contract
(``apps/workspace/bff/runs/input-request-types.ts``): what is asked follows MCP
form elicitation (a message and a flat ``requestedSchema`` of primitives), why
follows AG-UI's interrupt reasons. The bounds below repeat the contract's so a
body that would come back as a 400 fails here, where the failure is a log line.

Two rules, the run ledger client's own (``run_ledger_client``):

**The run id is the only identity.** It travels in the path; the body names no
organization, no project and no person.

**Nothing here raises.** ``ask`` and ``read`` answer ``None`` when the question
could not be stored or read. The caller decides what a run does without an
answer; this module never fails a run.

No runner calls this yet: the research runner's pause is the next slice.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any
from typing import Literal
from urllib.parse import quote

import httpx
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import field_validator

from ..internal_api import internal_base_url
from ..internal_api import internal_headers

logger = logging.getLogger(__name__)

INPUT_REQUEST_TIMEOUT_SECONDS = 5.0

#: The contract's bounds (``input-request-types.ts``).
MAX_INPUT_MESSAGE_CHARS = 2_000
MAX_INPUT_PROPERTIES = 12

InputRequestReason = Literal["input_required", "confirmation"]
InputRequestStatus = Literal["open", "answered", "declined", "cancelled", "expired"]

#: The statuses after which an answer can no longer arrive.
SETTLED_STATUSES: frozenset[str] = frozenset({"answered", "declined", "cancelled", "expired"})

_PROPERTY_NAME = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_IDEMPOTENCY_KEY = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")
_PRIMITIVE_TYPES = frozenset({"string", "number", "integer", "boolean"})


class InputRequestAsk(BaseModel):
    """What the run posts to ask. Serialised by alias, as the route reads it."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    reason: InputRequestReason
    message: str = Field(min_length=1, max_length=MAX_INPUT_MESSAGE_CHARS)
    requested_schema: dict[str, Any] = Field(alias="requestedSchema")
    #: The run's own key for this question: a retried post finds the same request.
    idempotency_key: str = Field(alias="idempotencyKey")
    expires_at: datetime | None = Field(default=None, alias="expiresAt")

    @field_validator("idempotency_key")
    @classmethod
    def _key_is_plain(cls, value: str) -> str:
        if not _IDEMPOTENCY_KEY.match(value):
            raise ValueError("idempotencyKey takes letters, digits and _ . : - only, at most 128")
        return value

    @field_validator("requested_schema")
    @classmethod
    def _schema_is_flat(cls, value: dict[str, Any]) -> dict[str, Any]:
        properties = value.get("properties")
        if value.get("type") != "object" or not isinstance(properties, dict):
            raise ValueError("requestedSchema is an object with properties")
        if not 1 <= len(properties) <= MAX_INPUT_PROPERTIES:
            raise ValueError(f"requestedSchema asks for 1 to {MAX_INPUT_PROPERTIES} values")
        for name, prop in properties.items():
            if not _PROPERTY_NAME.match(name):
                raise ValueError(f"property name is not lower snake case: {name}")
            if not isinstance(prop, dict) or prop.get("type") not in _PRIMITIVE_TYPES:
                raise ValueError(f"property {name} is not a string, number, integer or boolean")
        unknown = [name for name in value.get("required", []) if name not in properties]
        if unknown:
            raise ValueError(f"required names an unknown property: {unknown[0]}")
        return value

    def to_wire(self) -> dict[str, Any]:
        return self.model_dump(mode="json", by_alias=True, exclude_none=True)


class InputRequestView(BaseModel):
    """One request as the BFF answers it. ``content`` is present exactly when answered."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str
    run_id: str = Field(alias="runId")
    status: InputRequestStatus
    reason: InputRequestReason
    message: str
    requested_schema: dict[str, Any] = Field(alias="requestedSchema")
    content: dict[str, str | float | bool] | None = None
    decided_by: str | None = Field(default=None, alias="decidedBy")

    @property
    def settled(self) -> bool:
        """Whether an answer can no longer arrive: the run stops waiting."""
        return self.status in SETTLED_STATUSES


class RunInputRequestClient:
    """The two calls a run makes about its own questions. Never raises."""

    def __init__(self, timeout: float = INPUT_REQUEST_TIMEOUT_SECONDS) -> None:
        self._timeout = timeout

    async def ask(self, run_id: str, body: InputRequestAsk) -> InputRequestView | None:
        """Store the question. ``None`` when it could not be stored."""
        return await self._call("POST", run_id, None, body.to_wire())

    async def read(self, run_id: str, request_id: str) -> InputRequestView | None:
        """The request as it now stands. ``None`` when it could not be read."""
        if not request_id:
            return None
        return await self._call("GET", run_id, request_id, None)

    async def _call(
        self, method: str, run_id: str, request_id: str | None, payload: dict[str, Any] | None
    ) -> InputRequestView | None:
        url = self._url(run_id, request_id)
        headers = internal_headers()
        if url is None or headers is None:
            logger.debug("Run %s: internal API not configured; no input request sent", run_id)
            return None
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.request(method, url, json=payload, headers=headers)
        except Exception:  # noqa: BLE001 — never fails a run; see the module docstring
            logger.warning("Run %s: the input request %s could not be sent", run_id, method, exc_info=True)
            return None
        if response.status_code not in (200, 201):
            logger.warning("Run %s: the input request %s returned HTTP %s", run_id, method, response.status_code)
            return None
        try:
            return InputRequestView.model_validate(response.json())
        except ValueError:
            logger.warning("Run %s: the input request %s answered a body this tier cannot read", run_id, method)
            return None

    @staticmethod
    def _url(run_id: str, request_id: str | None) -> str | None:
        base_url = internal_base_url()
        if not base_url or not run_id:
            return None
        # Quoted although both are uuids: a path segment built by concatenation is
        # how a value that is "always a uuid" one day addresses a different route.
        url = f"{base_url.rstrip('/')}/api/internal/runs/{quote(run_id, safe='')}/input-requests"
        return url if request_id is None else f"{url}/{quote(request_id, safe='')}"
