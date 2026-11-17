from __future__ import annotations

import os
import time
from collections.abc import Callable
from threading import Lock
from typing import TYPE_CHECKING
from typing import Any
from typing import Literal

from agent.common.log_redaction import scrub_presigned_urls
from agent.observability import trace_context

if TYPE_CHECKING:
    from posthog import Posthog
    from posthog.bucketed_rate_limiter import BucketedRateLimiter

HOST_ENV = "POSTHOG_HOST"
PROJECT_TOKEN_ENV = "POSTHOG_PROJECT_TOKEN"  # pragma: allowlist secret
IN_APP_MODULES = ["agent", "agent_host"]

ServerEvent = Literal["answer_failed", "answer_finished"]
"""Every product event a Python process sends: the closed union, as ``ServerEvent`` is in the BFF.

Each has a row in ``docs/observability/posthog-events.md``; ``tests/test_posthog_boundaries.py``
holds every ``capture`` call to this list and this list to the catalogue.
"""

_client: Posthog | None = None
_client_lock = Lock()
_resolved = False


def _scrub_event(event: dict[str, Any]) -> dict[str, Any]:
    properties = event.get("properties")
    if not isinstance(properties, dict):
        return event
    for key, value in properties.items():
        if isinstance(value, str):
            properties[key] = scrub_presigned_urls(value)
    exceptions = properties.get("$exception_list")
    for item in exceptions if isinstance(exceptions, list) else []:
        if isinstance(item, dict) and isinstance(item.get("value"), str):
            item["value"] = scrub_presigned_urls(item["value"])
    return event


def super_properties() -> dict[str, str]:
    values = {
        "environment": trace_context.langfuse_environment(),
        "release": trace_context.langfuse_release(),
        "service": os.environ.get("OTEL_SERVICE_NAME", "").strip() or None,
        "app_host": trace_context.app_host(),
        "deployment": trace_context.deployment(),
    }
    return {key: value for key, value in values.items() if value}


def _settings() -> tuple[str, str] | None:
    host = os.environ.get(HOST_ENV, "").strip().rstrip("/")
    token = os.environ.get(PROJECT_TOKEN_ENV, "").strip()
    if not (host and token):
        return None
    return host, token


def posthog_enabled() -> bool:
    return _settings() is not None


def get_client() -> Posthog | None:
    global _client, _resolved
    if _resolved:
        return _client
    with _client_lock:
        if _resolved:
            return _client
        settings = _settings()
        if settings is not None:
            from posthog import Posthog

            host, token = settings
            _client = Posthog(
                token,
                host=host,
                disable_geoip=True,
                enable_exception_autocapture=False,
                before_send=_scrub_event,
                super_properties=super_properties(),
                in_app_modules=IN_APP_MODULES,
            )
        _resolved = True
        return _client


SYSTEM_DISTINCT_ID = "system"
ORGANIZATION_GROUP = "organization"


def _context_identity() -> tuple[str | None, str | None]:
    try:
        from agent.project_context import get_organization_id_from_context
        from agent.project_context import get_signed_request_context

        envelope = get_signed_request_context()
        return (envelope.user_id if envelope is not None else None), get_organization_id_from_context()
    except Exception:  # noqa: BLE001 - no run context (a script, a timer) is not an error
        return None, None


def resolve_identity(distinct_id: str | None, organization_id: str | None = None) -> tuple[str, dict[str, Any]]:
    context_user, context_org = _context_identity()
    organization_id = organization_id or context_org
    properties: dict[str, Any] = {}
    if organization_id:
        properties["organization_id"] = organization_id
        properties["$groups"] = {ORGANIZATION_GROUP: organization_id}
    resolved = distinct_id or context_user
    if resolved:
        return resolved, properties
    properties["$process_person_profile"] = False
    return (f"{ORGANIZATION_GROUP}:{organization_id}" if organization_id else SYSTEM_DISTINCT_ID), properties


def capture(
    event: ServerEvent,
    *,
    distinct_id: str | None,
    properties: dict[str, Any] | None = None,
    organization_id: str | None = None,
) -> bool:
    client = get_client()
    if client is None:
        return False
    resolved, extra = resolve_identity(distinct_id, organization_id)
    return client.capture(event, distinct_id=resolved, properties={**extra, **(properties or {})}) is not None


def capture_exception(
    exception: BaseException,
    *,
    distinct_id: str | None = None,
    properties: dict[str, Any] | None = None,
    organization_id: str | None = None,
) -> bool:
    client = get_client()
    if client is None:
        return False
    resolved, extra = resolve_identity(distinct_id, organization_id)
    return (
        client.capture_exception(exception, distinct_id=resolved, properties={**extra, **(properties or {})})
        is not None
    )


def rate_limiter(burst: int, refill_seconds: float, clock: Callable[[], float] = time.monotonic) -> BucketedRateLimiter:
    from posthog.bucketed_rate_limiter import BucketedRateLimiter

    return BucketedRateLimiter(burst + 1, 2, refill_seconds, clock=clock)


def reset_for_tests() -> None:
    global _client, _resolved
    with _client_lock:
        _client = None
        _resolved = False
